use crate::error::AppError;
use crate::file_cache::FileCache;
use crate::path_ext::PathExt;
use crate::state::{self, AppState, IndexedFile};
use ignore::WalkBuilder;
use parking_lot::Mutex;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub filename: String,
    pub relative_path: String,
    pub score: u32,
    pub match_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub file_count: usize,
    pub duration_ms: u64,
}

#[tauri::command]
pub fn index_workspace(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<IndexStats, AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let (root, epoch) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    let cancel = Arc::clone(&state.cancel_index.read());

    let start = std::time::Instant::now();
    let (indexed, dirs) = index_workspace_impl(&root, cancel);
    let file_count = indexed.len();
    let duration_ms = start.elapsed().as_millis() as u64;

    let displaced = state.with_workspace_snapshot(&root, epoch, || {
        let old_index = std::mem::replace(&mut *state.file_index.write(), indexed);
        let old_cache = state.recent_files_cache.write().take();
        let old_dirs = std::mem::replace(&mut *state.dirs_with_markdown.write(), dirs);
        state.file_index_revision.fetch_add(1, Ordering::SeqCst);
        state.index_ready.store(true, Ordering::Relaxed);
        (old_index, old_cache, old_dirs)
    });
    let Some(displaced) = displaced else {
        return Ok(IndexStats {
            file_count: 0,
            duration_ms,
        });
    };
    drop(displaced);

    Ok(IndexStats {
        file_count,
        duration_ms,
    })
}

#[tauri::command]
pub fn fuzzy_search(
    query: String,
    limit: Option<u32>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let state = app.state::<AppState>().get_or_create(webview.label());
    let limit = limit.unwrap_or(50) as usize;
    let index = state.file_index.read();
    fuzzy_search_from(&query, &index, limit)
}

fn fuzzy_search_from(
    query: &str,
    index: &[IndexedFile],
    limit: usize,
) -> Result<Vec<SearchResult>, AppError> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_query = query.to_lowercase();
    let mut needles = Vec::from([normalized_query.clone()]);
    let hyphen_query = normalized_query.replace(' ', "-");
    if !needles.contains(&hyphen_query) {
        needles.push(hyphen_query);
    }
    let space_query = normalized_query.replace('-', " ");
    if !needles.contains(&space_query) {
        needles.push(space_query);
    }

    let mut results: Vec<SearchResult> = index
        .iter()
        .filter_map(|file| {
            let haystack = file.relative_path.to_lowercase();
            let (byte_start, needle) = needles
                .iter()
                .filter_map(|needle| haystack.find(needle).map(|start| (start, needle)))
                .min_by_key(|(start, _)| *start)?;

            let char_start = haystack[..byte_start].chars().count();
            let char_len = needle.chars().count();

            let filename_start_bytes = file.relative_path.rfind('/').map(|i| i + 1).unwrap_or(0);
            let in_filename = byte_start >= filename_start_bytes;

            // Higher score ranks first. Matches inside the filename beat matches
            // in a parent directory; earlier matches beat later ones; shorter
            // paths tiebreak.
            let mut score: u32 = 0;
            if in_filename {
                score += 1_000_000;
            }
            score += 10_000u32.saturating_sub(byte_start as u32);
            score +=
                1_000u32.saturating_sub((file.relative_path.chars().count() as u32).min(1_000));

            let match_indices: Vec<u32> = (char_start..char_start + char_len)
                .map(|i| i as u32)
                .collect();

            Some(SearchResult {
                path: file.path.to_ipc_lossy().to_string(),
                filename: file.name.clone(),
                relative_path: file.relative_path.clone(),
                score,
                match_indices,
            })
        })
        .collect();

    results.sort_by(|a, b| b.score.cmp(&a.score));
    results.truncate(limit);
    Ok(results)
}

