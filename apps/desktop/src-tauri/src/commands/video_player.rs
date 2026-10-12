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

/// The chapters YouTube shows on the video's progress bar (the creator's,
/// or the ones YouTube made), read from its watch page: the IFrame API has
/// no way to ask. Empty when the video has none.
#[tauri::command]
pub async fn youtube_chapters(video_id: String) -> Result<Vec<Chapter>, AppError> {
    let valid = video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !valid {
        return Err(AppError::InvalidUrl(format!(
            "not a YouTube id: {video_id}"
        )));
    }
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
    Ok(chapters_in(&String::from_utf8_lossy(&body)))
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
