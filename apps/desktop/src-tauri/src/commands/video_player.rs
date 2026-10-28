//! The page that hosts YouTube's player (SPECs/youtube-notes-spec.md).
//!
//! YouTube refuses to play an embed whose request carries no http(s)
//! referrer (Error 153), and the shipped app is served from
//! `tauri://localhost`. So the player lives in a one-page loopback server on
//! `127.0.0.1`: the app frames that page, and the page's own YouTube frame
//! goes out with `http://127.0.0.1:<port>/` as its referrer.
//!
//! The server binds a random port on first use and serves exactly one static
//! page; every other request gets a 404.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::time::Duration;

use crate::error::AppError;

const PAGE: &str = include_str!("youtube-player.html");
const PAGE_PATH: &str = "/youtube-player.html";

static ORIGIN: OnceLock<Result<String, String>> = OnceLock::new();

/// A watch page is about 1.5 MB; the chapters sit in its `ytInitialData`.
const MAX_WATCH_PAGE_BYTES: usize = 4 * 1024 * 1024;

/// One of a video's chapters: where it starts, in seconds, and its title.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Chapter {
    pub start: f64,
    pub title: String,
}

/// How many times to read the watch page before deciding a video has no
/// chapters. YouTube serves some requests (about one in six, at random) a
/// page without the chapter data, which it then loads separately.
const CHAPTER_ATTEMPTS: usize = 3;

/// The chapters YouTube shows on the video's progress bar (the creator's,
/// or the ones YouTube made), read from its watch page: the IFrame API has
/// no way to ask. Empty when the video has none.
#[tauri::command]
pub async fn youtube_chapters(video_id: String) -> Result<Vec<Chapter>, AppError> {
    check_video_id(&video_id)?;
    for _ in 0..CHAPTER_ATTEMPTS {
        let chapters = chapters_in(&watch_page(&video_id).await?);
        if !chapters.is_empty() {
            return Ok(chapters);
        }
    }
    Ok(Vec::new())
}

fn check_video_id(video_id: &str) -> Result<(), AppError> {
    let valid = video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if valid {
        Ok(())
    } else {
        Err(AppError::InvalidUrl(format!(
            "not a YouTube id: {video_id}"
        )))
    }
}

/// One caption line: when it starts, in seconds, and what is said.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub text: String,
}

/// A caption language the video offers: its YouTube code and its name.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct CaptionLanguage {
    pub code: String,
    pub name: String,
}

/// A video's transcript in one language: the code read and its lines.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Transcript {
    pub language: String,
    pub cues: Vec<Cue>,
}

/// The language a transcript is read in when none is asked for.
const DEFAULT_LANGUAGE: &str = "en";

/// The video's transcript in `language` (English when `None`), from its
/// captions: the creator's track, else YouTube's automatic one; when the
/// video has neither, the spoken language's. Empty cues when the video has
/// no captions. Only the video's own tracks: YouTube answers its translated
/// captions with 429 on these links.
///
/// The caption links on the watch page need a proof-of-origin token since
/// 2025 and come back empty without one. The player API asked as the
/// Android app hands out links that work without it.
#[tauri::command]
pub async fn youtube_transcript(
    video_id: String,
    language: Option<String>,
) -> Result<Transcript, AppError> {
    check_video_id(&video_id)?;
    let language = language.unwrap_or_else(|| DEFAULT_LANGUAGE.to_string());
    let player = player_response(&video_id).await?;
    let Some((url, read)) = caption_track(&player, &language) else {
        return Ok(Transcript {
            language,
            cues: Vec::new(),
        });
    };
    let captions = crate::commands::link_preview::client()?
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(Transcript {
        language: read,
        cues: cues_in(&captions),
    })
}

/// The caption languages the video offers (its own tracks, once each), for
/// the transcript box's language menu, English first.
#[tauri::command]
pub async fn youtube_caption_languages(video_id: String) -> Result<Vec<CaptionLanguage>, AppError> {
    check_video_id(&video_id)?;
    Ok(caption_languages(&player_response(&video_id).await?))
}

