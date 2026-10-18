//! What the first-run onboarding needs from the Mac (SPECs/onboarding-spec.md):
//! the writer's Obsidian vaults, whether Claude Code is installed, and the
//! public-domain sample book.

use super::link_preview::client;
use crate::error::AppError;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// An Obsidian vault from Obsidian's own vault list.
#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVault {
    pub name: String,
    pub path: String,
    /// Markdown files in it, counted up to `NOTE_COUNT_CAP`.
    pub notes: usize,
}

/// Counting stops here: past it the number on the button says "10,000+".
const NOTE_COUNT_CAP: usize = 10_000;

/// The sample book: The Elements of Style (Strunk, 1920), public domain,
/// from Project Gutenberg. Fixed, so this command can't fetch anything else.
const SAMPLE_BOOK_URL: &str = "https://www.gutenberg.org/ebooks/37134.epub3.images";
const SAMPLE_BOOK_FILE: &str = "The Elements of Style (William Strunk).epub";
const MAX_BOOK_BYTES: usize = 32 * 1024 * 1024;

/// Obsidian's vault list, most recently opened first: `{"vaults": {id: {path, ts, open}}}`.
/// Vaults whose folder is gone are left out.
pub fn parse_obsidian_vaults(json: &str) -> Vec<(PathBuf, u64)> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(vaults) = value.get("vaults").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut found: Vec<(PathBuf, u64)> = vaults
        .values()
        .filter_map(|v| {
            let path = v.get("path")?.as_str()?;
            let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
            Some((PathBuf::from(path), ts))
        })
        .collect();
    found.sort_by_key(|v| std::cmp::Reverse(v.1));
    found
}

/// Markdown files under `dir`, skipping hidden folders (`.obsidian`, `.git`).
fn count_notes(dir: &Path) -> usize {
    let mut count = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if name.to_ascii_lowercase().ends_with(".md") {
                count += 1;
                if count >= NOTE_COUNT_CAP {
                    return count;
                }
            }
        }
    }
    count
}

fn obsidian_config() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PENSEE_OBSIDIAN_CONFIG") {
        return Some(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support/obsidian/obsidian.json"))
}

/// The writer's Obsidian vaults, newest first, each with its note count.
/// Empty when Obsidian isn't installed. `PENSEE_OBSIDIAN_CONFIG` points it at
/// another file (the e2e journeys).
#[tauri::command]
pub async fn obsidian_vaults() -> Result<Vec<ObsidianVault>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(config) = obsidian_config() else {
            return Vec::new();
        };
        let Ok(json) = std::fs::read_to_string(config) else {
            return Vec::new();
        };
        parse_obsidian_vaults(&json)
            .into_iter()
            .filter(|(path, _)| path.is_dir())
            .map(|(path, _)| ObsidianVault {
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                notes: count_notes(&path),
                path: path.to_string_lossy().into_owned(),
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))
}

/// Whether the `claude` binary can be found (the login shell's PATH and the
/// usual install places, as the Agent finds it).
#[tauri::command]
pub async fn claude_installed() -> bool {
    tauri::async_runtime::spawn_blocking(|| super::agent::claude_command().is_ok())
        .await
        .unwrap_or(false)
}

/// "Start a new folder": `~/Documents/Pensée`, made if it isn't there.
#[tauri::command]
pub fn create_starter_folder(app: tauri::AppHandle) -> Result<String, AppError> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join("Pensée");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Downloads the sample book into the app's cache and returns its path, for
/// `importBook` to copy into the vault. Reuses an earlier download.
#[tauri::command]
pub async fn download_sample_book(app: tauri::AppHandle) -> Result<String, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join("samples");
    let dest = dir.join(SAMPLE_BOOK_FILE);
    if dest.is_file() {
        return Ok(dest.to_string_lossy().into_owned());
    }
    let response = client()?
        .get(SAMPLE_BOOK_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Network(e.to_string()))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if bytes.len() > MAX_BOOK_BYTES || !bytes.starts_with(b"PK") {
        return Err(AppError::User(
            "The sample book didn't download. Try again, or open your own.".into(),
        ));
    }
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let partial = dir.join(format!("{SAMPLE_BOOK_FILE}.part"));
    std::fs::write(&partial, &bytes).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::rename(&partial, &dest).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vaults_come_newest_first() {
        let json = r#"{"vaults":{"a":{"path":"/old","ts":1},"b":{"path":"/new","ts":5,"open":true},"c":{"ts":9}}}"#;
        let vaults = parse_obsidian_vaults(json);
        assert_eq!(
            vaults,
            vec![(PathBuf::from("/new"), 5), (PathBuf::from("/old"), 1)]
        );
    }

    #[test]
    fn a_broken_list_is_empty() {
        assert!(parse_obsidian_vaults("not json").is_empty());
        assert!(parse_obsidian_vaults("{}").is_empty());
    }

    #[test]
    fn counts_markdown_but_not_hidden_folders() {
        let dir = std::env::temp_dir().join(format!("pensee-count-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".obsidian")).unwrap();
        std::fs::create_dir_all(dir.join("Notes")).unwrap();
        std::fs::write(dir.join("a.md"), "").unwrap();
        std::fs::write(dir.join("Notes/b.md"), "").unwrap();
        std::fs::write(dir.join("Notes/c.png"), "").unwrap();
        std::fs::write(dir.join(".obsidian/d.md"), "").unwrap();
        assert_eq!(count_notes(&dir), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
