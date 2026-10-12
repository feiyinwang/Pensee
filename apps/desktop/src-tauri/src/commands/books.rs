//! Book files (PDF, EPUB) brought into the workspace beside their book page.
//! See SPECs/book-reader-spec.md.

use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Copy `source` into `dir` as `<stem>.<ext>`, or `<stem> 2.<ext>`, `<stem> 3.<ext>`…
/// when the name is taken. The name is claimed with `create_new`, so two
/// imports never pick the same file and an existing file is never overwritten.
/// Returns the new file's path.
pub fn import_book_impl(source: &Path, dir: &Path, stem: &str) -> Result<PathBuf, AppError> {
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| e == "pdf" || e == "epub")
        .ok_or_else(|| AppError::Io("Only PDF and EPUB books can be imported".into()))?;
    if stem.is_empty() || stem.contains('/') || stem.contains('\\') {
        return Err(AppError::Io(format!("Invalid book name: {stem}")));
    }
    fs::create_dir_all(dir)?;
    let mut input = fs::File::open(source)?;
    for n in 1..1000 {
        let name = if n == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} {n}.{ext}")
        };
        let dest = dir.join(name);
        let mut output = match OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        if let Err(error) = io::copy(&mut input, &mut output) {
            drop(output);
            let _ = fs::remove_file(&dest);
            return Err(error.into());
        }
        return Ok(dest);
    }
    Err(AppError::AlreadyExists(
        dir.join(stem).to_string_lossy().to_string(),
    ))
}

#[tauri::command]
pub async fn import_book(
    source_path: String,
    dir: String,
    stem: String,
) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        import_book_impl(Path::new(&source_path), Path::new(&dir), &stem)
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_and_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("in.PDF");
        fs::write(&source, b"%PDF-1.7").unwrap();
        let dir = tmp.path().join("Books");
        let first = import_book_impl(&source, &dir, "Atomic Habits").unwrap();
        let second = import_book_impl(&source, &dir, "Atomic Habits").unwrap();
        assert_eq!(first, dir.join("Atomic Habits.pdf"));
        assert_eq!(second, dir.join("Atomic Habits 2.pdf"));
        assert_eq!(fs::read(&second).unwrap(), b"%PDF-1.7");
    }

    #[test]
    fn refuses_other_files() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("notes.txt");
        fs::write(&source, b"x").unwrap();
        assert!(import_book_impl(&source, tmp.path(), "x").is_err());
    }
}
