//! The episode behind a podcast note's link (SPECs/podcast-notes-spec.md):
//! its audio, so the note can play it in a plain `<audio>` element, and its
//! title, show and artwork for the player's card.
//!
//! A link is an audio file already, or a page that names one (Apple Podcasts'
//! `streamUrl`, Overcast's `<audio>`, a host's `og:audio`). Apple's directory
//! answers for an Apple episode by its id. A Spotify episode names no file:
//! the same episode is looked up by its show and title in Apple's directory,
//! which holds every public feed.

use super::link_preview::{client, decode_entities, parse_preview};
use crate::error::AppError;
use reqwest::Url;
use std::sync::OnceLock;

/// A podcast page with its episode list can run to a few MB; a feed with
/// years of episodes, more.
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FEED_BYTES: usize = 24 * 1024 * 1024;

const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"];

/// What a podcast note's player shows and plays for its link.
#[derive(Debug, Default, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PodcastEpisode {
    /// The audio file to play; None when it can't be found, and `problem`
    /// says why in words for the user.
    pub audio: Option<String>,
    pub problem: Option<String>,
    pub title: Option<String>,
    pub show: Option<String>,
    /// The episode's artwork, else its show's. Found even when the audio
    /// isn't (a Spotify-only show), so the player still shows whose it is.
    pub artwork: Option<String>,
}

const SHOW_LINK: &str = "This links to a show. Link one of its episodes to play it.";

/// The episode `url` stands for: its audio, title, show and artwork.
#[tauri::command]
pub async fn podcast_episode(url: String) -> Result<PodcastEpisode, AppError> {
    let parsed = Url::parse(url.trim()).map_err(|e| AppError::InvalidUrl(e.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl(format!(
            "unsupported scheme: {}",
            parsed.scheme()
        )));
    }
    if is_audio_file(&parsed) {
        return Ok(PodcastEpisode {
            audio: Some(parsed.to_string()),
            ..Default::default()
        });
    }
    let host = parsed
        .host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();

    if host == "podcasts.apple.com" || host == "itunes.apple.com" {
        match apple_ids(&parsed) {
            Some((show, Some(episode))) => match apple_episode_by_id(show, episode).await {
                Ok(Some(found)) => return Ok(found),
                // Older than the directory's latest 200: the page names it.
                Ok(None) => {}
                Err(error) => eprintln!("[podcast] Apple lookup failed for {parsed}: {error}"),
            },
            Some((show, None)) => {
                let found = apple_show(show)
                    .await
                    .map_err(|e| eprintln!("[podcast] Apple lookup failed for {parsed}: {e}"))
                    .ok()
                    .flatten();
                return Ok(PodcastEpisode {
                    problem: Some(SHOW_LINK.into()),
                    show: found.as_ref().and_then(|r| r.collection_name.clone()),
                    artwork: found.and_then(LookupResult::artwork),
                    ..Default::default()
                });
            }
            None => {}
        }
    }

    let page = fetch_text(parsed.clone(), "text/html", MAX_PAGE_BYTES).await?;
    let preview = parse_preview(&page, &parsed);

    // Spotify's own `og:audio` is a 30-second preview, never the episode.
    if host == "open.spotify.com" {
        if !parsed.path().starts_with("/episode/") {
            return Ok(PodcastEpisode {
                problem: Some(SHOW_LINK.into()),
                show: preview.title,
                artwork: preview.image,
                ..Default::default()
            });
        }
        let Some((title, show)) = spotify_episode(&page) else {
            return Ok(PodcastEpisode {
                problem: Some("Couldn't read the episode's name from Spotify.".into()),
                title: preview.title,
                artwork: preview.image,
                ..Default::default()
            });
        };
        let audio = episode_in_directory(&show, &title).await?;
        return Ok(PodcastEpisode {
            problem: audio
                .is_none()
                .then(|| "This episode only plays on Spotify.".into()),
            audio,
            title: Some(title),
            show: Some(show),
            artwork: preview.image,
        });
    }

    let audio = audio_in_page(&page, &parsed);
    Ok(PodcastEpisode {
        problem: audio
            .is_none()
            .then(|| "Couldn't find this episode's audio on its page.".into()),
        audio,
        title: preview.title,
        show: preview.site_name.filter(|name| !is_app_name(name)),
        artwork: preview.image,
    })
}

