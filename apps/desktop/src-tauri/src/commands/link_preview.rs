//! Link preview: fetch a web page and read the few `<head>` tags a bookmark
//! card needs (Open Graph first, plain HTML as the fallback).
//!
//! The fetch runs here rather than in the webview because the CSP's
//! `connect-src` falls back to `default-src 'self'`, and because most sites
//! would refuse a cross-origin `fetch()` anyway.

use crate::error::AppError;
use reqwest::Url;
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;

/// Stop reading after this many bytes. The tags we want live in `<head>`,
/// which is almost always far smaller; this only bounds a pathological page.
const MAX_BODY_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct LinkPreview {
    /// The URL after redirects.
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image: Option<String>,
    pub icon: Option<String>,
    /// False when the site's headers forbid showing it inside a frame
    /// (`X-Frame-Options` or CSP `frame-ancestors`), so the editor shows the
    /// summary card instead of a blank frame.
    pub embeddable: bool,
}

pub(crate) fn client() -> Result<&'static reqwest::Client, AppError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    // reqwest is built with `rustls-no-provider`; see `telemetry.rs`. Whoever
    // installs the provider first wins and later calls are no-ops.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; Writer link preview)")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| client))
}

#[tauri::command]
pub async fn fetch_link_preview(url: String) -> Result<LinkPreview, AppError> {
    let parsed = Url::parse(&url).map_err(|e| AppError::InvalidUrl(e.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl(format!(
            "unsupported scheme: {}",
            parsed.scheme()
        )));
    }

    let mut response = client()?
        .get(parsed)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let final_url = response.url().clone();
    let embeddable = frame_allowed(response.headers());
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    // A direct link to a picture previews as that picture.
    if content_type.starts_with("image/") {
        return Ok(LinkPreview {
            url: final_url.to_string(),
            image: Some(final_url.to_string()),
            embeddable,
            ..LinkPreview::default()
        });
    }
    if !content_type.is_empty() && !content_type.contains("html") {
        return Ok(LinkPreview {
            url: final_url.to_string(),
            embeddable,
            ..LinkPreview::default()
        });
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BODY_BYTES || contains_ascii_ci(&body, b"</head") {
            break;
        }
    }

    Ok(LinkPreview {
        embeddable,
        ..parse_preview(&String::from_utf8_lossy(&body), &final_url)
    })
}

/// Whether a page with these response headers may be shown in Writer's frame.
/// The editor's origin is never the site's own, so `SAMEORIGIN` and any
/// `frame-ancestors` list short of `*` both rule it out.
pub fn frame_allowed(headers: &reqwest::header::HeaderMap) -> bool {
    let x_frame_blocks = headers
        .get_all("x-frame-options")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|v| !v.trim().is_empty());
    if x_frame_blocks {
        return false;
    }
    let csp_blocks = headers
        .get_all(reqwest::header::CONTENT_SECURITY_POLICY)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|policy| policy.split(';'))
        .filter_map(|directive| {
            let mut parts = directive.split_ascii_whitespace();
            parts
                .next()
                .filter(|name| name.eq_ignore_ascii_case("frame-ancestors"))
                .map(|_| parts.collect::<Vec<_>>())
        })
        .any(|sources| !sources.contains(&"*"));
    !csp_blocks
}

fn contains_ascii_ci(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w.eq_ignore_ascii_case(needle))
}

