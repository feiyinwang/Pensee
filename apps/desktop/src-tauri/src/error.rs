use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Already exists: {0}")]
    AlreadyExists(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("No workspace is open")]
    NoWorkspace,
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Network error: {0}")]
    Network(String),
    /// A message written for the user as-is (no category prefix).
    #[error("{0}")]
    User(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}
