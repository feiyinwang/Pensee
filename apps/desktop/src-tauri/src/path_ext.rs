//! One spelling for every path the frontend sees. The frontend keys tabs,
//! pins, expanded folders and watcher events by path string and builds paths
//! with "/", so a path must reach it in that form. On macOS and Linux that is
//! the path as it is. On Windows, `canonicalize` hands back verbatim paths
//! (`\\?\C:\vault`) that reject "/" when joined, and `Path::join` writes "\",
//! so both are rewritten: `C:/vault/note.md`. Windows accepts "/" in every
//! path it is given back.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

pub trait PathExt {
    /// The path as the frontend spells it. Use in place of
    /// `to_string_lossy` wherever the string is sent over IPC.
    fn to_ipc_lossy(&self) -> Cow<'_, str>;

    /// `canonicalize` without Windows' verbatim `\\?\` prefix.
    fn canonical(&self) -> std::io::Result<PathBuf>;
}

impl PathExt for Path {
    #[cfg(not(windows))]
    fn to_ipc_lossy(&self) -> Cow<'_, str> {
        self.to_string_lossy()
    }

    #[cfg(windows)]
    fn to_ipc_lossy(&self) -> Cow<'_, str> {
        Cow::Owned(windows_ipc(&dunce::simplified(self).to_string_lossy()))
    }

    fn canonical(&self) -> std::io::Result<PathBuf> {
        dunce::canonicalize(self)
    }
}

#[cfg(any(windows, test))]
fn windows_ipc(path: &str) -> String {
    path.replace('\\', "/")
}

/// `#[serde(serialize_with = "crate::path_ext::serialize")]` for a `PathBuf`
/// field that goes to the frontend.
pub fn serialize<S: serde::Serializer>(path: &Path, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&path.to_ipc_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_use_forward_slashes() {
        assert_eq!(
            windows_ipc(r"C:\Users\me\vault\a.md"),
            "C:/Users/me/vault/a.md"
        );
        assert_eq!(windows_ipc("C:/already/fine.md"), "C:/already/fine.md");
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_paths_are_unchanged() {
        let path = Path::new("/Users/me/vault/a b.md");
        assert!(matches!(
            path.to_ipc_lossy(),
            Cow::Borrowed("/Users/me/vault/a b.md")
        ));
    }
}
