//! Free, on-device transcription for talk notes (SPECs/talk-notes-spec.md#transcription):
//! OpenAI's Whisper through whisper.cpp, Metal on the Mac. The model downloads
//! once into the app's data folder. While a take records, the web view sends
//! 16 kHz mono samples here (`talk_pcm_append`), so the take is transcribed
//! from what was heard, with no audio decoder.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::AppError;

/// Samples a second, as Whisper wants them.
pub const SAMPLE_RATE: usize = 16_000;

/// The e2e journeys' Whisper (`PENSEE_WHISPER_SCRIPT`, set by e2e/qa/run.sh):
/// a JSON file `{"installed": bool, "segments": [...]}` the journey writes.
/// Each live pass returns the next two lines; a full pass returns them all.
/// The file is read on every call, so a journey can change it between takes.
#[derive(serde::Deserialize)]
struct Script {
    installed: bool,
    segments: Vec<ScriptLine>,
}

#[derive(serde::Deserialize)]
struct ScriptLine {
    start: f64,
    end: f64,
    text: String,
}

fn script() -> Option<Script> {
    let path = std::env::var("PENSEE_WHISPER_SCRIPT").ok()?;
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn scripted(lines: &[ScriptLine]) -> Vec<Segment> {
    lines
        .iter()
        .map(|l| Segment {
            start: l.start,
            end: l.end,
            text: l.text.clone(),
        })
        .collect()
}

/// How many lines each take's live passes have handed out, by session.
static SCRIPT_PASSES: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const SCRIPT_LINES_PER_PASS: usize = 2;

struct Model {
    id: &'static str,
    name: &'static str,
    file: &'static str,
    bytes: u64,
}

const MODELS: [Model; 2] = [
    Model {
        id: "small",
        name: "Whisper Small",
        file: "ggml-small.bin",
        bytes: 487_601_967,
    },
    Model {
        id: "turbo",
        name: "Whisper Large v3 Turbo",
        file: "ggml-large-v3-turbo.bin",
        bytes: 1_624_555_275,
    },
];
const MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

fn model(id: &str) -> Result<&'static Model, AppError> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::User(format!("No Whisper model called {id}.")))
}

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join("whisper");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// A model is installed when its file is there at its full size (a stopped download leaves only `.part`).
fn installed(dir: &Path, m: &Model) -> bool {
    std::fs::metadata(dir.join(m.file))
        .map(|meta| meta.len() == m.bytes)
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: &'static str,
    name: &'static str,
    bytes: u64,
    installed: bool,
}

#[tauri::command]
pub fn whisper_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, AppError> {
    if let Some(script) = script() {
        return Ok(MODELS
            .iter()
            .map(|m| ModelInfo {
                id: m.id,
                name: m.name,
                bytes: m.bytes,
                installed: script.installed,
            })
            .collect());
    }
    let dir = models_dir(&app)?;
    Ok(MODELS
        .iter()
        .map(|m| ModelInfo {
            id: m.id,
            name: m.name,
            bytes: m.bytes,
            installed: installed(&dir, m),
        })
        .collect())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: &'static str,
    received: u64,
    total: u64,
}

/// Downloads a model, sending `whisper:progress` as it goes.
#[tauri::command]
pub async fn whisper_download(id: String, app: tauri::AppHandle) -> Result<(), AppError> {
    let m = model(&id)?;
    let dir = models_dir(&app)?;
    if installed(&dir, m) {
        return Ok(());
    }
    let part = dir.join(format!("{}.part", m.file));
    let mut response = reqwest::get(format!("{MODEL_BASE_URL}{}", m.file))
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let total = response.content_length().unwrap_or(m.bytes);
    let mut file = std::fs::File::create(&part)?;
    let mut received = 0u64;
    let mut last_sent = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
    {
        file.write_all(&chunk)?;
        received += chunk.len() as u64;
        // About every 1% (every chunk would flood the window with events).
        if received - last_sent >= total / 100 || received == total {
            last_sent = received;
            let _ = app.emit(
                "whisper:progress",
                Progress {
                    id: m.id,
                    received,
                    total,
                },
            );
        }
    }
    file.sync_all()?;
    drop(file);
    if received != m.bytes {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::Network(format!(
            "The download stopped at {received} of {} bytes.",
            m.bytes
        )));
    }
    std::fs::rename(&part, dir.join(m.file))?;
    Ok(())
}

/// The samples heard so far in each take being recorded, by session id.
static SESSIONS: LazyLock<Mutex<HashMap<String, Vec<f32>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub fn talk_pcm_begin() -> String {
    let id = uuid::Uuid::new_v4().to_string();
    SESSIONS
        .lock()
        .insert(id.clone(), Vec::with_capacity(SAMPLE_RATE * 60));
    id
}