async fn player_response(video_id: &str) -> Result<serde_json::Value, AppError> {
    crate::commands::link_preview::client()?
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .json(&serde_json::json!({
            "context": { "client": { "clientName": "ANDROID", "clientVersion": "20.10.38" } },
            "videoId": video_id,
        }))
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))
}

fn caption_tracks(player: &serde_json::Value) -> &[serde_json::Value] {
    player
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(|tracks| tracks.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn track_code(track: &serde_json::Value) -> &str {
    track["languageCode"].as_str().unwrap_or("")
}

/// "en" of "en-GB": tracks of one language with different regions match.
fn base_language(code: &str) -> &str {
    code.split('-').next().unwrap_or("")
}

fn is_auto(track: &serde_json::Value) -> bool {
    track["kind"].as_str() == Some("asr")
}

/// A track's name as YouTube shows it ("English (auto-generated)").
fn track_name(track: &serde_json::Value) -> String {
    track["name"]["simpleText"]
        .as_str()
        .map(str::to_string)
        .or_else(|| {
            let runs = track["name"]["runs"].as_array()?;
            Some(runs.iter().filter_map(|run| run["text"].as_str()).collect())
        })
        .filter(|name: &String| !name.is_empty())
        .unwrap_or_else(|| track_code(track).to_string())
}

/// The track in the spoken language: the creator's track in the automatic
/// track's language, else the automatic one, else the first.
fn spoken_track(tracks: &[serde_json::Value]) -> Option<&serde_json::Value> {
    match tracks.iter().find(|track| is_auto(track)) {
        Some(auto) => tracks
            .iter()
            .find(|track| {
                !is_auto(track)
                    && base_language(track_code(track)) == base_language(track_code(auto))
            })
            .or(Some(auto)),
        None => tracks.first(),
    }
}

/// The caption link to read for `language` and the language it reads in:
/// the creator's track in that language (the exact region first), else the
/// automatic one, else the spoken track.
fn caption_track(player: &serde_json::Value, language: &str) -> Option<(String, String)> {
    let tracks = caption_tracks(player);
    let url = |track: &serde_json::Value| track["baseUrl"].as_str().map(str::to_string);
    let base = base_language(language);
    let own = tracks
        .iter()
        .find(|track| !is_auto(track) && track_code(track) == language)
        .or_else(|| {
            tracks
                .iter()
                .find(|track| !is_auto(track) && base_language(track_code(track)) == base)
        })
        .or_else(|| {
            tracks
                .iter()
                .find(|track| is_auto(track) && base_language(track_code(track)) == base)
        });
    if let Some(track) = own {
        return Some((url(track)?, track_code(track).to_string()));
    }
    let spoken = spoken_track(tracks)?;
    Some((url(spoken)?, track_code(spoken).to_string()))
}

/// The video's caption languages, once each (the creator's name over the
/// automatic one's), English first.
fn caption_languages(player: &serde_json::Value) -> Vec<CaptionLanguage> {
    let tracks = caption_tracks(player);
    let mut languages: Vec<CaptionLanguage> = Vec::new();
    let mut ordered: Vec<&serde_json::Value> = tracks.iter().filter(|t| !is_auto(t)).collect();
    ordered.extend(tracks.iter().filter(|t| is_auto(t)));
    for track in ordered {
        let code = track_code(track);
        if code.is_empty() || languages.iter().any(|language| language.code == code) {
            continue;
        }
        // An automatic track adds nothing next to the creator's in its language.
        if is_auto(track)
            && languages
                .iter()
                .any(|language| base_language(&language.code) == base_language(code))
        {
            continue;
        }
        languages.push(CaptionLanguage {
            code: code.to_string(),
            name: track_name(track),
        });
    }
    // English first, the rest in YouTube's order.
    languages.sort_by_key(|language| base_language(&language.code) != DEFAULT_LANGUAGE);
    languages
}

/// Every non-empty `<p t="ms">` of a `srv3` caption file, its word spans
/// joined and its entities decoded.
fn cues_in(captions: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    let mut rest = captions;
    while let Some(at) = rest.find("<p ") {
        rest = &rest[at + 3..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        let attrs = &rest[..open_end];
        let close = rest.find("</p>").unwrap_or(rest.len());
        let inner = if close > open_end {
            &rest[open_end + 1..close]
        } else {
            ""
        };
        rest = &rest[close..];
        let Some(millis) = attr(attrs, "t").and_then(|t| t.parse::<u64>().ok()) else {
            continue;
        };
        let mut text = String::with_capacity(inner.len());
        let mut in_tag = false;
        for ch in inner.chars() {
            match ch {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => text.push(ch),
                _ => {}
            }
        }
        let text = crate::commands::link_preview::decode_entities(&text)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !text.is_empty() {
            cues.push(Cue {
                start: millis as f64 / 1000.0,
                text,
            });
        }
    }
    cues
}

/// The value of `name="…"` in a tag's attributes.
fn attr<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = attrs
        .match_indices(&needle)
        .find(|(i, _)| *i == 0 || attrs.as_bytes()[i - 1].is_ascii_whitespace())?
        .0
        + needle.len();
    let len = attrs[start..].find('"')?;
    Some(&attrs[start..start + len])
}

async fn watch_page(video_id: &str) -> Result<String, AppError> {
    let mut response = crate::commands::link_preview::client()?
        .get(format!("https://www.youtube.com/watch?v={video_id}"))
        .header(reqwest::header::ACCEPT, "text/html")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en")
        // Past the EU consent page, which has no chapters.
        .header(reqwest::header::COOKIE, "SOCS=CAI")
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
        if body.len() >= MAX_WATCH_PAGE_BYTES {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Every `chapterRenderer` in a watch page, in order, once each.
fn chapters_in(page: &str) -> Vec<Chapter> {
    const HEAD: &str = r#""chapterRenderer":{"title":{"simpleText":"#;
    const START: &str = r#"},"timeRangeStartMillis":"#;
    let mut chapters = Vec::new();
    let mut rest = page;
    while let Some(at) = rest.find(HEAD) {
        rest = &rest[at + HEAD.len()..];
        let Some(len) = json_string_len(rest) else {
            continue;
        };
        let (literal, after) = rest.split_at(len);
        let Some(after) = after.strip_prefix(START) else {
            continue;
        };
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        let (Ok(title), Ok(millis)) = (
            serde_json::from_str::<String>(literal),
            after[..digits].parse::<u64>(),
        ) else {
            continue;
        };
        chapters.push(Chapter {
            start: millis as f64 / 1000.0,
            title,
        });
    }
    chapters.sort_by(|a, b| a.start.total_cmp(&b.start));
    chapters.dedup_by(|a, b| a.start == b.start);
    chapters
}

/// `http://127.0.0.1:<port>`, starting the server on the first call.
/// Saves what the window shows in `x, y, width, height` (CSS pixels, page
/// zoom applied by the caller) as a PNG in the note's assets folder: a
/// screenshot of the video playing there. The video plays in YouTube's frame
/// inside the player page, out of reach of a canvas, so WebKit takes it.
#[tauri::command]
pub async fn save_video_snapshot(
    window: tauri::WebviewWindow,
    markdown_file_path: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<crate::commands::images::ImageSaveResult, AppError> {
    if !(width >= 1.0 && height >= 1.0) {
        return Err(AppError::User("The video isn't on screen.".into()));
    }
    let png = snapshot(&window, x, y, width, height).await?;
    crate::commands::images::save_clipboard_image_impl(&markdown_file_path, &png, "png")
}

#[cfg(target_os = "macos")]
async fn snapshot(
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<Vec<u8>, AppError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| unsafe {
            crate::macos::snapshot_png(
                webview.inner().cast(),
                crate::macos::CGRect::new(x, y, width, height),
                move |result| {
                    let _ = sender.send(result);
                },
            );
        })
        .map_err(|error| AppError::Io(format!("Couldn't reach the web view: {error}")))?;
    receiver
        .await
        .map_err(|_| AppError::Io("The screenshot never came back.".into()))?
        .map_err(|reason| AppError::Io(format!("Couldn't take the screenshot: {reason}")))
}

#[cfg(not(target_os = "macos"))]
async fn snapshot(
    _window: &tauri::WebviewWindow,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<Vec<u8>, AppError> {
    Err(AppError::User(
        "Video screenshots work on macOS only for now.".into(),
    ))
}

#[tauri::command]
pub fn video_player_origin() -> Result<String, AppError> {
    ORIGIN
        .get_or_init(|| start().map_err(|e| e.to_string()))
        .clone()
        .map_err(AppError::Io)
}

fn start() -> std::io::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let origin = format!("http://{}", listener.local_addr()?);
    std::thread::Builder::new()
        .name("video-player".into())
        .spawn(move || serve(listener))?;
    Ok(origin)
}

fn serve(listener: TcpListener) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        std::thread::spawn(move || {
            if let Err(error) = respond(stream) {
                eprintln!("[video-player] request failed: {error}");
            }
        });
    }
}

/// Whether a request line asks for the player page (with any query).
fn is_page_request(request_line: &str) -> bool {
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return false;
    }
    let target = parts.next().unwrap_or("");
    let path = target.split('?').next().unwrap_or("");
    path == PAGE_PATH
}

fn respond(mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Read the headers through: closing a socket with unread input resets the
    // connection, which can cut the response short.
    let mut header = String::new();
    while reader.read_line(&mut header)? > 0 && header != "\r\n" && header != "\n" {
        header.clear();
    }
    let (status, body) = if is_page_request(&request_line) {
        ("200 OK", PAGE)
    } else {
        ("404 Not Found", "")
    };
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}

/// The length of the JSON string literal `text` starts with, quotes
/// included, or None when it doesn't start with a whole one.
fn json_string_len(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some(i + 1),
            _ => i += 1,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn get(origin: &str, target: &str) -> String {
        let addr = origin.trim_start_matches("http://");
        let mut stream = TcpStream::connect(addr).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: {addr}\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn chapters_from_a_watch_page() {
        let page = r#"x"chapterRenderer":{"title":{"simpleText":"Intro \"one\""},"timeRangeStartMillis":0,"y"
            "chapterRenderer":{"title":{"simpleText":"Dynamic routing"},"timeRangeStartMillis":1444720}
            "chapterRenderer":{"title":{"simpleText":"Intro \"one\""},"timeRangeStartMillis":0}"#;
        assert_eq!(
            chapters_in(page),
            vec![
                Chapter {
                    start: 0.0,
                    title: "Intro \"one\"".into()
                },
                Chapter {
                    start: 1444.72,
                    title: "Dynamic routing".into()
                },
            ]
        );
        assert!(chapters_in("<html>no chapters</html>").is_empty());
    }

    #[test]
    fn cues_from_a_caption_file() {
        let captions = r#"<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
<body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="320" d="14260" w="1">[Music]</p>
<p t="18790" w="1" a="1">
</p>
<p t="18800" d="7160" w="1"><s ac="0">We&#39;re</s><s t="239" ac="0"> no</s><s t="559" ac="0"> strangers</s></p>
<p t="22640" d="4320">♪ You know the rules
and so do I ♪</p>
</body></timedtext>"#;
        assert_eq!(
            cues_in(captions),
            vec![
                Cue {
                    start: 0.32,
                    text: "[Music]".into()
                },
                Cue {
                    start: 18.8,
                    text: "We're no strangers".into()
                },
                Cue {
                    start: 22.64,
                    text: "♪ You know the rules and so do I ♪".into()
                },
            ]
        );
        assert!(cues_in("<timedtext></timedtext>").is_empty());
    }

    fn player(tracks: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": tracks } } })
    }

    fn picked(tracks: serde_json::Value, language: &str) -> Option<(String, String)> {
        caption_track(&player(tracks), language)
    }

    #[test]
    fn picks_the_track_in_the_language_asked() {
        let tracks = serde_json::json!([
            { "baseUrl": "fr-auto", "languageCode": "fr", "kind": "asr" },
            { "baseUrl": "en-GB", "languageCode": "en-GB" },
            { "baseUrl": "fr-CA", "languageCode": "fr-CA" },
            { "baseUrl": "fr", "languageCode": "fr" },
        ]);
        let pick = |language| picked(tracks.clone(), language);
        assert_eq!(pick("en"), Some(("en-GB".into(), "en-GB".into())));
        assert_eq!(pick("fr"), Some(("fr".into(), "fr".into())));
        assert_eq!(pick("fr-CA"), Some(("fr-CA".into(), "fr-CA".into())));
        // Not offered: the spoken track (the creator's, in the automatic
        // track's language).
        assert_eq!(pick("de"), Some(("fr-CA".into(), "fr-CA".into())));
    }

    #[test]
    fn english_falls_back_to_the_automatic_track_then_the_spoken_one() {
        let auto_en = serde_json::json!([
            { "baseUrl": "ar", "languageCode": "ar" },
            { "baseUrl": "en-auto", "languageCode": "en", "kind": "asr" },
        ]);
        assert_eq!(picked(auto_en, "en"), Some(("en-auto".into(), "en".into())));
        let no_english = serde_json::json!([{ "baseUrl": "ja", "languageCode": "ja" }]);
        assert_eq!(picked(no_english, "en"), Some(("ja".into(), "ja".into())));
        assert_eq!(caption_track(&serde_json::json!({}), "en"), None);
    }

    #[test]
    fn lists_each_language_once_english_first() {
        let tracks = serde_json::json!([
            { "baseUrl": "ar", "languageCode": "ar", "name": { "runs": [{ "text": "Arabic" }] } },
            { "baseUrl": "es", "languageCode": "es", "name": { "simpleText": "Spanish" } },
            { "baseUrl": "es-auto", "languageCode": "es", "kind": "asr", "name": { "simpleText": "Spanish (auto-generated)" } },
            { "baseUrl": "en-auto", "languageCode": "en", "kind": "asr", "name": { "simpleText": "English (auto-generated)" } },
        ]);
        let names: Vec<_> = caption_languages(&player(tracks))
            .into_iter()
            .map(|language| (language.code, language.name))
            .collect();
        assert_eq!(
            names,
            vec![
                ("en".to_string(), "English (auto-generated)".to_string()),
                ("ar".to_string(), "Arabic".to_string()),
                ("es".to_string(), "Spanish".to_string()),
            ]
        );
        assert!(caption_languages(&serde_json::json!({})).is_empty());
    }

    /// Against YouTube itself: `cargo test -- --ignored live_transcript`.
    #[test]
    #[ignore]
    fn live_transcript() {
        let english =
            tauri::async_runtime::block_on(youtube_transcript("dQw4w9WgXcQ".into(), None)).unwrap();
        assert!(english.cues.len() > 20, "got {} cues", english.cues.len());
        assert!(english
            .cues
            .iter()
            .any(|cue| cue.text.contains("give you up")));
        let languages =
            tauri::async_runtime::block_on(youtube_caption_languages("dQw4w9WgXcQ".into()))
                .unwrap();
        assert_eq!(base_language(&languages[0].code), "en", "{languages:?}");
        let other = languages
            .iter()
            .find(|l| base_language(&l.code) != "en")
            .expect("a second language");
        let read = tauri::async_runtime::block_on(youtube_transcript(
            "dQw4w9WgXcQ".into(),
            Some(other.code.clone()),
        ))
        .unwrap();
        assert_eq!(read.language, other.code);
        assert!(
            read.cues.len() > 20,
            "got {} {} cues",
            read.cues.len(),
            other.code
        );
    }

    #[test]
    fn page_requests() {
        assert!(is_page_request("GET /youtube-player.html?v=abc HTTP/1.1"));
        assert!(is_page_request("GET /youtube-player.html HTTP/1.1"));
        assert!(!is_page_request("POST /youtube-player.html HTTP/1.1"));
        assert!(!is_page_request("GET /../etc/passwd HTTP/1.1"));
        assert!(!is_page_request("GET /youtube-player.htmlx HTTP/1.1"));
    }

    #[test]
    fn serves_the_page_and_nothing_else() {
        let origin = video_player_origin().unwrap();
        assert!(origin.starts_with("http://127.0.0.1:"));
        assert_eq!(
            video_player_origin().unwrap(),
            origin,
            "one server per process"
        );

        let page = get(&origin, "/youtube-player.html?v=dQw4w9WgXcQ&t=12");
        assert!(page.starts_with("HTTP/1.1 200 OK"));
        assert!(page.contains("onYouTubeIframeAPIReady"));

        let other = get(&origin, "/anything");
        assert!(other.starts_with("HTTP/1.1 404"));
    }
}