/// Parallel file indexing using the `ignore` crate's walker.
/// Returns the indexed files and a set of directories containing markdown.
///
/// The `cancel` flag lets a concurrent workspace switch stop this walk early:
/// each walker thread checks the flag at every directory entry and returns
/// `WalkState::Quit` as soon as it's flipped. The returned results may be
/// partial in that case; callers should compare `cancel.load` or the workspace
/// epoch against expectations before acting on them.
pub fn index_workspace_impl(
    root: &Path,
    cancel: Arc<AtomicBool>,
) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    let root = root.to_path_buf();
    let results: Arc<Mutex<Vec<IndexedFile>>> = Arc::new(Mutex::new(Vec::new()));

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);

    let results_ref = Arc::clone(&results);
    let root_ref = root.clone();

    WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(threads)
        .build_parallel()
        .run(move || {
            let results = Arc::clone(&results_ref);
            let root = root_ref.clone();
            let cancel = Arc::clone(&cancel);
            Box::new(move |entry| {
                if cancel.load(Ordering::Relaxed) {
                    return ignore::WalkState::Quit;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };
                // Safety net: skip node_modules even without .gitignore
                if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                    if entry.file_name() == "node_modules" {
                        return ignore::WalkState::Skip;
                    }
                    return ignore::WalkState::Continue;
                }
                if entry.file_type().is_some_and(|ft| ft.is_file())
                    && entry.path().extension().and_then(|e| e.to_str()) == Some("md")
                {
                    let rel = entry
                        .path()
                        .strip_prefix(&root)
                        .unwrap_or(entry.path())
                        .to_ipc_lossy()
                        .to_string();
                    results.lock().push(IndexedFile {
                        path: entry.path().to_path_buf(),
                        relative_path: rel,
                        name: entry.file_name().to_string_lossy().to_string(),
                        modified_at: crate::commands::fs::modified_time(entry.path()),
                    });
                }
                ignore::WalkState::Continue
            })
        });

    let indexed = Arc::try_unwrap(results).unwrap().into_inner();
    let dirs = state::rebuild_dirs_from_index(&indexed, &root);
    (indexed, dirs)
}

/// Test-only convenience: run an uncancellable index.
#[cfg(test)]
fn index_workspace_test(root: &Path) -> (Vec<IndexedFile>, HashSet<PathBuf>) {
    index_workspace_impl(root, Arc::new(AtomicBool::new(false)))
}

pub fn fuzzy_search_impl(query: &str, index: &[IndexedFile], limit: usize) -> Vec<SearchResult> {
    fuzzy_search_from(query, index, limit).unwrap_or_default()
}

/// Find a file under `root` by case-insensitive basename. Used by Obsidian
/// wiki image embeds (`![[image.png]]`), which reference attachments by bare
/// filename regardless of where they live in the vault. The workspace file
/// index only covers markdown, so this walks on demand (gitignore-aware,
/// parallel) instead of maintaining a second media index plus watcher
/// plumbing; callers cache positive results.
///
/// Deterministic on duplicates: the match with the fewest path components
/// wins, ties broken lexicographically — "shortest path" like Obsidian.
pub fn find_file_by_name_impl(root: &Path, file_name: &str) -> Option<PathBuf> {
    let matches: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let target = file_name.to_lowercase();

    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);

    let matches_ref = Arc::clone(&matches);
    WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(threads)
        .build_parallel()
        .run(move || {
            let matches = Arc::clone(&matches_ref);
            let target = target.clone();
            Box::new(move |entry| {
                let Ok(entry) = entry else {
                    return ignore::WalkState::Continue;
                };
                if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                    if entry.file_name() == "node_modules" {
                        return ignore::WalkState::Skip;
                    }
                    return ignore::WalkState::Continue;
                }
                if entry.file_type().is_some_and(|ft| ft.is_file())
                    && entry.file_name().to_string_lossy().to_lowercase() == target
                {
                    matches.lock().push(entry.path().to_path_buf());
                }
                ignore::WalkState::Continue
            })
        });

    let mut matches = Arc::try_unwrap(matches).unwrap().into_inner();
    matches.sort_by(|a, b| {
        let depth_a = a.components().count();
        let depth_b = b.components().count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });
    matches.into_iter().next()
}

#[tauri::command]
pub async fn find_file_by_name(
    root: String,
    file_name: String,
) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(find_file_by_name_impl(Path::new(&root), &file_name)
            .map(|path| path.to_ipc_lossy().to_string()))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// One place that links to a block: `![[Page#^id]]` or `[[Page#^id]]`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BlockReference {
    pub id: String,
    pub path: String,
    /// 1-based line number of the reference.
    pub line: u32,
    /// The referencing line, trimmed and capped, for showing in a list.
    pub text: String,
}

const REFERENCE_TEXT_MAX: usize = 200;

