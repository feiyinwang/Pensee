//! Talk notes (SPECs/talk-notes-spec.md): a take recorded in a note is saved
//! as an audio file in `Recordings/` at the workspace root. The web view
//! records it (MediaRecorder) and sends the bytes as the raw body of one IPC
//! call, so a long take never goes through JSON.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;

use crate::error::AppError;
use crate::state::AppState;

/// The folder every take goes in, at the workspace root.
pub const RECORDINGS_DIR: &str = "Recordings";
const AUDIO_EXTENSIONS: [&str; 5] = ["m4a", "mp4", "webm", "ogg", "wav"];

/// Where a new take goes: `Recordings/<stem>.<ext>`, or `<stem> (2).<ext>`,
/// `(3)`… when a take of that name is already there (a Continue in the same
/// minute). The stem is the app's (date and time); anything that could leave
/// the folder is refused.
pub fn next_recording_path(root: &Path, stem: &str, ext: &str) -> Result<PathBuf, AppError> {
    if stem.is_empty() || stem.contains(['/', '\\']) || stem.starts_with('.') {
        return Err(AppError::InvalidPath(stem.to_string()));
    }
    if !AUDIO_EXTENSIONS.contains(&ext) {
        return Err(AppError::InvalidPath(format!("{stem}.{ext}")));
    }
    let dir = root.join(RECORDINGS_DIR);
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    Ok(path)
}

/// Writes the take and returns its workspace-relative path with `/`
/// separators, as the note embeds it: `Recordings/2026-10-25 09.14.m4a`.
pub fn save_recording_impl(
    root: &Path,
    stem: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<String, AppError> {
    if bytes.is_empty() {
        return Err(AppError::User("The recording was empty.".into()));
    }
    let path = next_recording_path(root, stem, ext)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&path, bytes)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(format!("{RECORDINGS_DIR}/{name}"))
}

/// The workspace open in the window that called.
fn window_root(webview: &tauri::Webview, app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let root = state.workspace_root.read().clone();
    root.ok_or(AppError::NoWorkspace)
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, AppError> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::User(format!("Missing {name} for the recording.")))
}

/// Body: the audio bytes. Headers: `x-stem` (percent-encoded, it may hold
/// spaces) and `x-ext`.
#[tauri::command]
pub async fn save_recording(
    request: Request<'_>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::User(
            "The recording arrived in the wrong form.".into(),
        ));
    };
    let stem = percent_encoding::percent_decode_str(header(&request, "x-stem")?)
        .decode_utf8()
        .map_err(|_| AppError::InvalidPath("x-stem".into()))?
        .to_string();
    let ext = header(&request, "x-ext")?.to_ascii_lowercase();
    let root = window_root(&webview, &app)?;
    let bytes = bytes.clone();
    tokio::task::spawn_blocking(move || save_recording_impl(&root, &stem, &ext, &bytes))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_into_recordings_and_numbers_a_second_take() {
        let dir = tempfile_dir();
        let first = save_recording_impl(&dir, "2026-10-25 09.14", "m4a", b"abc").unwrap();
        assert_eq!(first, "Recordings/2026-10-25 09.14.m4a");
        assert_eq!(fs::read(dir.join(&first)).unwrap(), b"abc");
        let second = save_recording_impl(&dir, "2026-10-25 09.14", "m4a", b"def").unwrap();
        assert_eq!(second, "Recordings/2026-10-25 09.14 (2).m4a");
    }

    #[test]
    fn refuses_paths_that_leave_the_folder_and_odd_extensions() {
        let dir = tempfile_dir();
        assert!(save_recording_impl(&dir, "../escape", "m4a", b"x").is_err());
        assert!(save_recording_impl(&dir, ".hidden", "m4a", b"x").is_err());
        assert!(save_recording_impl(&dir, "take", "exe", b"x").is_err());
        assert!(save_recording_impl(&dir, "take", "m4a", b"").is_err());
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pensee-talk-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
