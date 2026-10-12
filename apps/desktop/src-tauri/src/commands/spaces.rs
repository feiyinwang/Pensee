use crate::error::AppError;
use crate::state::{AppState, IndexedFile};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Once};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// A markdown note that declares a `Type:` in its frontmatter — what a space
/// lists (SPECs/spaces-spec.md). Properties are the top-level scalar keys,
/// lower-cased; a list value is joined with ", ".
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TypedNote {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub title: Option<String>,
    pub note_type: String,
    pub modified_at: u64,
    pub properties: BTreeMap<String, String>,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct NoteMeta {
    properties: BTreeMap<String, String>,
    title: Option<String>,
    excerpt: Option<String>,
}

/// Head of a file worth reading: enough for any real frontmatter and the
/// first paragraph of text after it.
const HEAD_BYTES: usize = 8192;
const EXCERPT_MAX_CHARS: usize = 400;

/// Parsed heads by path, keyed on (modified nanos, size) so a repeat call only
/// re-reads files that changed. Paths are absolute, so windows on different
/// workspaces never collide.
type MetaCache = HashMap<PathBuf, (u128, u64, Arc<NoteMeta>)>;
static META_CACHE: LazyLock<Mutex<MetaCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// The meta cache is also kept on disk, so a launch only `stat`s each note
/// instead of opening it. On an iCloud vault mid-sync an open can take
/// seconds while a stat stays instant: without this, every launch reread all
/// heads and Library stayed empty for the twenty-odd minutes that took.
const META_CACHE_FILE: &str = "note-meta.json";
const META_CACHE_VERSION: u32 = 1;
/// How often a long scan saves what it has read so far, so quitting mid-scan
/// keeps the progress.
const META_CACHE_CHECKPOINT: Duration = Duration::from_secs(20);
static META_CACHE_LOADED: Once = Once::new();
/// Set when the in-memory cache has entries the file doesn't.
static META_CACHE_DIRTY: AtomicBool = AtomicBool::new(false);
static META_CACHE_SAVED_AT: LazyLock<Mutex<Instant>> = LazyLock::new(|| Mutex::new(Instant::now()));

#[derive(Serialize, Deserialize)]
struct MetaCacheFile {
    version: u32,
    entries: Vec<MetaCacheEntry>,
}

#[derive(Serialize, Deserialize)]
struct MetaCacheEntry {
    path: PathBuf,
    modified: u128,
    size: u64,
    meta: NoteMeta,
}

/// One `list_typed_notes` scan at a time. A scan reads every note on up to 8
/// threads; when reads stall (an iCloud vault mid-sync), the rereads asked for
/// after each file change overlapped until the app hit macOS's 4096 threads
/// per process and aborted. Waiting on an async lock holds no thread.
static SCAN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Sent while a long scan runs, at most every `PROGRESS_EVERY`, so a space
/// waiting on it can paint the notes read so far (`cached_only`).
const NOTES_READ_EVENT: &str = "spaces:notes-read";
const PROGRESS_EVERY: Duration = Duration::from_secs(2);

/// Every indexed note whose `Type` is one of `types` (case-insensitive), newest
/// edit first. Reads in parallel off the UI thread, one scan at a time.
///
/// With `cached_only`, opens no file and takes no lock: it answers at once
/// from the heads read so far, this launch or an earlier one, which may be
/// stale. A space shows that while the first scan of an iCloud vault takes
/// minutes, instead of nothing.
#[tauri::command]
pub async fn list_typed_notes(
    types: Vec<String>,
    cached_only: Option<bool>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<TypedNote>, AppError> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let cache_file = match app.path().app_cache_dir() {
        Ok(dir) => Some(dir.join(META_CACHE_FILE)),
        Err(error) => {
            eprintln!("list_typed_notes: no cache dir, heads are not kept on disk: {error}");
            None
        }
    };
    let load = move |cache_file: &Option<PathBuf>| {
        if let Some(file) = cache_file {
            META_CACHE_LOADED.call_once(|| load_meta_cache(file));
        }
    };
    let state = app.state::<AppState>().get_or_create(webview.label());
    if cached_only == Some(true) {
        let files: Vec<IndexedFile> = state.file_index.read().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            load(&cache_file);
            Ok(cached_typed_notes(&files, &types))
        })
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    }
    let _scan = SCAN.lock().await;
    // Read after the wait, so a queued scan sees the latest index.
    let files: Vec<IndexedFile> = state.file_index.read().clone();
    tauri::async_runtime::spawn_blocking(move || {
        load(&cache_file);
        let emitted_at = Mutex::new(Instant::now());
        let checkpoint = || {
            {
                let mut at = emitted_at.lock();
                if at.elapsed() >= PROGRESS_EVERY {
                    *at = Instant::now();
                    let _ = app.emit(NOTES_READ_EVENT, ());
                }
            }
            if let Some(file) = &cache_file {
                if META_CACHE_SAVED_AT.lock().elapsed() >= META_CACHE_CHECKPOINT {
                    save_meta_cache(file);
                }
            }
        };
        let notes = list_typed_notes_impl(&files, &types, &checkpoint);
        prune_meta_cache(&files);
        if let Some(file) = &cache_file {
            save_meta_cache(file);
        }
        Ok(notes)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// The notes of `types` among `files` whose heads are already cached; opens
/// nothing.
fn cached_typed_notes(files: &[IndexedFile], types: &[String]) -> Vec<TypedNote> {
    let wanted = wanted_types(types);
    let cache = META_CACHE.lock();
    let mut out: Vec<TypedNote> = files
        .iter()
        .filter_map(|file| {
            let (_, _, meta) = cache.get(&file.path)?;
            note_from_meta(file, meta, &wanted)
        })
        .collect();
    drop(cache);
    sort_notes(&mut out);
    out
}

fn wanted_types(types: &[String]) -> Vec<String> {
    types.iter().map(|t| t.trim().to_lowercase()).collect()
}

fn sort_notes(notes: &mut [TypedNote]) {
    notes.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
}

/// `checkpoint` runs after each head read from the file itself (a cache
/// miss), from the scan's worker threads.
pub fn list_typed_notes_impl(
    files: &[IndexedFile],
    types: &[String],
    checkpoint: &(dyn Fn() + Sync),
) -> Vec<TypedNote> {
    let wanted = wanted_types(types);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let chunk = files.len().div_ceil(threads).max(1);
    let mut out: Vec<TypedNote> = std::thread::scope(|scope| {
        let workers: Vec<_> = files
            .chunks(chunk)
            .map(|part| {
                let wanted = &wanted;
                scope.spawn(move || {
                    part.iter()
                        .filter_map(|file| typed_note(file, wanted, checkpoint))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().unwrap_or_default())
            .collect()
    });
    sort_notes(&mut out);
    out
}

fn typed_note(
    file: &IndexedFile,
    wanted: &[String],
    checkpoint: &(dyn Fn() + Sync),
) -> Option<TypedNote> {
    let meta = cached_meta(&file.path, checkpoint)?;
    note_from_meta(file, &meta, wanted)
}

fn note_from_meta(file: &IndexedFile, meta: &NoteMeta, wanted: &[String]) -> Option<TypedNote> {
    let note_type = meta.properties.get("type")?;
    let first = note_type.split(',').next()?.trim();
    if !wanted.iter().any(|w| w.eq_ignore_ascii_case(first)) {
        return None;
    }
    Some(TypedNote {
        path: file.path.to_string_lossy().into_owned(),
        relative_path: file.relative_path.clone(),
        name: file
            .path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| file.name.clone()),
        title: meta.title.clone(),
        note_type: first.to_string(),
        modified_at: file.modified_at,
        properties: meta.properties.clone(),
        excerpt: meta.excerpt.clone(),
    })
}

fn cached_meta(path: &Path, checkpoint: &(dyn Fn() + Sync)) -> Option<Arc<NoteMeta>> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let size = metadata.len();
    if let Some((m, s, meta)) = META_CACHE.lock().get(path) {
        if *m == modified && *s == size {
            return Some(Arc::clone(meta));
        }
    }
    let meta = Arc::new(parse_note_head(&read_head(path)?));
    META_CACHE
        .lock()
        .insert(path.to_path_buf(), (modified, size, Arc::clone(&meta)));
    META_CACHE_DIRTY.store(true, Ordering::Relaxed);
    checkpoint();
    Some(meta)
}

/// Fill the meta cache from disk. Entries already in memory win: they were
/// read this run. A missing file is a first launch; an unreadable one is
/// logged and ignored, since every entry can be read again.
fn load_meta_cache(file: &Path) {
    let bytes = match std::fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            eprintln!("note meta cache: can't read {}: {error}", file.display());
            return;
        }
    };
    let saved: MetaCacheFile = match serde_json::from_slice(&bytes) {
        Ok(saved) => saved,
        Err(error) => {
            eprintln!("note meta cache: ignoring {}: {error}", file.display());
            return;
        }
    };
    if saved.version != META_CACHE_VERSION {
        return;
    }
    let mut cache = META_CACHE.lock();
    for entry in saved.entries {
        cache
            .entry(entry.path)
            .or_insert((entry.modified, entry.size, Arc::new(entry.meta)));
    }
}

/// Write the meta cache to disk when it has changed. One writer at a time:
/// a checkpoint that finds another save running skips.
fn save_meta_cache(file: &Path) {
    static SAVING: Mutex<()> = Mutex::new(());
    let Some(_saving) = SAVING.try_lock() else {
        return;
    };
    *META_CACHE_SAVED_AT.lock() = Instant::now();
    if !META_CACHE_DIRTY.swap(false, Ordering::Relaxed) {
        return;
    }
    let entries: Vec<MetaCacheEntry> = META_CACHE
        .lock()
        .iter()
        .map(|(path, (modified, size, meta))| MetaCacheEntry {
            path: path.clone(),
            modified: *modified,
            size: *size,
            meta: NoteMeta::clone(meta),
        })
        .collect();
    let saved = MetaCacheFile {
        version: META_CACHE_VERSION,
        entries,
    };
    if let Err(error) = write_atomically(file, &saved) {
        META_CACHE_DIRTY.store(true, Ordering::Relaxed);
        eprintln!("note meta cache: can't write {}: {error}", file.display());
    }
}

fn write_atomically(file: &Path, saved: &MetaCacheFile) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(saved)?)?;
    std::fs::rename(&tmp, file)
}