/// A podcast app's own name, which a page gives as its site name: not the
/// show's.
fn is_app_name(name: &str) -> bool {
    [
        "Apple Podcasts",
        "Overcast",
        "Pocket Casts",
        "Spotify",
        "Castro",
        "Podcast Addict",
    ]
    .iter()
    .any(|app| app.eq_ignore_ascii_case(name.trim()))
}

fn is_audio_file(url: &Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    path.rsplit_once('.')
        .is_some_and(|(_, ext)| AUDIO_EXTENSIONS.contains(&ext))
}

/// The show id (`/id1434243584`) and episode id (`?i=1000786117598`) in an
/// Apple Podcasts link; no episode for a show's own page.
fn apple_ids(url: &Url) -> Option<(u64, Option<u64>)> {
    let show = url
        .path_segments()?
        .find_map(|segment| segment.strip_prefix("id")?.parse().ok())?;
    let episode = url
        .query_pairs()
        .find(|(key, _)| key == "i")
        .and_then(|(_, value)| value.parse().ok());
    Some((show, episode))
}

#[derive(serde::Deserialize)]
struct Lookup {
    results: Vec<LookupResult>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupResult {
    wrapper_type: Option<String>,
    kind: Option<String>,
    track_id: Option<u64>,
    collection_id: Option<u64>,
    collection_name: Option<String>,
    track_name: Option<String>,
    episode_url: Option<String>,
    feed_url: Option<String>,
    artwork_url600: Option<String>,
    artwork_url160: Option<String>,
}

impl LookupResult {
    fn artwork(self) -> Option<String> {
        self.artwork_url600.or(self.artwork_url160)
    }
}

async fn itunes(url: &str) -> Result<Lookup, AppError> {
    client()?
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))
}

/// A show's entry in Apple's directory.
async fn apple_show(show: u64) -> Result<Option<LookupResult>, AppError> {
    let lookup = itunes(&format!("https://itunes.apple.com/lookup?id={show}")).await?;
    Ok(lookup.results.into_iter().next())
}

/// A show's latest episodes (Apple's directory lists at most 200), and the
/// show's own entry, which names its feed and artwork.
async fn show_episodes(show: u64) -> Result<(Vec<LookupResult>, Option<LookupResult>), AppError> {
    let (episodes, rest) = itunes(&format!(
        "https://itunes.apple.com/lookup?id={show}&entity=podcastEpisode&limit=200"
    ))
    .await?
    .results
    .into_iter()
    .partition(|r| r.kind.as_deref() == Some("podcast-episode"));
    Ok((episodes, rest.into_iter().next()))
}

async fn apple_episode_by_id(show: u64, episode: u64) -> Result<Option<PodcastEpisode>, AppError> {
    let (episodes, entry) = show_episodes(show).await?;
    let Some(found) = episodes.into_iter().find(|r| r.track_id == Some(episode)) else {
        return Ok(None);
    };
    let Some(audio) = found.episode_url.clone() else {
        return Ok(None);
    };
    Ok(Some(PodcastEpisode {
        audio: Some(audio),
        problem: None,
        title: found.track_name.clone(),
        show: found.collection_name.clone(),
        artwork: found
            .artwork()
            .or_else(|| entry.and_then(LookupResult::artwork)),
    }))
}