/// Read the preview fields out of a page's markup. Relative image and icon
/// URLs resolve against `base`.
pub fn parse_preview(html: &str, base: &Url) -> LinkPreview {
    let mut og_title = None;
    let mut og_description = None;
    let mut og_site_name = None;
    let mut og_image = None;
    let mut twitter_title = None;
    let mut twitter_description = None;
    let mut twitter_image = None;
    let mut meta_description = None;
    let mut icon = None;
    let mut apple_icon = None;

    for tag in tags(html) {
        match tag.name.as_str() {
            "meta" => {
                let key = tag
                    .attr("property")
                    .or_else(|| tag.attr("name"))
                    .map(str::to_ascii_lowercase);
                let Some(key) = key else { continue };
                let Some(content) = tag
                    .attr("content")
                    .map(clean_text)
                    .filter(|s| !s.is_empty())
                else {
                    continue;
                };
                let slot = match key.as_str() {
                    "og:title" => &mut og_title,
                    "og:description" => &mut og_description,
                    "og:site_name" => &mut og_site_name,
                    "og:image" | "og:image:url" | "og:image:secure_url" => &mut og_image,
                    "twitter:title" => &mut twitter_title,
                    "twitter:description" => &mut twitter_description,
                    "twitter:image" | "twitter:image:src" => &mut twitter_image,
                    "description" => &mut meta_description,
                    _ => continue,
                };
                slot.get_or_insert(content);
            }
            "link" => {
                let (Some(rel), Some(href)) = (tag.attr("rel"), tag.attr("href")) else {
                    continue;
                };
                let rel = rel.to_ascii_lowercase();
                let rels: Vec<&str> = rel.split_ascii_whitespace().collect();
                if rels.contains(&"icon") {
                    icon.get_or_insert(href.trim().to_string());
                } else if rels.contains(&"apple-touch-icon") {
                    apple_icon.get_or_insert(href.trim().to_string());
                }
            }
            _ => {}
        }
    }

    let resolve = |href: String| {
        base.join(&decode_entities(&href))
            .ok()
            .map(|u| u.to_string())
    };

    LinkPreview {
        url: base.to_string(),
        title: og_title.or(twitter_title).or_else(|| title_text(html)),
        description: og_description.or(twitter_description).or(meta_description),
        site_name: og_site_name,
        image: og_image.or(twitter_image).and_then(resolve),
        icon: icon
            .or(apple_icon)
            .and_then(resolve)
            .or_else(|| base.join("/favicon.ico").ok().map(|u| u.to_string())),
        embeddable: true,
    }
}

fn title_text(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let open = lower.find("<title")?;
    let start = open + lower[open..].find('>')? + 1;
    let end = start + lower[start..].find("</title")?;
    Some(clean_text(&html[start..end])).filter(|s| !s.is_empty())
}