/// Drop cached heads of notes that are gone, so the file on disk doesn't
/// grow forever. Entries this scan didn't list may belong to another
/// window's workspace, so only a missing file removes one.
fn prune_meta_cache(files: &[IndexedFile]) {
    let listed: HashSet<&Path> = files.iter().map(|f| f.path.as_path()).collect();
    let unlisted: Vec<PathBuf> = META_CACHE
        .lock()
        .keys()
        .filter(|path| !listed.contains(path.as_path()))
        .cloned()
        .collect();
    let gone: Vec<PathBuf> = unlisted.into_iter().filter(|p| !p.exists()).collect();
    if gone.is_empty() {
        return;
    }
    let mut cache = META_CACHE.lock();
    for path in gone {
        cache.remove(&path);
    }
    META_CACHE_DIRTY.store(true, Ordering::Relaxed);
}

fn read_head(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::with_capacity(HEAD_BYTES);
    file.by_ref()
        .take(HEAD_BYTES as u64)
        .read_to_end(&mut buf)
        .ok()?;
    // A multi-byte character cut at the end of the head is dropped, not fatal.
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Split `text` into its frontmatter block and the body after it.
fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, text);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return (Some(&rest[..offset]), &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    (None, text)
}

fn unquote(value: &str) -> &str {
    let v = value.trim();
    v.strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .or_else(|| v.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')))
        .unwrap_or(v)
}

/// Top-level scalar keys of a YAML block. Inline lists (`[a, b]`) and block
/// lists (`- a`) become "a, b"; nested maps are skipped.
fn parse_properties(yaml: &str) -> BTreeMap<String, String> {
    let mut props = BTreeMap::new();
    let mut list_key: Option<String> = None;
    let mut list_items: Vec<String> = Vec::new();
    let flush = |key: &mut Option<String>,
                 items: &mut Vec<String>,
                 props: &mut BTreeMap<String, String>| {
        if let Some(k) = key.take() {
            if !items.is_empty() {
                props.insert(k, items.join(", "));
            }
        }
        items.clear();
    };
    for line in yaml.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if indented {
            if list_key.is_some() {
                if let Some(item) = line.trim().strip_prefix("- ") {
                    let item = unquote(item);
                    if !item.is_empty() {
                        list_items.push(item.to_string());
                    }
                }
            }
            continue;
        }
        flush(&mut list_key, &mut list_items, &mut props);
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_lowercase();
        if key.is_empty() {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            list_key = Some(key);
            continue;
        }
        let value = match value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            // `[[Page]]` is a wiki link, not a list.
            Some(inner) if !inner.starts_with('[') => inner
                .split(',')
                .map(unquote)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", "),
            _ => unquote(value).to_string(),
        };
        if !value.is_empty() {
            props.insert(key, value);
        }
    }
    flush(&mut list_key, &mut list_items, &mut props);
    props
}

