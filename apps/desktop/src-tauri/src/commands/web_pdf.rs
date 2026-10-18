//! A paper's PDF from the web (SPECs/add-to-library-spec.md): downloaded into
//! the note's `<stem>-assets` folder, so the note can embed it and the reader
//! opens it like any PDF in the vault.

use super::covers::write_asset;
use super::link_preview::client;
use crate::error::AppError;
use std::path::Path;
use std::time::Duration;

/// Papers run to tens of MB; anything far past that is not one.
const MAX_PDF_BYTES: usize = 200 * 1024 * 1024;
/// The shared client gives up after 10s, which a large PDF on a slow line
/// needs longer than.
const PDF_TIMEOUT: Duration = Duration::from_secs(120);

/// Save the PDF at `url` beside `markdown_file_path` as
/// `<stem>-assets/<name>.pdf` (`<name>-2.pdf` when taken) and return that
/// path relative to the note's folder. A response that isn't a PDF (a
/// paywall's sign-in page) is refused rather than saved as one.
#[tauri::command]
pub async fn save_web_pdf(
    url: String,
    markdown_file_path: String,
    name: String,
) -> Result<String, AppError> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(AppError::User(format!("\"{name}\" can't name a file.")));
    }
    let mut response = client()?
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/pdf")
        .timeout(PDF_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_PDF_BYTES {
            return Err(AppError::User("The PDF is too large.".into()));
        }
    }
    if !is_pdf(&bytes) {
        return Err(AppError::User(
            "The link didn't give a PDF (it may need a sign-in).".into(),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        write_asset(Path::new(&markdown_file_path), &name, "pdf", &bytes)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// A PDF starts with `%PDF-`, after at most a little leading junk (the spec
/// allows it within the first 1024 bytes).
fn is_pdf(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)]
        .windows(5)
        .any(|w| w == b"%PDF-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_pdf_reads_the_header() {
        assert!(is_pdf(b"%PDF-1.7\n..."));
        assert!(is_pdf(b"\xef\xbb\xbf%PDF-1.4"));
        assert!(!is_pdf(b"<!doctype html><title>Sign in</title>"));
        assert!(!is_pdf(b""));
    }
}
