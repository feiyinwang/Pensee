//! Read-only access to Apple Books highlights. Per SPECs/apple-books-highlights-spec.md.
//!
//! Apple Books keeps highlights in a Core Data SQLite store inside its sandbox
//! container, and book titles in a second one. Both run in WAL mode while Books
//! is open, so they are copied (with their `-wal` files) into a temp directory
//! and read there: nothing here can lock or write Books' own files. Merging the
//! highlights into pages is the frontend's job, through the app's write path.

use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppleBookHighlight {
    /// Apple Books' annotation UUID: stable across edits and devices.
    pub id: String,
    pub text: String,
    pub note: Option<String>,
    /// Unix seconds.
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppleBook {
    pub asset_id: String,
    pub title: String,
    pub author: Option<String>,
    pub highlights: Vec<AppleBookHighlight>,
}

#[tauri::command]
pub async fn read_apple_books_highlights() -> Result<Vec<AppleBook>, AppError> {
    tauri::async_runtime::spawn_blocking(imp::read_highlights)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

/// Save the cover Apple Books shows for `asset_id` to `dest` as a JPEG.
/// Returns false when Books has no cover cached for the book. A file already
/// at `dest` is kept (the writer may have replaced it) and counts as saved.
#[tauri::command]
pub async fn save_apple_books_cover(asset_id: String, dest: String) -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(move || imp::save_cover(&asset_id, &dest))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    pub fn read_highlights() -> Result<Vec<AppleBook>, AppError> {
        Err(AppError::Io(
            "Apple Books is only available on macOS".into(),
        ))
    }

    pub fn save_cover(_asset_id: &str, _dest: &str) -> Result<bool, AppError> {
        Err(AppError::Io(
            "Apple Books is only available on macOS".into(),
        ))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use rusqlite::{Connection, OpenFlags};
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Core Data stores dates as seconds since 2001-01-01 UTC.
    const CORE_DATA_EPOCH_OFFSET: f64 = 978_307_200.0;

    fn books_documents_dir() -> Result<PathBuf, AppError> {
        let home =
            std::env::var_os("HOME").ok_or_else(|| AppError::Io("HOME is not set".into()))?;
        Ok(PathBuf::from(home).join("Library/Containers/com.apple.iBooksX/Data/Documents"))
    }

    /// Books caches covers as `BICDiskDataStore/<asset id>/<asset id>|1|<w>|<h>|0.<ext>`,
    /// one file per size; the largest one, if any.
    fn largest_cover(asset_id: &str) -> Result<Option<PathBuf>, AppError> {
        let home =
            std::env::var_os("HOME").ok_or_else(|| AppError::Io("HOME is not set".into()))?;
        let dir = PathBuf::from(home)
            .join("Library/Containers/com.apple.iBooksX/Data/Library/Caches/BCCoverCache-1/BICDiskDataStore")
            .join(asset_id);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(None);
        };
        Ok(entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter_map(|path| {
                let name = path.file_name()?.to_str()?.to_string();
                let parts: Vec<&str> = name.split('|').collect();
                let width: u64 = parts.get(2)?.parse().ok()?;
                let height: u64 = parts.get(3)?.parse().ok()?;
                Some((width * height, path))
            })
            .max_by_key(|(area, _)| *area)
            .map(|(_, path)| path))
    }

    pub fn save_cover(asset_id: &str, dest: &str) -> Result<bool, AppError> {
        // The id names a directory in Books' cache: nothing that could climb out.
        if asset_id.is_empty() || !asset_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(AppError::InvalidPath(asset_id.to_string()));
        }
        let dest = PathBuf::from(dest);
        if dest.exists() {
            return Ok(true);
        }
        let Some(source) = largest_cover(asset_id)? else {
            return Ok(false);
        };
        let dir = dest
            .parent()
            .ok_or_else(|| AppError::InvalidPath(dest.display().to_string()))?;
        fs::create_dir_all(dir)?;
        // Written beside the target, then renamed, so a half-written cover is
        // never at `dest`. Covers are HEIC as often as JPEG; `sips` (part of
        // macOS) turns either into a JPEG every viewer can show.
        let temp = dir.join(format!(".~{}.jpg", uuid::Uuid::new_v4()));
        let output = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg"])
            .arg(&source)
            .arg("--out")
            .arg(&temp)
            .output()?;
        if !output.status.success() || !temp.exists() {
            let _ = fs::remove_file(&temp);
            return Err(AppError::Io(format!(
                "Couldn't convert the cover of {asset_id}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        fs::rename(&temp, &dest)?;
        Ok(true)
    }

    /// The one `.sqlite` file in `dir` whose name starts with `prefix` (the
    /// version suffix in the name changes between macOS releases).
    fn find_store(dir: &Path, prefix: &str) -> Result<PathBuf, AppError> {
        let entries = fs::read_dir(dir).map_err(|e| {
            AppError::NotFound(format!(
                "Apple Books data at {} ({e}). Open Apple Books once, and allow Pensée to access data from other apps if macOS asks.",
                dir.display()
            ))
        })?;
        entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(prefix) && name.ends_with(".sqlite"))
            })
            .ok_or_else(|| AppError::NotFound(format!("{prefix}*.sqlite in {}", dir.display())))
    }

    /// Copy `store` and its WAL into `into`, returning the copy's path. The
    /// WAL holds every change Books has not checkpointed yet, i.e. recent
    /// highlights; `-shm` is rebuilt by SQLite on open.
    fn copy_store(store: &Path, into: &Path) -> Result<PathBuf, AppError> {
        let name = store
            .file_name()
            .ok_or_else(|| AppError::InvalidPath(store.display().to_string()))?;
        let target = into.join(name);
        fs::copy(store, &target)?;
        let mut wal = store.as_os_str().to_owned();
        wal.push("-wal");
        let wal = PathBuf::from(wal);
        if wal.exists() {
            let mut target_wal = target.as_os_str().to_owned();
            target_wal.push("-wal");
            fs::copy(&wal, PathBuf::from(target_wal))?;
        }
        Ok(target)
    }

    fn sql_err(error: rusqlite::Error) -> AppError {
        AppError::Io(format!("Apple Books database: {error}"))
    }

    /// Removes the temp copy however the read ends.
    struct TempDir(PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    pub fn read_highlights() -> Result<Vec<AppleBook>, AppError> {
        let documents = books_documents_dir()?;
        let annotations = find_store(&documents.join("AEAnnotation"), "AEAnnotation")?;
        let library = find_store(&documents.join("BKLibrary"), "BKLibrary")?;

        let temp = TempDir(
            std::env::temp_dir().join(format!("pensee-apple-books-{}", uuid::Uuid::new_v4())),
        );
        fs::create_dir_all(&temp.0)?;
        let annotations = copy_store(&annotations, &temp.0)?;
        let library = copy_store(&library, &temp.0)?;

        read_from(&annotations, &library)
    }

    /// Books with at least one highlight, in title order; each book's
    /// highlights in reading order. Exposed for tests on fixture stores.
    pub fn read_from(annotations: &Path, library: &Path) -> Result<Vec<AppleBook>, AppError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let library = Connection::open_with_flags(library, flags).map_err(sql_err)?;
        let mut titles: HashMap<String, (String, Option<String>)> = HashMap::new();
        {
            let mut statement = library
                .prepare("SELECT ZASSETID, ZTITLE, ZAUTHOR FROM ZBKLIBRARYASSET WHERE ZASSETID IS NOT NULL AND ZTITLE IS NOT NULL")
                .map_err(sql_err)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(sql_err)?;
            for row in rows {
                let (asset_id, title, author) = row.map_err(sql_err)?;
                titles.insert(asset_id, (title, author));
            }
        }

        let annotations = Connection::open_with_flags(annotations, flags).map_err(sql_err)?;
        let mut statement = annotations
            .prepare(
                "SELECT ZANNOTATIONASSETID, ZANNOTATIONUUID, ZANNOTATIONSELECTEDTEXT, ZANNOTATIONNOTE, ZANNOTATIONCREATIONDATE
                 FROM ZAEANNOTATION
                 WHERE ZANNOTATIONDELETED = 0
                   AND ZANNOTATIONUUID IS NOT NULL
                   AND length(trim(coalesce(ZANNOTATIONSELECTEDTEXT, ''))) > 0
                 ORDER BY ZANNOTATIONASSETID, ZPLLOCATIONRANGESTART, ZANNOTATIONCREATIONDATE",
            )
            .map_err(sql_err)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                ))
            })
            .map_err(sql_err)?;

        let mut books: Vec<AppleBook> = Vec::new();
        for row in rows {
            let (asset_id, id, text, note, created) = row.map_err(sql_err)?;
            // A highlight in a book no longer in the library has no title to
            // name a page after; it is left out rather than filed under an id.
            let Some((title, author)) = titles.get(&asset_id) else {
                continue;
            };
            if books.last().is_none_or(|book| book.asset_id != asset_id) {
                books.push(AppleBook {
                    asset_id: asset_id.clone(),
                    title: title.trim().to_string(),
                    author: author
                        .as_ref()
                        .map(|a| a.trim().to_string())
                        .filter(|a| !a.is_empty()),
                    highlights: Vec::new(),
                });
            }
            let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
            books
                .last_mut()
                .expect("pushed above")
                .highlights
                .push(AppleBookHighlight {
                    id,
                    text: text.trim().to_string(),
                    note,
                    created_at: created
                        .map_or(0, |seconds| (seconds + CORE_DATA_EPOCH_OFFSET) as i64),
                });
        }
        books.sort_by_key(|book| book.title.to_lowercase());
        Ok(books)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn fixture(dir: &Path) -> (PathBuf, PathBuf) {
            let annotations = dir.join("AEAnnotation_test.sqlite");
            let library = dir.join("BKLibrary_test.sqlite");
            let conn = Connection::open(&annotations).unwrap();
            conn.execute_batch(
                "CREATE TABLE ZAEANNOTATION (ZANNOTATIONASSETID VARCHAR, ZANNOTATIONUUID VARCHAR,
                   ZANNOTATIONSELECTEDTEXT VARCHAR, ZANNOTATIONNOTE VARCHAR, ZANNOTATIONCREATIONDATE TIMESTAMP,
                   ZANNOTATIONDELETED INTEGER, ZPLLOCATIONRANGESTART INTEGER);
                 INSERT INTO ZAEANNOTATION VALUES ('b1', 'u2', ' second ', NULL, 10, 0, 20);
                 INSERT INTO ZAEANNOTATION VALUES ('b1', 'u1', 'first', ' my note ', 0, 0, 10);
                 INSERT INTO ZAEANNOTATION VALUES ('b1', 'u3', 'gone', NULL, 0, 1, 30);
                 INSERT INTO ZAEANNOTATION VALUES ('b1', 'u4', NULL, 'bookmark', 0, 0, 40);
                 INSERT INTO ZAEANNOTATION VALUES ('b2', 'u5', 'orphan', NULL, 0, 0, 10);
                 INSERT INTO ZAEANNOTATION VALUES ('b3', 'u6', 'a', '', 0, 0, 10);",
            )
            .unwrap();
            let conn = Connection::open(&library).unwrap();
            conn.execute_batch(
                "CREATE TABLE ZBKLIBRARYASSET (ZASSETID VARCHAR, ZTITLE VARCHAR, ZAUTHOR VARCHAR);
                 INSERT INTO ZBKLIBRARYASSET VALUES ('b1', 'Zen Book', 'Ann');
                 INSERT INTO ZBKLIBRARYASSET VALUES ('b3', 'Atlas', '');",
            )
            .unwrap();
            (annotations, library)
        }

        #[test]
        fn reads_live_highlights_grouped_by_book_in_reading_order() {
            let dir = tempfile::tempdir().unwrap();
            let (annotations, library) = fixture(dir.path());
            let books = read_from(&annotations, &library).unwrap();

            assert_eq!(books.len(), 2, "orphaned book b2 is skipped");
            assert_eq!(books[0].title, "Atlas");
            assert_eq!(books[0].author, None);
            assert_eq!(
                books[0].highlights[0].note, None,
                "blank note reads as none"
            );

            let zen = &books[1];
            assert_eq!(zen.author.as_deref(), Some("Ann"));
            let ids: Vec<_> = zen.highlights.iter().map(|h| h.id.as_str()).collect();
            assert_eq!(
                ids,
                ["u1", "u2"],
                "deleted and text-less annotations are skipped"
            );
            assert_eq!(zen.highlights[0].note.as_deref(), Some("my note"));
            assert_eq!(zen.highlights[1].text, "second");
            assert_eq!(zen.highlights[1].created_at, 978_307_210);
        }
    }
}
