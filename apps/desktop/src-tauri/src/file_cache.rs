//! Something parsed from each note, kept by path and keyed on the file's
//! (modified nanos, size), in memory and on disk in the app's cache folder.
//!
//! Why on disk: on an iCloud vault most notes are evicted ("Optimize Mac
//! Storage"), so opening one downloads it and can take seconds, while a
//! `stat` stays instant. With the cache a launch only stats each note and
//! reads the ones that changed. Paths are absolute, so windows on different
//! workspaces share one cache without colliding.

use crate::state::IndexedFile;
use parking_lot::Mutex;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// How often a long scan saves what it has read so far, so quitting mid-scan
/// keeps the progress.
const CHECKPOINT_EVERY: Duration = Duration::from_secs(20);

/// (modified nanos, size, value) by absolute path.
type Entries<T> = HashMap<PathBuf, (u128, u64, Arc<T>)>;

pub struct FileCache<T> {
    /// The cache's file name in the app cache folder.
    name: &'static str,
    /// Bumped when `T` changes shape: an older file is ignored.
    version: u32,
    entries: Mutex<Entries<T>>,
    /// Set once by `open`; None when there is no cache folder.
    file: OnceLock<Option<PathBuf>>,
    /// Set when memory has entries the file doesn't.
    dirty: AtomicBool,
    saved_at: Mutex<Option<Instant>>,
    saving: Mutex<()>,
}

#[derive(Serialize, Deserialize)]
struct SavedCache<T> {
    version: u32,
    entries: Vec<SavedEntry<T>>,
}

#[derive(Serialize, Deserialize)]
struct SavedEntry<T> {
    path: PathBuf,
    modified: u128,
    size: u64,
    /// `meta` in note-meta.json files written before this module existed.
    #[serde(alias = "meta")]
    value: T,
}

impl<T: Serialize + DeserializeOwned + Send + Sync> FileCache<T> {
    pub fn new(name: &'static str, version: u32) -> Self {
        Self {
            name,
            version,
            entries: Mutex::new(HashMap::new()),
            file: OnceLock::new(),
            dirty: AtomicBool::new(false),
            saved_at: Mutex::new(None),
            saving: Mutex::new(()),
        }
    }

    /// Load the saved cache from `cache_dir` the first time; later calls do
    /// nothing. Entries already in memory win: they were read this run. A
    /// missing file is a first launch; an unreadable one is logged and
    /// ignored, since every entry can be read again.
    pub fn open(&self, cache_dir: Option<&Path>) {
        let mut opened = false;
        let file = self.file.get_or_init(|| {
            opened = true;
            cache_dir.map(|dir| dir.join(self.name))
        });
        if opened {
            if let Some(file) = file {
                self.load(file);
            }
        }
    }

