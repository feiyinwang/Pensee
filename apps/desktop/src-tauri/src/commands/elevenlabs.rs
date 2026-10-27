//! ElevenLabs Scribe, the optional cloud transcription for talk notes
//! (SPECs/talk-notes-spec.md#transcription). Off until you paste your own API
//! key in Settings; the key lives in the system keychain (Keychain on the Mac,
//! Credential Manager on Windows), never in settings.json. At Stop the take's
//! audio file is sent once, and Scribe's words come back with their times,
//! grouped here into lines like Whisper's.

use std::path::{Component, Path};

use parking_lot::Mutex;
use serde::Deserialize;

use crate::commands::talk::window_root;
use crate::commands::whisper::Segment;
use crate::error::AppError;

const SERVICE: &str = "com.pensee.app.elevenlabs";
const ACCOUNT: &str = "api-key";
const API: &str = "https://api.elevenlabs.io/v1";
const MODEL: &str = "scribe_v2";

/// A line ends at a sentence's end, at a pause this long, or at this many words.
const PAUSE_S: f64 = 1.2;
const MAX_WORDS: usize = 40;

/// The e2e journeys' ElevenLabs (`PENSEE_ELEVENLABS_SCRIPT`, set by
/// e2e/qa/run.sh): the key stays in memory instead of the keychain, the key
/// `good-key` passes Check key, and a transcription returns the file's words.
#[derive(Deserialize)]
struct Script {
    words: Vec<Word>,
}

fn script() -> Option<Script> {
    let path = std::env::var("PENSEE_ELEVENLABS_SCRIPT").ok()?;
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn scripted() -> bool {
    std::env::var_os("PENSEE_ELEVENLABS_SCRIPT").is_some()
}

static SCRIPT_KEY: Mutex<Option<String>> = Mutex::new(None);
const SCRIPT_GOOD_KEY: &str = "good-key";

fn entry() -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Io(e.to_string()))
}

fn stored_key() -> Result<Option<String>, AppError> {
    if scripted() {
        return Ok(SCRIPT_KEY.lock().clone());
    }
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Io(format!("The keychain couldn't be read: {e}"))),
    }
}

fn required_key() -> Result<String, AppError> {
    stored_key()?.ok_or_else(|| {
        AppError::User("Add your ElevenLabs API key in Settings → Transcription.".into())
    })
}

/// Whether a key is saved (the key itself never goes back to the web view).
#[tauri::command]
pub fn elevenlabs_key_saved() -> Result<bool, AppError> {
    Ok(stored_key()?.is_some())
}

/// Saves the key, or removes it when `key` is empty.
#[tauri::command]
pub fn elevenlabs_save_key(key: String) -> Result<(), AppError> {
    let key = key.trim();
    if scripted() {
        *SCRIPT_KEY.lock() = (!key.is_empty()).then(|| key.to_string());
        return Ok(());
    }
    let entry = entry()?;
    if key.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Io(format!(
                "The keychain couldn't be changed: {e}"
            ))),
        };
    }
    entry
        .set_password(key)
        .map_err(|e| AppError::Io(format!("The keychain couldn't be changed: {e}")))
}

fn refused(status: reqwest::StatusCode, body: &str) -> AppError {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            let d = &v["detail"];
            d["message"].as_str().or(d.as_str()).map(str::to_string)
        })
        .unwrap_or_else(|| status.to_string());
    match status.as_u16() {
        401 => AppError::User(format!("ElevenLabs refused the key: {detail}")),
        _ => AppError::Network(format!("ElevenLabs: {detail}")),
    }
}

/// Asks ElevenLabs whether the saved key works.
#[tauri::command]
pub async fn elevenlabs_check_key() -> Result<(), AppError> {
    let key = required_key()?;
    if scripted() {
        return if key == SCRIPT_GOOD_KEY {
            Ok(())
        } else {
            Err(AppError::User(
                "ElevenLabs refused the key: Invalid API key".into(),
            ))
        };
    }
    let response = reqwest::Client::new()
        .get(format!("{API}/models"))
        .header("xi-api-key", key)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(refused(status, &body))
}

#[derive(Deserialize)]
struct Transcript {
    words: Vec<Word>,
}

#[derive(Deserialize, Clone)]
struct Word {
    text: String,
    start: f64,
    end: f64,
    #[serde(rename = "type", default)]
    kind: String,
}