/// Entity-decode and collapse whitespace.
fn clean_text(raw: &str) -> String {
    decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_entities(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let decoded = tail.find(';').filter(|&semi| semi <= 10).and_then(|semi| {
            let entity = &tail[1..semi];
            let ch = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16)
                        .ok()
                        .and_then(char::from_u32)
                }
                _ if entity.starts_with('#') => {
                    entity[1..].parse::<u32>().ok().and_then(char::from_u32)
                }
                _ => None,
            };
            ch.map(|c| (c, semi))
        });
        match decoded {
            Some((c, semi)) => {
                out.push(c);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

struct Tag {
    name: String,
    attrs: Vec<(String, String)>,
}

impl Tag {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// Every `<meta>` and `<link>` start tag in document order. Deliberately not a
/// full HTML parser: it only has to read attribute lists, and stops being
/// interested once `<body>` starts.
fn tags(html: &str) -> Vec<Tag> {
    let bytes = html.as_bytes();
    let mut found = Vec::new();
    let mut i = 0;
    while let Some(offset) = html[i..].find('<') {
        let start = i + offset + 1;
        let name_end = start
            + bytes[start..]
                .iter()
                .position(|b| !b.is_ascii_alphanumeric())
                .unwrap_or(bytes.len() - start);
        let name = html[start..name_end].to_ascii_lowercase();
        if name == "body" {
            break;
        }
        let (attrs, end) = read_attrs(html, name_end);
        i = end.max(start);
        if name == "meta" || name == "link" {
            found.push(Tag { name, attrs });
        } else if name == "script" || name == "style" {
            // Their bodies are not markup; a `<` in a script must not start a tag.
            let close = format!("</{name}");
            match html[i..].to_ascii_lowercase().find(&close) {
                Some(p) => i += p + close.len(),
                None => break,
            }
        }
        if i >= bytes.len() {
            break;
        }
    }
    found
}

/// Parse `key="value" key='value' key=value key` up to the closing `>`.
/// Returns the attributes and the index just past the tag.
fn read_attrs(html: &str, mut i: usize) -> (Vec<(String, String)>, usize) {
    let bytes = html.as_bytes();
    let mut attrs = Vec::new();
    loop {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        if i >= bytes.len() {
            return (attrs, i);
        }
        if bytes[i] == b'>' {
            return (attrs, i + 1);
        }
        let key_start = i;
        while i < bytes.len()
            && !bytes[i].is_ascii_whitespace()
            && !matches!(bytes[i], b'=' | b'>' | b'/')
        {
            i += 1;
        }
        let key = html[key_start..i].to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let quote = bytes[i];
                let value_start = i + 1;
                let value_end = bytes[value_start..]
                    .iter()
                    .position(|&b| b == quote)
                    .map_or(bytes.len(), |p| value_start + p);
                value = html[value_start..value_end].to_string();
                i = (value_end + 1).min(bytes.len());
            } else {
                let value_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                    i += 1;
                }
                value = html[value_start..i].to_string();
            }
        }
        if key.is_empty() {
            // Stray byte we cannot read as a key; step over it.
            i += 1;
        } else {
            attrs.push((key, value));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://example.com/articles/post").unwrap()
    }

    #[test]
    fn prefers_open_graph_tags() {
        let html = r#"<html><head>
            <title>Plain title</title>
            <meta name="description" content="Plain description">
            <meta property="og:title" content="OG &amp; title">
            <meta property="og:description" content='OG description'>
            <meta property="og:site_name" content="Example">
            <meta property="og:image" content="/img/cover.png">
            <link rel="icon" href="/favicon.svg">
            </head><body><meta property="og:title" content="ignored"></body></html>"#;
        let preview = parse_preview(html, &base());
        assert_eq!(preview.title.as_deref(), Some("OG & title"));
        assert_eq!(preview.description.as_deref(), Some("OG description"));
        assert_eq!(preview.site_name.as_deref(), Some("Example"));
        assert_eq!(
            preview.image.as_deref(),
            Some("https://example.com/img/cover.png")
        );
        assert_eq!(
            preview.icon.as_deref(),
            Some("https://example.com/favicon.svg")
        );
    }

    #[test]
    fn falls_back_to_plain_html() {
        let html = "<HEAD><TITLE>\n  Hello\n  world &#8212; site </TITLE>\
                    <META NAME=description CONTENT=\"Just text\"></HEAD>";
        let preview = parse_preview(html, &base());
        assert_eq!(preview.title.as_deref(), Some("Hello world — site"));
        assert_eq!(preview.description.as_deref(), Some("Just text"));
        assert_eq!(preview.image, None);
        assert_eq!(
            preview.icon.as_deref(),
            Some("https://example.com/favicon.ico")
        );
    }

    #[test]
    fn reads_twitter_tags_and_shortcut_icon() {
        let html = r#"<meta name="twitter:title" content="Tweet title">
            <meta name="twitter:image" content="https://cdn.example.com/a.jpg?x=1&amp;y=2">
            <link rel="shortcut icon" href="icons/i.png">"#;
        let preview = parse_preview(html, &base());
        assert_eq!(preview.title.as_deref(), Some("Tweet title"));
        assert_eq!(
            preview.image.as_deref(),
            Some("https://cdn.example.com/a.jpg?x=1&y=2")
        );
        assert_eq!(
            preview.icon.as_deref(),
            Some("https://example.com/articles/icons/i.png")
        );
    }

    #[test]
    fn skips_empty_content_and_survives_broken_markup() {
        let html = r#"<meta property="og:title" content="  "><meta property="og:title" content="Second">
            <meta property="og:description" content="unterminated"#;
        let preview = parse_preview(html, &base());
        assert_eq!(preview.title.as_deref(), Some("Second"));
        assert_eq!(preview.description.as_deref(), Some("unterminated"));
    }

    #[test]
    fn ignores_tag_like_text_inside_scripts() {
        let html = r#"<script>if (a<b && c>"d") {}</script>
            <meta property="og:title" content="After script">"#;
        assert_eq!(
            parse_preview(html, &base()).title.as_deref(),
            Some("After script")
        );
    }

    fn headers(pairs: &[(&'static str, &'static str)]) -> reqwest::header::HeaderMap {
        let mut map = reqwest::header::HeaderMap::new();
        for (k, v) in pairs {
            map.append(*k, reqwest::header::HeaderValue::from_static(v));
        }
        map
    }

    #[test]
    fn frame_allowed_reads_x_frame_options_and_frame_ancestors() {
        assert!(frame_allowed(&headers(&[])));
        assert!(frame_allowed(&headers(&[(
            "content-security-policy",
            "default-src 'self'; frame-ancestors *"
        )])));
        assert!(frame_allowed(&headers(&[(
            "content-security-policy",
            "script-src 'self'"
        )])));
        assert!(!frame_allowed(&headers(&[(
            "x-frame-options",
            "SAMEORIGIN"
        )])));
        assert!(!frame_allowed(&headers(&[("x-frame-options", "deny")])));
        assert!(!frame_allowed(&headers(&[(
            "content-security-policy",
            "frame-ancestors 'self' https://example.com"
        )])));
        assert!(!frame_allowed(&headers(&[(
            "content-security-policy",
            "Frame-Ancestors 'none'"
        )])));
    }

    #[test]
    fn decodes_entities_and_leaves_unknown_ones() {
        assert_eq!(
            decode_entities("a &lt;b&gt; &#x27;c&#39; &bogus; & d"),
            "a <b> 'c' &bogus; & d"
        );
    }
}