/// Every reference to any of `ids` across the workspace's markdown files. The
/// back half of linked blocks (SPECs/block-embed-spec.md): a referenced block
/// shows how many places use it. Reads files in parallel off the UI thread; a
/// file with no `#^` in it costs one substring scan. One scan at a time: see
/// `spaces::list_typed_notes`, whose overlapping scans ran the app out of
/// threads on a stalled iCloud vault.
#[tauri::command]
pub async fn find_block_references(
    ids: Vec<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<BlockReference>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    static SCAN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _scan = SCAN.lock().await;
    let state = app.state::<AppState>().get_or_create(webview.label());
    let paths: Vec<PathBuf> = state
        .file_index
        .read()
        .iter()
        .map(|f| f.path.clone())
        .collect();
    tauri::async_runtime::spawn_blocking(move || Ok(find_block_references_impl(&paths, &ids)))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

pub fn find_block_references_impl(paths: &[PathBuf], ids: &[String]) -> Vec<BlockReference> {
    let needles: Vec<(String, &String)> = ids.iter().map(|id| (format!("#^{id}"), id)).collect();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let chunk = paths.len().div_ceil(threads).max(1);
    let mut out: Vec<BlockReference> = std::thread::scope(|scope| {
        let workers: Vec<_> = paths
            .chunks(chunk)
            .map(|part| {
                let needles = &needles;
                scope.spawn(move || {
                    let mut found = Vec::new();
                    for path in part {
                        let Ok(text) = std::fs::read_to_string(path) else {
                            continue;
                        };
                        if !text.contains("#^") {
                            continue;
                        }
                        references_in_text(&text, needles, &path.to_ipc_lossy(), &mut found);
                    }
                    found
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().unwrap_or_default())
            .collect()
    });
    out.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    out
}

fn references_in_text(
    text: &str,
    needles: &[(String, &String)],
    path: &str,
    found: &mut Vec<BlockReference>,
) {
    for (index, line) in text.lines().enumerate() {
        if !line.contains("#^") || !line.contains("[[") {
            continue;
        }
        for (needle, id) in needles {
            // The id must end there (`]]` or `|alias`), so `^ab` never
            // matches a reference to `^abc`.
            let hit = line.match_indices(needle.as_str()).any(|(at, _)| {
                matches!(
                    line.as_bytes().get(at + needle.len()),
                    Some(b']') | Some(b'|')
                )
            });
            if hit {
                let trimmed = line.trim();
                let text = match trimmed.char_indices().nth(REFERENCE_TEXT_MAX) {
                    Some((cut, _)) => format!("{}…", &trimmed[..cut]),
                    None => trimmed.to_string(),
                };
                found.push(BlockReference {
                    id: (*id).clone(),
                    path: path.to_string(),
                    line: index as u32 + 1,
                    text,
                });
            }
        }
    }
}

/// One line of another note that mentions some of the pen's search words:
/// what Connect quotes back (SPECs/second-pen-spec.md#connect-what-you-wrote-before).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MentioningLine {
    pub path: String,
    /// The note's file name without `.md`: what a `[[link]]` to it says.
    pub stem: String,
    /// 1-based.
    pub line: u32,
    /// The line, trimmed and capped.
    pub text: String,
    /// How many different search words it contains.
    pub hits: u32,
}

const MENTION_TEXT_MAX: usize = 280;
const MENTION_LIMIT_MAX: usize = 100;

/// Every note's own lines (`writer_lines`), kept by `crate::file_cache` so a
/// search only `stat`s each note: on an iCloud vault most notes are evicted,
/// and reading them all again made every Connect take minutes.
static LINE_INDEX: LazyLock<FileCache<Vec<WriterLine>>> =
    LazyLock::new(|| FileCache::new("note-lines.json", 1));

/// One line the writer wrote: not frontmatter, code, HTML or a pen line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WriterLine {
    /// 1-based.
    pub line: u32,
    /// Trimmed.
    pub text: String,
}

/// Lines in the workspace's markdown files that contain any of `terms`
/// (case-insensitive), `exclude` left out: most words matched first, then
/// newest file.
///
/// Never waits on iCloud: it reads only notes changed since they were
/// indexed and on disk now. A note offloaded to iCloud and not indexed yet is
/// skipped (the background pass, `warm_line_index`, downloads it), so the
/// first Connect after opening a vault answers in moments, not minutes. It
/// doesn't wait for that pass either: the cache takes reads from both.
#[tauri::command]
pub async fn find_lines_mentioning(
    terms: Vec<String>,
    exclude: Option<String>,
    limit: usize,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<MentioningLine>, AppError> {
    let files = line_index_files(&webview, &app, exclude.as_deref());
    let cache_dir = app.path().app_cache_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        LINE_INDEX.open(cache_dir.as_deref());
        let started = std::time::Instant::now();
        let found = find_lines_mentioning_impl(&files, &terms, limit, &|path| {
            LINE_INDEX.get(path, |path| {
                if is_offloaded(path) {
                    None
                } else {
                    read_writer_lines(path)
                }
            })
        });
        eprintln!(
            "line index: searched {} notes in {} ms",
            files.len(),
            started.elapsed().as_millis()
        );
        Ok(found)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// The note's text is in iCloud only ("Optimize Mac Storage"): opening it
/// downloads it first, which can take seconds.
fn is_offloaded(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        const SF_DATALESS: u32 = 0x4000_0000;
        std::fs::metadata(path).is_ok_and(|m| m.st_flags() & SF_DATALESS != 0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

/// Bring the line index up to date in the background, so the first Connect
/// after opening a workspace finds every note. Run once the workspace is
/// indexed; downloads notes offloaded to iCloud, which a search skips.
pub fn warm_line_index(app: &tauri::AppHandle, files: Vec<IndexedFile>) {
    let cache_dir = app.path().app_cache_dir().ok();
    tauri::async_runtime::spawn(async move {
        let _scan = LINE_SCAN.lock().await;
        let warmed = tauri::async_runtime::spawn_blocking(move || {
            LINE_INDEX.open(cache_dir.as_deref());
            let started = std::time::Instant::now();
            in_parallel(&files, |file| {
                LINE_INDEX.get(&file.path, read_writer_lines);
            });
            LINE_INDEX.prune(&files);
            LINE_INDEX.save();
            eprintln!(
                "line index: {} notes ready in {} ms",
                files.len(),
                started.elapsed().as_millis()
            );
        })
        .await;
        if let Err(error) = warmed {
            eprintln!("line index: warming failed: {error}");
        }
    });
}

/// One background pass at a time: a pass reads on up to 8 threads, and on a
/// stalled iCloud vault overlapping passes pile up threads. An async lock
/// holds no thread while waiting.
static LINE_SCAN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn line_index_files(
    webview: &tauri::Webview,
    app: &tauri::AppHandle,
    exclude: Option<&str>,
) -> Vec<(PathBuf, u64)> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let files = state.file_index.read();
    files
        .iter()
        .filter(|f| exclude != Some(&*f.path.to_ipc_lossy()))
        .map(|f| (f.path.clone(), f.modified_at))
        .collect()
}

/// Run `work` on every item, on up to 8 threads.
fn in_parallel<T: Sync, R: Send>(items: &[T], work: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let chunk = items.len().div_ceil(threads).max(1);
    let work = &work;
    std::thread::scope(|scope| {
        let workers: Vec<_> = items
            .chunks(chunk)
            .map(|part| scope.spawn(move || part.iter().map(work).collect::<Vec<_>>()))
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().unwrap_or_default())
            .collect()
    })
}

/// `lines_of` gives a note's own lines (from the index, or read in tests).
pub fn find_lines_mentioning_impl(
    files: &[(PathBuf, u64)],
    terms: &[String],
    limit: usize,
    lines_of: &(dyn Fn(&Path) -> Option<Arc<Vec<WriterLine>>> + Sync),
) -> Vec<MentioningLine> {
    let needles: Vec<String> = terms
        .iter()
        .map(|t| word_stem(&t.trim().to_lowercase()))
        .filter(|t| t.chars().count() >= 3)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if needles.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut found: Vec<(MentioningLine, u64)> = in_parallel(files, |(path, modified)| {
        let Some(lines) = lines_of(path) else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for line in lines.iter() {
            let lower = line.text.to_lowercase();
            let hits = needles
                .iter()
                .filter(|n| lower.contains(n.as_str()))
                .count() as u32;
            if hits == 0 {
                continue;
            }
            let text = match line.text.char_indices().nth(MENTION_TEXT_MAX) {
                Some((cut, _)) => format!("{}…", &line.text[..cut]),
                None => line.text.clone(),
            };
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            found.push((
                MentioningLine {
                    path: path.to_ipc_lossy().to_string(),
                    stem,
                    line: line.line,
                    text,
                    hits,
                },
                *modified,
            ));
        }
        found
    })
    .into_iter()
    .flatten()
    .collect();
    found.sort_by(|(a, am), (b, bm)| {
        b.hits
            .cmp(&a.hits)
            .then(bm.cmp(am))
            .then(a.path.cmp(&b.path))
            .then(a.line.cmp(&b.line))
    });
    found.truncate(limit.min(MENTION_LIMIT_MAX));
    found.into_iter().map(|(line, _)| line).collect()
}

/// A note's own lines, read from the file. None when it can't be read.
pub fn read_writer_lines(path: &Path) -> Option<Vec<WriterLine>> {
    std::fs::read_to_string(path)
        .ok()
        .map(|text| writer_lines(&text))
}

/// A word without its common English ending, so it matches its other forms
/// as a substring: "naps" finds "nap", "remembering" finds "remembered".
fn word_stem(word: &str) -> String {
    if word.contains(' ') {
        return word.to_string();
    }
    for suffix in ["ings", "ing", "ied", "ies", "ed", "es", "s", "y"] {
        if let Some(stem) = word.strip_suffix(suffix) {
            if stem.chars().count() >= 3 {
                return stem.to_string();
            }
        }
    }
    word.to_string()
}

/// The lines of one file the writer wrote, outside frontmatter, code
/// fences and HTML (a video note's `<details>` transcript is the source's
/// words, not the writer's), never the pen's own lines (`^ai-…`).
fn writer_lines(text: &str) -> Vec<WriterLine> {
    let mut out = Vec::new();
    let mut in_front = text.starts_with("---\n") || text.starts_with("---\r\n");
    let mut in_fence = false;
    let mut in_details = false;
    for (index, raw) in text.lines().enumerate() {
        let trimmed = raw.trim();
        if in_front {
            if index > 0 && trimmed == "---" {
                in_front = false;
            }
            continue;
        }
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if trimmed.starts_with("<details") {
            in_details = !trimmed.contains("</details>");
            continue;
        }
        if in_details {
            in_details = !trimmed.contains("</details>");
            continue;
        }
        if in_fence || trimmed.is_empty() || trimmed.starts_with('<') || is_pen_line(trimmed) {
            continue;
        }
        out.push(WriterLine {
            line: index as u32 + 1,
            text: trimmed.to_string(),
        });
    }
    out
}

/// A line the second pen wrote: it ends with `^ai-<kind>-<id>`.
fn is_pen_line(line: &str) -> bool {
    line.rsplit_once(" ^ai-").is_some_and(|(_, id)| {
        id.len() == 6
            && id.as_bytes()[1] == b'-'
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path_ext::PathExt;
    use std::fs;
    use tempfile::TempDir;

    fn setup_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("readme.md"), "# Readme").unwrap();
        fs::write(dir.path().join("notes.md"), "# Notes").unwrap();
        fs::write(dir.path().join("data.txt"), "not indexed").unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs").join("guide.md"), "# Guide").unwrap();
        // Hidden directory should be ignored
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("config.md"), "git").unwrap();
        dir
    }

    #[test]
    fn test_find_block_references() {
        let dir = setup_workspace();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(
            &a,
            "intro\n![[Source#^abc]]\nsee [[Source#^abc|that]] and [[Source#^abcd]]\n",
        )
        .unwrap();
        fs::write(&b, "nothing to see\n").unwrap();
        let refs = find_block_references_impl(&[a.clone(), b], &["abc".to_string()]);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].line, 2);
        assert_eq!(refs[0].text, "![[Source#^abc]]");
        assert_eq!(refs[1].line, 3);
        assert!(refs
            .iter()
            .all(|r| r.id == "abc" && r.path == a.to_ipc_lossy()));
    }

    #[test]
    fn test_index_workspace_counts_md_files() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        assert_eq!(index.len(), 3); // readme.md, notes.md, docs/guide.md
    }

    #[test]
    fn test_index_workspace_ignores_hidden() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        // Should not include .git/config.md
        assert!(!index.iter().any(|f| f.relative_path.contains(".git")));
    }

    #[test]
    fn test_index_workspace_builds_dirs_with_markdown() {
        let dir = setup_workspace();
        let root = dir.path().to_path_buf();
        let (_index, dirs) = index_workspace_test(dir.path());
        // The root and docs/ should be in the set
        assert!(dirs.contains(&root));
        assert!(dirs.contains(&root.join("docs")));
        // .git should not be in the set
        assert!(!dirs.contains(&root.join(".git")));
    }

    #[test]
    fn test_cancel_flag_short_circuits_walk() {
        // Pre-cancelled walker should return before visiting any file.
        let dir = setup_workspace();
        let cancel = Arc::new(AtomicBool::new(true));
        let (index, dirs) = index_workspace_impl(dir.path(), cancel);
        assert!(index.is_empty());
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_live_cancel_token_survives_after_swap() {
        // Mirror the workspace-switch contract: when the outgoing cancel flag
        // is flipped, any walker still holding a clone of the old Arc sees
        // the cancellation even after a fresh Arc replaces the state slot.
        let live = Arc::new(AtomicBool::new(false));
        let walker_view = Arc::clone(&live);
        live.store(true, Ordering::Relaxed);
        let _fresh = Arc::new(AtomicBool::new(false));
        assert!(walker_view.load(Ordering::Relaxed));
    }

    #[test]
    fn test_fuzzy_search_ranks_by_relevance() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("readme", &index, 50);
        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "readme.md");
    }

    #[test]
    fn test_fuzzy_search_matches_space_separated_names() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("No prior experience.md"), "# Note").unwrap();
        let (index, _dirs) = index_workspace_test(dir.path());

        let results = fuzzy_search_impl("No prior experience", &index, 50);

        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "No prior experience.md");
    }

    #[test]
    fn test_fuzzy_search_returns_match_indices() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("guide", &index, 50);
        assert!(!results.is_empty());
        assert!(!results[0].match_indices.is_empty());
    }

    #[test]
    fn test_fuzzy_search_empty_query() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("", &index, 50);
        assert!(results.is_empty());
    }

    #[test]
    fn test_fuzzy_search_respects_limit() {
        let dir = setup_workspace();
        let (index, _dirs) = index_workspace_test(dir.path());
        let results = fuzzy_search_impl("md", &index, 1);
        assert!(results.len() <= 1);
    }

    #[test]
    fn test_find_file_by_name_case_insensitive() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("assets").join("Diagram.PNG"), [0u8]).unwrap();

        let found = find_file_by_name_impl(dir.path(), "diagram.png").unwrap();
        assert_eq!(found, dir.path().join("assets").join("Diagram.PNG"));
    }

    #[test]
    fn test_find_file_by_name_prefers_shortest_path() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a").join("b")).unwrap();
        fs::write(dir.path().join("a").join("b").join("pic.png"), [0u8]).unwrap();
        fs::write(dir.path().join("pic.png"), [0u8]).unwrap();

        let found = find_file_by_name_impl(dir.path(), "pic.png").unwrap();
        assert_eq!(found, dir.path().join("pic.png"));
    }

    #[test]
    fn test_find_file_by_name_missing_and_hidden() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git").join("hidden.png"), [0u8]).unwrap();

        assert!(find_file_by_name_impl(dir.path(), "nope.png").is_none());
        assert!(find_file_by_name_impl(dir.path(), "hidden.png").is_none());
    }

    #[test]
    fn lines_mentioning_rank_by_words_then_newest_and_skip_pen_lines() {
        let dir = TempDir::new().unwrap();
        let old = dir.path().join("Old.md");
        let new = dir.path().join("New.md");
        fs::write(
            &old,
            "---\nTags: dopamine reward\n---\nA reward after every chapter works.\n",
        )
        .unwrap();
        fs::write(
            &new,
            "# New\nDopamine and reward go together.\n- reward line by the pen ^ai-e-ab12\n```\nreward in code\n```\n<details>\n<summary>Transcript</summary>\n<p>reward in a transcript</p>\n</details>\n<p>reward in html</p>\nnothing here\n",
        )
        .unwrap();
        let files = vec![(old.clone(), 1), (new.clone(), 2)];
        let read = |path: &Path| read_writer_lines(path).map(Arc::new);
        let terms = vec![
            "Reward".to_string(),
            "dopamine".to_string(),
            "ok".to_string(),
        ];
        let found = find_lines_mentioning_impl(&files, &terms, 10, &read);
        let got: Vec<(&str, u32, u32)> = found
            .iter()
            .map(|l| (l.stem.as_str(), l.line, l.hits))
            .collect();
        assert_eq!(got, vec![("New", 2, 2), ("Old", 4, 1)]);
        assert_eq!(
            find_lines_mentioning_impl(&files, &terms, 1, &read).len(),
            1
        );
        assert!(find_lines_mentioning_impl(&files, &["ok".to_string()], 10, &read).is_empty());
        // Other forms of a word match: "rewards" finds "reward".
        assert_eq!(
            find_lines_mentioning_impl(&files, &["rewards".to_string()], 10, &read).len(),
            2
        );
        assert_eq!(word_stem("remembering"), "remember");
        assert_eq!(word_stem("naps"), "nap");
        assert_eq!(word_stem("sleep"), "sleep");
    }
}