/// `title` of the show named `show`, through Apple's directory: its latest
/// episodes, then its whole feed.
async fn episode_in_directory(show: &str, title: &str) -> Result<Option<String>, AppError> {
    let mut search =
        Url::parse("https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10")
            .expect("static URL");
    search.query_pairs_mut().append_pair("term", show);
    let shows = itunes(search.as_str()).await?.results;
    let wanted = normalize(show);
    let Some(found) = shows
        .iter()
        .find(|r| r.collection_name.as_deref().map(normalize) == Some(wanted.clone()))
        .or_else(|| {
            shows
                .iter()
                .find(|r| r.wrapper_type.as_deref() == Some("track"))
        })
    else {
        return Ok(None);
    };
    let Some(show_id) = found.collection_id else {
        return Ok(None);
    };
    let (episodes, entry) = show_episodes(show_id).await?;
    let feed = entry.and_then(|e| e.feed_url);
    if let Some(audio) = episodes
        .iter()
        .find(|r| {
            r.track_name
                .as_deref()
                .is_some_and(|t| same_title(t, title))
        })
        .and_then(|r| r.episode_url.clone())
    {
        return Ok(Some(audio));
    }
    let Some(feed) = feed.or_else(|| found.feed_url.clone()) else {
        return Ok(None);
    };
    let feed_url = Url::parse(&feed).map_err(|e| AppError::InvalidUrl(e.to_string()))?;
    let xml = fetch_text(
        feed_url,
        "application/rss+xml, application/xml, text/xml",
        MAX_FEED_BYTES,
    )
    .await?;
    Ok(episode_in_feed(&xml, title))
}

/// The enclosure of the feed item titled `title`.
fn episode_in_feed(xml: &str, title: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(xml)
        .map_err(|e| eprintln!("[podcast] Couldn't read the feed: {e}"))
        .ok()?;
    doc.descendants()
        .filter(|n| n.has_tag_name("item"))
        .find(|item| {
            item.children()
                .find(|c| c.has_tag_name("title"))
                .and_then(|c| c.text())
                .is_some_and(|t| same_title(t, title))
        })?
        .children()
        .find(|c| c.has_tag_name("enclosure"))?
        .attribute("url")
        .map(str::to_string)
}