/// Body: little-endian f32 samples at 16 kHz mono. Header `x-session`.
#[tauri::command]
pub fn talk_pcm_append(request: Request<'_>) -> Result<usize, AppError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::User("Audio arrived in the wrong form.".into()));
    };
    let session = request
        .headers()
        .get("x-session")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::User("Missing x-session.".into()))?;
    let mut sessions = SESSIONS.lock();
    let samples = sessions
        .get_mut(session)
        .ok_or_else(|| AppError::User("That take has ended.".into()))?;
    samples.extend(
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
    );
    Ok(samples.len())
}

/// Forgets a take's samples (a cancelled take, or after its transcript).
#[tauri::command]
pub fn talk_pcm_drop(session: String) {
    SESSIONS.lock().remove(&session);
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Segment {
    /// Seconds from the start of the take.
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// One context per model, loaded once: loading Whisper Small takes about a second.
type LoadedModel = Option<(PathBuf, Arc<WhisperContext>)>;
static CONTEXT: LazyLock<Mutex<LoadedModel>> = LazyLock::new(|| Mutex::new(None));

fn context_for(path: &Path) -> Result<Arc<WhisperContext>, AppError> {
    let mut cached = CONTEXT.lock();
    if let Some((p, ctx)) = cached.as_ref() {
        if p == path {
            return Ok(ctx.clone());
        }
    }
    let ctx = WhisperContext::new_with_params(path, WhisperContextParameters::default())
        .map_err(|e| AppError::User(format!("Whisper couldn't load its model: {e}")))?;
    let ctx = Arc::new(ctx);
    *cached = Some((path.to_path_buf(), ctx.clone()));
    Ok(ctx)
}

/// Lines Whisper writes for silence or noise, which aren't speech.
fn is_noise(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || (t.starts_with('[') && t.ends_with(']'))
        || (t.starts_with('(') && t.ends_with(')'))
}

pub fn transcribe(model_path: &Path, samples: &[f32]) -> Result<Vec<Segment>, AppError> {
    if samples.len() < SAMPLE_RATE / 2 {
        return Ok(Vec::new());
    }
    let ctx = context_for(model_path)?;
    let mut state = ctx
        .create_state()
        .map_err(|e| AppError::User(format!("Whisper couldn't start: {e}")))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("auto"));
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);
    params.set_n_threads(threads as i32);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    state
        .full(params, samples)
        .map_err(|e| AppError::User(format!("Whisper stopped: {e}")))?;
    let mut segments = Vec::new();
    for seg in state.as_iter() {
        let text = seg
            .to_str_lossy()
            .map(|t| t.trim().to_string())
            .unwrap_or_default();
        if is_noise(&text) || seg.no_speech_probability() > 0.6 {
            continue;
        }
        // Whisper counts in hundredths of a second.
        segments.push(Segment {
            start: seg.start_timestamp() as f64 / 100.0,
            end: seg.end_timestamp() as f64 / 100.0,
            text,
        });
    }
    Ok(segments)
}

