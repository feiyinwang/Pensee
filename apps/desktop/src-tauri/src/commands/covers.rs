//! "Get cover" for a Library note (SPECs/spaces-spec.md): download a picture
//! from the web into the note's `<stem>-assets` folder, so the note's `Cover:`
//! can point at a local file and the vault stays plain markdown.

use super::link_preview::{client, fetch_link_preview};
use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Covers are thumbnails and artwork; anything larger is not one.
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// Save the cover at `url` beside `markdown_file_path`, as
/// `<stem>-assets/cover.<ext>`, and return that path relative to the note's
/// folder. `url` may be the image itself (a YouTube thumbnail) or a page whose
/// Open Graph image is the cover (a podcast's page). An existing `cover.*` is
/// kept and the new one gets the next free name (`cover-2.jpg`).
#[tauri::command]
pub async fn save_web_cover(url: String, markdown_file_path: String) -> Result<String, AppError> {
    let preview = fetch_link_preview(url).await?;
    let image_url = preview
        .image
        .ok_or_else(|| AppError::User("That page has no cover image.".into()))?;

    let mut response = client()?
        .get(&image_url)
        .header(reqwest::header::ACCEPT, "image/*")
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ext = image_extension(&content_type)
        .ok_or_else(|| AppError::User(format!("The cover isn't a picture ({content_type}).")))?;

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(AppError::User("The cover image is too large.".into()));
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        write_cover(Path::new(&markdown_file_path), ext, &bytes)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// The file extension for an image response's `Content-Type`, or None when it
/// is not a picture the editor can show.
pub fn image_extension(content_type: &str) -> Option<&'static str> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    Some(match mime.as_str() {
        "image/jpeg" | "image/jpg" | "image/pjpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        _ => return None,
    })
}

pub fn write_cover(md_path: &Path, ext: &str, bytes: &[u8]) -> Result<String, AppError> {
    write_asset(md_path, "cover", ext, bytes)
}

/// Save `bytes` in the note's `<stem>-assets` folder as `<base>.<ext>`, or
/// `<base>-<n>.<ext>` for the first n whose name no file of any extension
/// has, and return that path relative to the note's folder.
pub fn write_asset(
    md_path: &Path,
    base: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<String, AppError> {
    let dir = md_path
        .parent()
        .ok_or_else(|| AppError::Io("No parent directory".into()))?;
    let stem = md_path
        .file_stem()
        .ok_or_else(|| AppError::Io("No file stem".into()))?
        .to_string_lossy();
    let assets = format!("{stem}-assets");
    let assets_dir = dir.join(&assets);
    std::fs::create_dir_all(&assets_dir)?;
    let name = free_name(&assets_dir, base, ext);
    std::fs::write(assets_dir.join(&name), bytes)?;
    Ok(format!("{assets}/{name}"))
}

fn free_name(dir: &Path, base: &str, ext: &str) -> String {
    let taken = |name: &str| -> bool {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| PathBuf::from(entry.file_name()).file_stem() == Some(name.as_ref()))
    };
    let mut n = 1;
    loop {
        let name = if n == 1 {
            base.to_string()
        } else {
            format!("{base}-{n}")
        };
        if !taken(&name) {
            return format!("{name}.{ext}");
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn image_extension_reads_the_mime_type() {
        assert_eq!(image_extension("image/jpeg"), Some("jpg"));
        assert_eq!(image_extension("Image/PNG; charset=binary"), Some("png"));
        assert_eq!(image_extension("image/webp"), Some("webp"));
        assert_eq!(image_extension("text/html"), None);
        assert_eq!(image_extension(""), None);
    }

    #[test]
    fn write_cover_saves_into_the_notes_assets_folder() {
        let tmp = TempDir::new().unwrap();
        let note = tmp.path().join("My video.md");
        std::fs::write(&note, "").unwrap();
        let rel = write_cover(&note, "jpg", b"jpeg").unwrap();
        assert_eq!(rel, "My video-assets/cover.jpg");
        assert_eq!(std::fs::read(tmp.path().join(&rel)).unwrap(), b"jpeg");
    }

    #[test]
    fn write_cover_keeps_an_existing_cover() {
        let tmp = TempDir::new().unwrap();
        let note = tmp.path().join("Show.md");
        std::fs::create_dir_all(tmp.path().join("Show-assets")).unwrap();
        std::fs::write(tmp.path().join("Show-assets/cover.png"), b"old").unwrap();
        let rel = write_cover(&note, "jpg", b"new").unwrap();
        assert_eq!(rel, "Show-assets/cover-2.jpg");
        assert_eq!(
            std::fs::read(tmp.path().join("Show-assets/cover.png")).unwrap(),
            b"old"
        );
    }
}