/// Scribe's words as lines: spacing is kept in the text, audio events
/// ("(laughs)") are dropped.
fn lines(words: &[Word]) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut text = String::new();
    let mut start = 0.0;
    let mut end = 0.0;
    let mut count = 0;
    let mut flush = |text: &mut String, start: f64, end: f64, count: &mut usize| {
        let line = text.trim();
        if !line.is_empty() {
            out.push(Segment {
                start,
                end,
                text: line.to_string(),
            });
        }
        text.clear();
        *count = 0;
    };
    for w in words {
        match w.kind.as_str() {
            "audio_event" => continue,
            "spacing" => {
                if !text.is_empty() {
                    text.push_str(&w.text);
                }
                continue;
            }
            _ => {}
        }
        if count > 0 && w.start - end >= PAUSE_S {
            flush(&mut text, start, end, &mut count);
        }
        if count == 0 {
            start = w.start;
        }
        text.push_str(&w.text);
        end = w.end;
        count += 1;
        let sentence_end = w.text.ends_with(['.', '?', '!', '。', '？', '！']);
        if sentence_end || count >= MAX_WORDS {
            flush(&mut text, start, end, &mut count);
        }
    }
    flush(&mut text, start, end, &mut count);
    out
}

/// A take is a file under the workspace's `Recordings/`, given as the note links it.
fn recording(root: &Path, file: &str) -> Result<std::path::PathBuf, AppError> {
    let rel = Path::new(file);
    let safe = rel.starts_with("Recordings")
        && rel.components().all(|c| matches!(c, Component::Normal(_)));
    if !safe {
        return Err(AppError::InvalidPath(file.to_string()));
    }
    Ok(root.join(rel))
}

/// Transcribes one saved take with Scribe.
#[tauri::command]
pub async fn elevenlabs_transcribe(
    file: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<Segment>, AppError> {
    let key = required_key()?;
    if scripted() {
        let script = script()
            .ok_or_else(|| AppError::User("The journey wrote no ElevenLabs script.".into()))?;
        return Ok(lines(&script.words));
    }
    let path = recording(&window_root(&webview, &app)?, &file)?;
    let bytes = tokio::fs::read(&path).await?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "take.m4a".into());
    let form = reqwest::multipart::Form::new()
        .text("model_id", MODEL)
        .text("timestamps_granularity", "word")
        .text("tag_audio_events", "false")
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(name),
        );
    let response = reqwest::Client::new()
        .post(format!("{API}/speech-to-text"))
        .header("xi-api-key", key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(refused(status, &body));
    }
    let transcript: Transcript = serde_json::from_str(&body).map_err(|e| {
        AppError::Network(format!("ElevenLabs sent an answer Pensée can't read: {e}"))
    })?;
    Ok(lines(&transcript.words))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, start: f64, end: f64, kind: &str) -> Word {
        Word {
            text: text.into(),
            start,
            end,
            kind: kind.into(),
        }
    }

    #[test]
    fn words_become_lines_at_sentence_ends_and_pauses() {
        let words = [
            word("Hello", 0.0, 0.4, "word"),
            word(" ", 0.4, 0.5, "spacing"),
            word("there.", 0.5, 0.9, "word"),
            word(" ", 0.9, 1.0, "spacing"),
            word("(laughs)", 1.0, 1.5, "audio_event"),
            word("Next", 1.6, 1.9, "word"),
            word(" ", 1.9, 2.0, "spacing"),
            word("thing", 2.0, 2.3, "word"),
            word("after", 4.0, 4.3, "word"),
            word(" ", 4.3, 4.4, "spacing"),
            word("a", 4.4, 4.5, "word"),
            word(" ", 4.5, 4.6, "spacing"),
            word("pause", 4.6, 5.0, "word"),
        ];
        let out = lines(&words);
        let texts: Vec<_> = out.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["Hello there.", "Next thing", "after a pause"]);
        assert_eq!((out[1].start, out[1].end), (1.6, 2.3));
    }

    #[test]
    fn only_files_under_recordings_are_sent() {
        let root = Path::new("/w");
        assert!(recording(root, "Recordings/2026-10-27 09.00.m4a").is_ok());
        assert!(recording(root, "Recordings/../secret.md").is_err());
        assert!(recording(root, "/etc/passwd").is_err());
        assert!(recording(root, "Notes/a.m4a").is_err());
    }
}