fn parse_note_head(text: &str) -> NoteMeta {
    let (yaml, body) = split_frontmatter(text);
    let properties = yaml.map(parse_properties).unwrap_or_default();
    // Only an explicit `title:` renames a note in a space: a book page's first
    // heading is usually a chapter or section, not the book.
    let title = properties.get("title").cloned();
    let excerpt = first_paragraph(body).map(|text| truncate_chars(&text, EXCERPT_MAX_CHARS));
    NoteMeta {
        properties,
        title: title.filter(|t| !t.is_empty()),
        excerpt,
    }
}

/// One line of body text as plain text, or None for a line that isn't prose
/// (blank, heading, embed, fence, comment, table, rule). List and quote marks,
/// task boxes and a trailing block id are dropped.
fn prose_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("![")
        || trimmed.starts_with("```")
        || trimmed.starts_with("<!--")
        || trimmed.starts_with('|')
        || trimmed == "---"
    {
        return None;
    }
    let text = trimmed
        .trim_start_matches(['-', '*', '>', ' '])
        .trim_start_matches("[ ] ")
        .trim_start_matches("[x] ");
    let text = match text.rfind(" ^") {
        Some(i) if !text[i + 2..].contains(' ') => &text[..i],
        _ => text,
    }
    .trim();
    (!text.is_empty()).then_some(text)
}