/// Letters and digits only, lowercased: "#502 – Psychiatry &amp; Freud" and
/// "#502 - Psychiatry & Freud" are one title.
fn normalize(text: &str) -> String {
    decode_entities(text)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// The same title, or one inside the other (a feed prefixing its episode
/// number), when the shorter is long enough to name an episode.
fn same_title(a: &str, b: &str) -> bool {
    let (a, b) = (normalize(a), normalize(b));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let (short, long) = if a.len() <= b.len() {
        (&a, &b)
    } else {
        (&b, &a)
    };
    a == b || (short.chars().count() >= 16 && long.contains(short.as_str()))
}

/// A Spotify episode page's title and show: the title from `og:title`, the
/// show from "Listen to this episode from <show> on Spotify".
fn spotify_episode(page: &str) -> Option<(String, String)> {
    static TITLE: OnceLock<regex_lite::Regex> = OnceLock::new();
    static SHOW: OnceLock<regex_lite::Regex> = OnceLock::new();
    let title = TITLE
        .get_or_init(|| {
            regex_lite::Regex::new(r#"<meta\s+property="og:title"\s+content="([^"]+)""#).unwrap()
        })
        .captures(page)?;
    let show = SHOW
        .get_or_init(|| {
            regex_lite::Regex::new(r"Listen to this episode from (.+?) on Spotify").unwrap()
        })
        .captures(page)?;
    Some((
        decode_entities(&title[1]).trim().to_string(),
        decode_entities(&show[1]).trim().to_string(),
    ))
}

/// The episode's audio named in its page: `og:audio`, an `<audio>` (or its
/// `<source>`), else a `streamUrl`-like key in the page's data. The first
/// wins: an episode's page names its own audio before any other episode's.
fn audio_in_page(page: &str, base: &Url) -> Option<String> {
    static META: OnceLock<regex_lite::Regex> = OnceLock::new();
    static TAG: OnceLock<regex_lite::Regex> = OnceLock::new();
    static DATA: OnceLock<regex_lite::Regex> = OnceLock::new();
    let meta = META.get_or_init(|| regex_lite::Regex::new(r"(?i)<meta\b[^>]*>").unwrap());
    let tag = TAG.get_or_init(|| regex_lite::Regex::new(r"(?i)<(audio|source)\b[^>]*>").unwrap());
    let data = DATA.get_or_init(|| {
        regex_lite::Regex::new(
            r#""(streamUrl|audioUrl|enclosureUrl|contentUrl)"\s*:\s*"(https?:[^"]+)""#,
        )
        .unwrap()
    });
    let resolve = |raw: &str| -> Option<String> {
        let mut url = base.join(&decode_entities(raw.trim())).ok()?;
        if !matches!(url.scheme(), "http" | "https") {
            return None;
        }
        // Overcast's `#t=0` and the like: the player decides where to start.
        url.set_fragment(None);
        Some(url.to_string())
    };

    for m in meta.find_iter(page) {
        let tag = m.as_str();
        let key = attr(tag, "property").or_else(|| attr(tag, "name"));
        if matches!(
            key.map(str::to_ascii_lowercase).as_deref(),
            Some("og:audio" | "og:audio:url" | "og:audio:secure_url" | "twitter:player:stream")
        ) {
            if let Some(audio) = attr(tag, "content").and_then(resolve) {
                return Some(audio);
            }
        }
    }
    for m in tag.captures_iter(page) {
        let tag = m.get(0)?.as_str();
        let Some(src) = attr(tag, "src") else {
            continue;
        };
        // A `<source>` may be a video's; an `<audio>`'s own src is audio.
        let audio_type = attr(tag, "type").is_some_and(|t| t.starts_with("audio/"));
        let is_audio = m[1].eq_ignore_ascii_case("audio")
            || audio_type
            || resolve(src).is_some_and(|u| Url::parse(&u).is_ok_and(|u| is_audio_file(&u)));
        if is_audio {
            if let Some(audio) = resolve(src) {
                return Some(audio);
            }
        }
    }
    for m in data.captures_iter(page) {
        let raw = m[2].replace("\\/", "/").replace("\\u0026", "&");
        let Some(audio) = resolve(&raw) else { continue };
        // `contentUrl` names images and pages too.
        if &m[1] != "contentUrl" || Url::parse(&audio).is_ok_and(|u| is_audio_file(&u)) {
            return Some(audio);
        }
    }
    None
}

/// The value of `name` in a start tag, quoted either way.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(name) {
        let at = from + found;
        from = at + name.len();
        let before = lower.as_bytes().get(at.wrapping_sub(1)).copied();
        if !matches!(before, Some(b' ' | b'\t' | b'\n' | b'\r')) {
            continue;
        }
        let rest = tag[from..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let quote = rest.chars().next()?;
        return if quote == '"' || quote == '\'' {
            rest[1..].find(quote).map(|end| &rest[1..1 + end])
        } else {
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '>')
                .unwrap_or(rest.len());
            Some(&rest[..end])
        };
    }
    None
}

