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