    fn load(&self, file: &Path) {
        let bytes = match std::fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                eprintln!("{}: can't read {}: {error}", self.name, file.display());
                return;
            }
        };
        let saved: SavedCache<T> = match serde_json::from_slice(&bytes) {
            Ok(saved) => saved,
            Err(error) => {
                eprintln!("{}: ignoring {}: {error}", self.name, file.display());
                return;
            }
        };
        if saved.version != self.version {
            return;
        }
        let mut entries = self.entries.lock();
        for entry in saved.entries {
            entries.entry(entry.path).or_insert((
                entry.modified,
                entry.size,
                Arc::new(entry.value),
            ));
        }
    }

    /// The value for `path`: from the cache when the file is unchanged, else
    /// `read` from the file itself (and saved now and then, mid-scan). None
    /// when the file is gone or `read` gives nothing.
    pub fn get(&self, path: &Path, read: impl FnOnce(&Path) -> Option<T>) -> Option<Arc<T>> {
        let metadata = std::fs::metadata(path).ok()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let size = metadata.len();
        if let Some((m, s, value)) = self.entries.lock().get(path) {
            if *m == modified && *s == size {
                return Some(Arc::clone(value));
            }
        }
        let value = Arc::new(read(path)?);
        self.entries
            .lock()
            .insert(path.to_path_buf(), (modified, size, Arc::clone(&value)));
        self.dirty.store(true, Ordering::Relaxed);
        if self
            .saved_at
            .lock()
            .is_none_or(|at| at.elapsed() >= CHECKPOINT_EVERY)
        {
            self.save();
        }
        Some(value)
    }

    /// The value cached for `path`, whether or not the file changed since;
    /// opens nothing.
    pub fn cached(&self, path: &Path) -> Option<Arc<T>> {
        self.entries.lock().get(path).map(|(_, _, v)| Arc::clone(v))
    }

    /// Write the cache to disk when it has changed. One writer at a time: a
    /// save that finds another running skips.
    pub fn save(&self) {
        let Some(_saving) = self.saving.try_lock() else {
            return;
        };
        *self.saved_at.lock() = Some(Instant::now());
        let Some(Some(file)) = self.file.get() else {
            return;
        };
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        // Copy out the Arcs, so the map isn't locked while writing.
        let held: Vec<(PathBuf, u128, u64, Arc<T>)> = self
            .entries
            .lock()
            .iter()
            .map(|(p, (m, s, v))| (p.clone(), *m, *s, Arc::clone(v)))
            .collect();
        self.write(file, held);
    }

    fn write(&self, file: &Path, held: Vec<(PathBuf, u128, u64, Arc<T>)>) {
        let saved = SavedCache {
            version: self.version,
            entries: held
                .iter()
                .map(|(path, modified, size, value)| SavedEntry {
                    path: path.clone(),
                    modified: *modified,
                    size: *size,
                    value: &**value,
                })
                .collect(),
        };
        let result = (|| -> std::io::Result<()> {
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = file.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec(&saved)?)?;
            std::fs::rename(&tmp, file)
        })();
        if let Err(error) = result {
            self.dirty.store(true, Ordering::Relaxed);
            eprintln!("{}: can't write {}: {error}", self.name, file.display());
        }
    }

    /// Drop entries of notes that are gone, so the file on disk doesn't grow
    /// forever. Entries `files` doesn't list may belong to another window's
    /// workspace, so only a missing file removes one.
    pub fn prune(&self, files: &[IndexedFile]) {
        let listed: HashSet<&Path> = files.iter().map(|f| f.path.as_path()).collect();
        let unlisted: Vec<PathBuf> = self
            .entries
            .lock()
            .keys()
            .filter(|path| !listed.contains(path.as_path()))
            .cloned()
            .collect();
        let gone: Vec<PathBuf> = unlisted.into_iter().filter(|p| !p.exists()).collect();
        if gone.is_empty() {
            return;
        }
        let mut entries = self.entries.lock();
        for path in gone {
            entries.remove(&path);
        }
        self.dirty.store(true, Ordering::Relaxed);
    }

    #[cfg(test)]
    pub fn forget(&self, path: &Path) -> bool {
        self.entries.lock().remove(path).is_some()
    }

    #[cfg(test)]
    pub fn reload(&self) {
        if let Some(Some(file)) = self.file.get() {
            self.load(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn survives_a_restart_and_rereads_only_changed_files() {
        let dir = std::env::temp_dir().join(format!("pensee-file-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let note = dir.join("note.md");
        std::fs::write(&note, "one").unwrap();
        let cache: FileCache<String> = FileCache::new("test-cache.json", 1);
        cache.open(Some(&dir));
        let reads = std::sync::atomic::AtomicUsize::new(0);
        let read = |path: &Path| {
            reads.fetch_add(1, Ordering::Relaxed);
            std::fs::read_to_string(path).ok()
        };
        assert_eq!(*cache.get(&note, read).unwrap(), "one");
        assert_eq!(*cache.get(&note, read).unwrap(), "one");
        assert_eq!(reads.load(Ordering::Relaxed), 1);
        cache.save();

        // A new launch: nothing in memory until the file is loaded.
        assert!(cache.forget(&note));
        cache.reload();
        assert_eq!(*cache.get(&note, read).unwrap(), "one");
        assert_eq!(reads.load(Ordering::Relaxed), 1);

        // A changed note is read again.
        std::fs::write(&note, "two!").unwrap();
        assert_eq!(*cache.get(&note, read).unwrap(), "two!");
        assert_eq!(reads.load(Ordering::Relaxed), 2);

        // A deleted note leaves the cache.
        std::fs::remove_file(&note).unwrap();
        cache.prune(&[]);
        assert!(cache.cached(&note).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
