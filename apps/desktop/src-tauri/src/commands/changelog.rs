//! The What's new card's source (SPECs/whats-new-card-spec.md): CHANGELOG.md
//! as it was when this build was made. Built in, not fetched, so the card
//! only has news when the app itself is updated.

use crate::error::AppError;

const CHANGELOG: &str = include_str!("../../../../../CHANGELOG.md");

/// The changelog this build was made with. `PENSEE_CHANGELOG_FILE` reads a
/// local file instead (the e2e journeys).
#[tauri::command]
pub async fn read_changelog() -> Result<String, AppError> {
    if let Ok(path) = std::env::var("PENSEE_CHANGELOG_FILE") {
        return Ok(tokio::fs::read_to_string(&path).await?);
    }
    Ok(CHANGELOG.to_owned())
}
