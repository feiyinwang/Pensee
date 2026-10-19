//! The What's new card's source (SPECs/whats-new-card-spec.md): the top of
//! CHANGELOG.md on the repo's master. Read here because the webview's CSP
//! allows no outside fetches.

use crate::commands::link_preview::client;
use crate::error::AppError;

const CHANGELOG_URL: &str =
    "https://raw.githubusercontent.com/feiyinwang/Pensee/master/CHANGELOG.md";

/// The newest days fit easily in this; the card only shows the newest one.
const HEAD_BYTES: usize = 64 * 1024;

/// The first `HEAD_BYTES` of the changelog, cut back to its last whole line.
/// `PENSEE_CHANGELOG_FILE` reads a local file instead (the e2e journeys).
#[tauri::command]
pub async fn fetch_changelog() -> Result<String, AppError> {
    if let Ok(path) = std::env::var("PENSEE_CHANGELOG_FILE") {
        let text = tokio::fs::read(&path).await?;
        return Ok(head(&text));
    }
    let response = client()?
        .get(CHANGELOG_URL)
        .header(
            reqwest::header::RANGE,
            format!("bytes=0-{}", HEAD_BYTES - 1),
        )
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let body = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(head(&body))
}

/// Up to `HEAD_BYTES`, ending at a newline so no line (or character) is cut.
fn head(bytes: &[u8]) -> String {
    let bytes = &bytes[..bytes.len().min(HEAD_BYTES)];
    let end = if bytes.len() < HEAD_BYTES {
        bytes.len()
    } else {
        bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1)
    };
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_kept_whole() {
        assert_eq!(
            head(b"# Changelog\n\n## 2026-10-18\n- A"),
            "# Changelog\n\n## 2026-10-18\n- A"
        );
    }

    #[test]
    fn long_text_ends_at_a_whole_line() {
        let mut text = "- é line\n".repeat(HEAD_BYTES / 4).into_bytes();
        text.truncate(HEAD_BYTES + 3);
        let out = head(&text);
        assert!(out.len() <= HEAD_BYTES);
        assert!(out.ends_with('\n'));
        assert!(!out.contains('\u{FFFD}'));
    }
}