/// Transcribes everything a take has heard with `model`, then forgets its samples.
#[tauri::command]
pub async fn talk_transcribe(
    session: String,
    model: String,
    app: tauri::AppHandle,
) -> Result<Vec<Segment>, AppError> {
    if let Some(script) = script() {
        SESSIONS.lock().remove(&session);
        SCRIPT_PASSES.lock().remove(&session);
        return Ok(scripted(&script.segments));
    }
    let m = self::model(&model)?;
    let dir = models_dir(&app)?;
    if !installed(&dir, m) {
        return Err(AppError::User(format!("{} isn't downloaded yet.", m.name)));
    }
    let samples = SESSIONS
        .lock()
        .remove(&session)
        .ok_or_else(|| AppError::User("That take has no audio.".into()))?;
    let path = dir.join(m.file);
    tokio::task::spawn_blocking(move || transcribe(&path, &samples))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[derive(Serialize)]
pub struct LiveResult {
    pub segments: Vec<Segment>,
    /// Where the next live pass starts, in samples: after the last segment kept.
    pub next: usize,
}

/// Speech within this much of the end may still be mid-sentence: left for the next pass.
const LIVE_HOLD_SAMPLES: usize = SAMPLE_RATE * 3 / 2;

/// What a live pass keeps: segments that end before the last 1.5 s (unless
/// the take has ended), shifted to the take's own clock, and where to resume.
pub fn keep_live(segments: Vec<Segment>, from: usize, heard: usize, last: bool) -> LiveResult {
    let cutoff = if last {
        f64::INFINITY
    } else {
        heard.saturating_sub(from + LIVE_HOLD_SAMPLES) as f64 / SAMPLE_RATE as f64
    };
    let offset = from as f64 / SAMPLE_RATE as f64;
    let kept: Vec<Segment> = segments
        .into_iter()
        .take_while(|s| s.end <= cutoff)
        .collect();
    let next = match kept.last() {
        Some(s) if !last => from + (s.end * SAMPLE_RATE as f64) as usize,
        _ if last => heard,
        _ => from,
    };
    LiveResult {
        segments: kept
            .into_iter()
            .map(|s| Segment {
                start: s.start + offset,
                end: s.end + offset,
                text: s.text,
            })
            .collect(),
        next,
    }
}

/// While a take records: transcribes what was heard from `from` (samples) on,
/// for the live view, without forgetting the take's samples. `last` keeps the
/// final words too (the pass after Stop).
#[tauri::command]
pub async fn talk_transcribe_live(
    session: String,
    model: String,
    from: usize,
    last: bool,
    app: tauri::AppHandle,
) -> Result<LiveResult, AppError> {
    if let Some(script) = script() {
        let mut passes = SCRIPT_PASSES.lock();
        let given = passes.entry(session).or_insert(0);
        let take = if last {
            script.segments.len()
        } else {
            (*given + SCRIPT_LINES_PER_PASS).min(script.segments.len())
        };
        let lines = scripted(&script.segments[(*given).min(take)..take]);
        *given = take;
        return Ok(LiveResult {
            segments: lines,
            next: from + SAMPLE_RATE,
        });
    }
    let m = self::model(&model)?;
    let dir = models_dir(&app)?;
    if !installed(&dir, m) {
        return Err(AppError::User(format!("{} isn't downloaded yet.", m.name)));
    }
    let samples: Vec<f32> = {
        let sessions = SESSIONS.lock();
        let all = sessions
            .get(&session)
            .ok_or_else(|| AppError::User("That take has ended.".into()))?;
        all.get(from.min(all.len())..).unwrap_or_default().to_vec()
    };
    let heard = from + samples.len();
    let path = dir.join(m.file);
    tokio::task::spawn_blocking(move || {
        transcribe(&path, &samples).map(|segs| keep_live(segs, from, heard, last))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_pass_keeps_finished_sentences_on_the_take_clock() {
        let seg = |start: f64, end: f64, text: &str| Segment {
            start,
            end,
            text: text.into(),
        };
        // 10 s heard from 20 s in: the last 1.5 s are held back.
        let from = 20 * SAMPLE_RATE;
        let heard = 30 * SAMPLE_RATE;
        let live = keep_live(
            vec![
                seg(0.0, 4.0, "One."),
                seg(4.0, 8.0, "Two."),
                seg(8.0, 9.5, "Thr"),
            ],
            from,
            heard,
            false,
        );
        assert_eq!(
            live.segments,
            vec![seg(20.0, 24.0, "One."), seg(24.0, 28.0, "Two.")]
        );
        assert_eq!(live.next, 28 * SAMPLE_RATE);
        // Nothing finished yet: start again from the same place.
        let none = keep_live(vec![seg(0.0, 9.9, "Still going")], from, heard, false);
        assert!(none.segments.is_empty());
        assert_eq!(none.next, from);
    }

    #[test]
    fn silence_and_noise_markers_are_not_speech() {
        assert!(is_noise("  "));
        assert!(is_noise("[BLANK_AUDIO]"));
        assert!(is_noise("(wind blowing)"));
        assert!(!is_noise("Okay, a few things today."));
    }

    #[test]
    fn pcm_sessions_collect_samples_until_dropped() {
        let id = talk_pcm_begin();
        SESSIONS.lock().get_mut(&id).unwrap().extend([0.0f32, 0.5]);
        assert_eq!(SESSIONS.lock().get(&id).map(Vec::len), Some(2));
        talk_pcm_drop(id.clone());
        assert!(SESSIONS.lock().get(&id).is_none());
    }

    /// A real run, off by default: `WHISPER_TEST_MODEL=…/ggml-tiny.bin WHISPER_TEST_WAV=…/speech.wav
    /// cargo test --lib real_speech -- --ignored` (a 16 kHz mono f32 WAV, as `afconvert -d LEF32@16000 -c 1` writes).
    #[test]
    #[ignore]
    fn real_speech_is_transcribed() {
        let model = std::env::var("WHISPER_TEST_MODEL").unwrap();
        let wav = std::fs::read(std::env::var("WHISPER_TEST_WAV").unwrap()).unwrap();
        let data = wav.windows(4).position(|w| w == b"data").unwrap() + 8;
        let samples: Vec<f32> = wav[data..]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        let segments = transcribe(Path::new(&model), &samples).unwrap();
        let text = segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        eprintln!("{segments:?}");
        assert!(text.contains("quarter"), "{text}");
    }

    #[test]
    fn under_half_a_second_transcribes_to_nothing_without_a_model() {
        assert_eq!(
            transcribe(Path::new("/no/model.bin"), &[0.0; 100]).unwrap(),
            Vec::new()
        );
    }
}
