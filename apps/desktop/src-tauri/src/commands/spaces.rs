use crate::error::AppError;
use crate::state::{AppState, IndexedFile};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use tauri::Manager;

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

#[derive(Debug, Clone, Default, PartialEq)]
struct NoteMeta {
    properties: BTreeMap<String, String>,
    title: Option<String>,
    excerpt: Option<String>,
}

/// Head of a file worth reading: enough for any real frontmatter and the
/// first line of text after it.
const HEAD_BYTES: usize = 8192;
const EXCERPT_MAX_CHARS: usize = 160;

/// Parsed heads by path, keyed on (modified nanos, size) so a repeat call only
/// re-reads files that changed. Paths are absolute, so windows on different
/// workspaces never collide.
type MetaCache = HashMap<PathBuf, (u128, u64, Arc<NoteMeta>)>;
static META_CACHE: LazyLock<Mutex<MetaCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Every indexed note whose `Type` is one of `types` (case-insensitive), newest
/// edit first. Reads in parallel off the UI thread.
#[tauri::command]
pub async fn list_typed_notes(
    types: Vec<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<TypedNote>, AppError> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let state = app.state::<AppState>().get_or_create(webview.label());
    let files: Vec<IndexedFile> = state.file_index.read().clone();
    tauri::async_runtime::spawn_blocking(move || Ok(list_typed_notes_impl(&files, &types)))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

pub fn list_typed_notes_impl(files: &[IndexedFile], types: &[String]) -> Vec<TypedNote> {
    let wanted: Vec<String> = types.iter().map(|t| t.trim().to_lowercase()).collect();
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
                        .filter_map(|file| typed_note(file, wanted))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().unwrap_or_default())
            .collect()
    });
    out.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    out
}

fn typed_note(file: &IndexedFile, wanted: &[String]) -> Option<TypedNote> {
    let meta = cached_meta(&file.path)?;
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

fn cached_meta(path: &Path) -> Option<Arc<NoteMeta>> {
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
    Some(meta)
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
    let mut excerpt = None;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#')
            || trimmed.starts_with("![")
            || trimmed.starts_with("```")
            || trimmed.starts_with("<!--")
            || trimmed.starts_with('|')
            || trimmed == "---"
        {
            continue;
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
        if text.is_empty() {
            continue;
        }
        excerpt = Some(truncate_chars(text, EXCERPT_MAX_CHARS));
        break;
    }
    NoteMeta {
        properties,
        title: title.filter(|t| !t.is_empty()),
        excerpt,
    }
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
        let notes = list_typed_notes_impl(&files, &["Book".into(), "youtube".into()]);
        let names: Vec<_> = notes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["e", "b", "a"]);
        assert_eq!(notes[2].note_type, "book");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
