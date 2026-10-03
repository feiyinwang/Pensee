use crate::error::AppError;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ImageSaveResult {
    pub relative_path: String,
    pub absolute_path: String,
}

#[tauri::command]
pub fn save_clipboard_image(
    markdown_file_path: String,
    image_data: Vec<u8>,
    format: String,
) -> Result<ImageSaveResult, AppError> {
    save_clipboard_image_impl(&markdown_file_path, &image_data, &format)
}

/// Copy a file that was dragged into the window (from Finder, the sidebar,
/// anywhere) into the note's assets folder. Reading the bytes here rather than
/// in the webview avoids two problems: the CSP's `connect-src` (which falls
/// back to `default-src 'self'` and so blocks `fetch()` of an `asset://` URL),
/// and marshalling several megabytes through IPC as a JSON number array.
#[tauri::command]
pub fn import_image_file(
    markdown_file_path: String,
    source_path: String,
) -> Result<ImageSaveResult, AppError> {
    let source = PathBuf::from(&source_path);
    let format = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".to_string());
    let bytes = fs::read(&source)?;
    save_clipboard_image_impl(&markdown_file_path, &bytes, &format)
}

pub fn save_clipboard_image_impl(
    markdown_file_path: &str,
    image_data: &[u8],
    format: &str,
) -> Result<ImageSaveResult, AppError> {
    let md_path = PathBuf::from(markdown_file_path);
    let md_dir = md_path
        .parent()
        .ok_or_else(|| AppError::Io("No parent directory".into()))?;
    let md_stem = md_path
        .file_stem()
        .ok_or_else(|| AppError::Io("No file stem".into()))?
        .to_string_lossy()
        .to_string();

    // Create {stem}-assets directory
    let assets_dir_name = format!("{}-assets", md_stem);
    let assets_dir = md_dir.join(&assets_dir_name);
    fs::create_dir_all(&assets_dir)?;

    // Generate filename: {YYYYMMDD}-{HHMMSS}-{4-char-uuid}.{format}
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Simple date/time formatting from epoch
    let (year, month, day, hour, min, sec) = epoch_to_datetime(secs);
    let short_uuid = &uuid::Uuid::new_v4().to_string()[..4];
    let ext = match format {
        "jpeg" | "jpg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        "avif" => "avif",
        "bmp" => "bmp",
        "svg" => "svg",
        // A board is an SVG whose scene rides along as metadata; the double
        // extension is how Writer tells it apart from a plain picture.
        "board.svg" => "board.svg",
        "heic" => "heic",
        "heif" => "heif",
        _ => "png",
    };
    let filename = format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}-{}.{}",
        year, month, day, hour, min, sec, short_uuid, ext
    );

    let abs_path = assets_dir.join(&filename);
    fs::write(&abs_path, image_data)?;

    let relative_path = format!("{}/{}", assets_dir_name, filename);

    Ok(ImageSaveResult {
        relative_path,
        absolute_path: abs_path.to_string_lossy().to_string(),
    })
}

/// Read a local file as a `data:` URL. Boards embed their pictures this way in
/// the rendered SVG layer, because an SVG shown through `<img>` (which is how
/// GitHub, Obsidian and every other markdown app show it) may not load any
/// outside resource. The CSP keeps the webview from `fetch()`ing `asset://`,
/// so the bytes have to come through here.
#[tauri::command]
pub fn read_file_data_url(path: String) -> Result<String, AppError> {
    read_file_data_url_impl(&path)
}

pub fn read_file_data_url_impl(path: &str) -> Result<String, AppError> {
    use base64::Engine;
    let file_path = PathBuf::from(path);
    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        _ => "application/octet-stream",
    };
    let bytes = fs::read(&file_path)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

fn epoch_to_datetime(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    // Simple epoch to date conversion (good enough for filenames)
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hour = time_of_day / 3600;
    let min = (time_of_day % 3600) / 60;
    let sec = time_of_day % 60;

    // Calculate year, month, day from days since epoch
    let mut y = 1970;
    let mut remaining = days;

    loop {
        let days_in_year = if is_leap_year(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }

    let days_in_months: [u64; 12] = if is_leap_year(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut m = 0;
    for (i, &days_in_month) in days_in_months.iter().enumerate() {
        if remaining < days_in_month {
            m = i as u64 + 1;
            break;
        }
        remaining -= days_in_month;
    }

    let d = remaining + 1;
    (y, m, d, hour, min, sec)
}

fn is_leap_year(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_md_file() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let md_path = dir.path().join("note.md");
        fs::write(&md_path, "# Note").unwrap();
        (dir, md_path)
    }

    #[test]
    fn test_save_creates_assets_directory() {
        let (dir, md_path) = setup_md_file();
        save_clipboard_image_impl(
            &md_path.to_string_lossy(),
            &[0x89, 0x50, 0x4E, 0x47], // PNG magic bytes
            "png",
        )
        .unwrap();

        let assets_dir = dir.path().join("note-assets");
        assert!(assets_dir.exists());
        assert!(assets_dir.is_dir());
    }

    #[test]
    fn test_save_returns_relative_path() {
        let (_dir, md_path) = setup_md_file();
        let result =
            save_clipboard_image_impl(&md_path.to_string_lossy(), &[1, 2, 3], "png").unwrap();

        assert!(result.relative_path.starts_with("note-assets/"));
        assert!(result.relative_path.ends_with(".png"));
    }

    #[test]
    fn test_save_filename_format() {
        let (_dir, md_path) = setup_md_file();
        let result =
            save_clipboard_image_impl(&md_path.to_string_lossy(), &[1, 2, 3], "png").unwrap();

        let filename = result.relative_path.strip_prefix("note-assets/").unwrap();
        // Format: YYYYMMDD-HHMMSS-XXXX.png
        let re = regex_lite::Regex::new(r"^\d{8}-\d{6}-[a-f0-9]{4}\.png$").unwrap();
        assert!(
            re.is_match(filename),
            "Filename '{}' does not match expected format",
            filename
        );
    }

    #[test]
    fn test_save_board_svg_keeps_double_extension() {
        let (_dir, md_path) = setup_md_file();
        let result =
            save_clipboard_image_impl(&md_path.to_string_lossy(), b"<svg/>", "board.svg").unwrap();
        assert!(result.relative_path.ends_with(".board.svg"));
    }

    #[test]
    fn test_read_file_data_url_encodes_with_mime() {
        let (dir, _md_path) = setup_md_file();
        let png = dir.path().join("a.png");
        fs::write(&png, [1u8, 2, 3]).unwrap();
        let url = read_file_data_url_impl(&png.to_string_lossy()).unwrap();
        assert_eq!(url, "data:image/png;base64,AQID");
    }

    #[test]
    fn test_save_preserves_image_data() {
        let (dir, md_path) = setup_md_file();
        let data = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let result = save_clipboard_image_impl(&md_path.to_string_lossy(), &data, "png").unwrap();

        let saved = fs::read(dir.path().join(&result.relative_path)).unwrap();
        assert_eq!(saved, data);
    }
}