async fn fetch_text(url: Url, accept: &str, max_bytes: usize) -> Result<String, AppError> {
    let mut response = client()?
        .get(url)
        .header(reqwest::header::ACCEPT, accept)
        .header(reqwest::header::ACCEPT_LANGUAGE, "en")
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        body.extend_from_slice(&chunk);
        if body.len() >= max_bytes {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn audio_files_by_extension() {
        assert!(is_audio_file(&url("https://cdn.example.com/ep/12.MP3?x=1")));
        assert!(is_audio_file(&url("https://cdn.example.com/a.m4a")));
        assert!(!is_audio_file(&url("https://example.com/episode/12")));
    }

    #[test]
    fn apple_episode_and_show_ids() {
        assert_eq!(
            apple_ids(&url(
                "https://podcasts.apple.com/us/podcast/name/id1434243584?i=1000786117598"
            )),
            Some((1434243584, Some(1000786117598)))
        );
        assert_eq!(
            apple_ids(&url(
                "https://podcasts.apple.com/us/podcast/name/id1434243584"
            )),
            Some((1434243584, None))
        );
    }

    #[test]
    fn audio_named_in_a_page() {
        let base = url("https://overcast.fm/+AbC");
        let og = r#"<meta content="https://cdn.x/ep.mp3" property="og:audio">"#;
        assert_eq!(
            audio_in_page(og, &base).as_deref(),
            Some("https://cdn.x/ep.mp3")
        );
        let tag =
            r#"<audio controls><source src="https://cdn.x/ep.mp3#t=0" type="audio/mpeg"></audio>"#;
        assert_eq!(
            audio_in_page(tag, &base).as_deref(),
            Some("https://cdn.x/ep.mp3")
        );
        let video = r#"<video><source src="https://cdn.x/clip.mp4" type="video/mp4"></video>"#;
        assert_eq!(audio_in_page(video, &base), None);
        let data = r#"{"streamUrl":"https:\/\/media.example.com\/ep.mp3?a=1&b=2"}"#;
        assert_eq!(
            audio_in_page(data, &base).as_deref(),
            Some("https://media.example.com/ep.mp3?a=1&b=2")
        );
        let image = r#"{"contentUrl":"https://img.example.com/cover.jpg"}"#;
        assert_eq!(audio_in_page(image, &base), None);
    }

    #[test]
    fn spotify_title_and_show() {
        let page = r##"<meta property="og:title" content="#502 – Psychiatry &amp; Freud"/><meta name="description" content="Listen to this episode from Lex Fridman Podcast on Spotify. Andrew"/>"##;
        assert_eq!(
            spotify_episode(page),
            Some((
                "#502 – Psychiatry & Freud".to_string(),
                "Lex Fridman Podcast".to_string()
            ))
        );
    }

    #[test]
    fn titles_match_across_punctuation_and_prefixes() {
        assert!(same_title(
            "#502 – Psychiatry &amp; Freud",
            "#502 - Psychiatry & Freud"
        ));
        assert!(same_title(
            "Episode 12: The Long Road Home Again",
            "The Long Road Home Again"
        ));
        assert!(!same_title("Intro", "Intro to everything else"));
    }

    #[test]
    fn feed_enclosure_by_title() {
        let xml = r##"<rss><channel>
            <item><title>Other</title><enclosure url="https://x/1.mp3"/></item>
            <item><title><![CDATA[#502 – Psychiatry & Freud]]></title><enclosure url="https://x/2.mp3"/></item>
        </channel></rss>"##;
        assert_eq!(
            episode_in_feed(xml, "#502 - Psychiatry & Freud").as_deref(),
            Some("https://x/2.mp3")
        );
    }

    /// The real services; run with `cargo test podcast_live -- --ignored`.
    #[test]
    #[ignore]
    fn podcast_live() {
        let run = tauri::async_runtime::block_on;
        let apple = run(podcast_episode(
            "https://podcasts.apple.com/us/podcast/x/id1434243584?i=1000786117598".into(),
        ))
        .unwrap();
        assert!(apple.audio.as_deref().unwrap().contains("dhh"), "{apple:?}");
        assert!(apple.artwork.is_some(), "{apple:?}");
        let spotify = run(podcast_episode(
            "https://open.spotify.com/episode/082a1V6nazH9ZZqskV1vfz".into(),
        ))
        .unwrap();
        assert!(
            spotify.audio.as_deref().unwrap().contains("scull"),
            "{spotify:?}"
        );
        assert!(spotify.artwork.is_some(), "{spotify:?}");
        let show = run(podcast_episode(
            "https://podcasts.apple.com/us/podcast/x/id1434243584".into(),
        ))
        .unwrap();
        assert!(show.problem.is_some() && show.artwork.is_some(), "{show:?}");
    }
}