/// The first paragraph of text, its lines kept, with markdown escapes
/// (`\#`, `\-`) shown as the characters they stand for.
fn first_paragraph(body: &str) -> Option<String> {
    let mut lines = body.lines().skip_while(|line| prose_line(line).is_none());
    let mut paragraph: Vec<&str> = Vec::new();
    for line in lines.by_ref() {
        match prose_line(line) {
            Some(text) => paragraph.push(text),
            None => break,
        }
    }
    if paragraph.is_empty() {
        return None;
    }
    let joined = paragraph.join("\n");
    let mut text = String::with_capacity(joined.len());
    let mut chars = joined.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(|next| next.is_ascii_punctuation()) {
            continue;
        }
        text.push(c);
    }
    Some(text)
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", text[..i].trim_end()),
        None => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_scalar_list_and_quoted_properties() {
        let meta = parse_note_head(
            "---\nType: Book\nCover: \"Skip-assets/cover.jpg\"\ntags:\n  - Book\n  - Reading\nAuthor: [James Altucher]\nLink: [[Page]]\nnested:\n  key: value\n---\nLove how he tried.\n",
        );
        assert_eq!(meta.properties.get("type").unwrap(), "Book");
        assert_eq!(
            meta.properties.get("cover").unwrap(),
            "Skip-assets/cover.jpg"
        );
        assert_eq!(meta.properties.get("tags").unwrap(), "Book, Reading");
        assert_eq!(meta.properties.get("author").unwrap(), "James Altucher");
        assert_eq!(meta.properties.get("link").unwrap(), "[[Page]]");
        assert!(!meta.properties.contains_key("nested"));
        assert_eq!(meta.excerpt.as_deref(), Some("Love how he tried."));
    }

    #[test]
    fn title_only_from_frontmatter() {
        assert_eq!(
            parse_note_head("---\ntitle: Named\nType: Paper\n---\n# Heading\n")
                .title
                .as_deref(),
            Some("Named")
        );
        let meta = parse_note_head(
            "---\nType: Project\n---\n\n# Governance\n\n## Goals\n- Ship it ^bk-1\n",
        );
        assert_eq!(meta.title, None);
        assert_eq!(meta.excerpt.as_deref(), Some("Ship it"));
    }

    #[test]
    fn no_frontmatter_means_no_properties() {
        let meta = parse_note_head("Type: Book\nplain text");
        assert!(meta.properties.is_empty());
        let unclosed = parse_note_head("---\nType: Book\n");
        assert!(unclosed.properties.is_empty());
    }

    #[test]
    fn excerpt_is_the_first_paragraph_without_escapes() {
        let meta = parse_note_head(
            "---\nType: Tweet\n---\n\n\\#buildinpublic day 3\nsecond line\n\nnext paragraph\n\n---\n\nnext post\n",
        );
        assert_eq!(
            meta.excerpt.as_deref(),
            Some("#buildinpublic day 3\nsecond line")
        );
    }

    #[test]
    fn excerpt_is_capped() {
        let long = "word ".repeat(100);
        let meta = parse_note_head(&format!("---\nType: Inspiration\n---\n{long}"));
        let excerpt = meta.excerpt.unwrap();
        assert!(excerpt.chars().count() <= EXCERPT_MAX_CHARS + 1);
        assert!(excerpt.ends_with('…'));
    }

    #[test]
    fn lists_matching_types_newest_first() {
        let dir = std::env::temp_dir().join(format!("writer-spaces-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, body: &str, modified_at: u64| {
            let path = dir.join(name);
            std::fs::write(&path, body).unwrap();
            IndexedFile {
                path,
                relative_path: name.to_string(),
                name: name.to_string(),
                modified_at,
            }
        };
        let files = vec![
            write("a.md", "---\nType: book\n---\n", 1),
            write("b.md", "---\nType: YouTube\n---\n", 3),
            write("c.md", "---\nType: Project\n---\n", 2),
            write("d.md", "no frontmatter", 4),
            write("e.md", "---\nType: [Book, Paper]\n---\n", 5),
        ];
        let notes = list_typed_notes_impl(&files, &["Book".into(), "youtube".into()], &|| {});
        let names: Vec<_> = notes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["e", "b", "a"]);
        assert_eq!(notes[2].note_type, "book");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn meta_cache_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("writer-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("kept.md");
        std::fs::write(&path, "---\nType: Book\nCover: c.jpg\n---\nBlurb.\n").unwrap();
        let file = IndexedFile {
            path: path.clone(),
            relative_path: "kept.md".into(),
            name: "kept.md".into(),
            modified_at: 1,
        };
        let cache_file = dir.join(META_CACHE_FILE);
        list_typed_notes_impl(std::slice::from_ref(&file), &["Book".into()], &|| {});
        META_CACHE_DIRTY.store(true, Ordering::Relaxed);
        save_meta_cache(&cache_file);

        // A new launch: nothing in memory until the file is loaded.
        let cached = META_CACHE.lock().remove(&path).unwrap();
        load_meta_cache(&cache_file);
        assert_eq!(META_CACHE.lock().get(&path).unwrap().0, cached.0);
        let notes = list_typed_notes_impl(std::slice::from_ref(&file), &["Book".into()], &|| {});
        assert_eq!(notes[0].properties.get("cover").unwrap(), "c.jpg");

        // Listing from the cache alone finds it without opening it.
        let cached = cached_typed_notes(std::slice::from_ref(&file), &["book".into()]);
        assert_eq!(cached[0].name, "kept");
        assert!(cached_typed_notes(std::slice::from_ref(&file), &["Paper".into()]).is_empty());

        // A deleted note leaves the cache.
        std::fs::remove_file(&path).unwrap();
        prune_meta_cache(&[]);
        assert!(!META_CACHE.lock().contains_key(&path));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
