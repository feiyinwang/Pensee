//! Agent chat: keeps one headless Claude Code per window running in the
//! workspace, feeds it messages on stdin and forwards its stream-json stdout
//! to that window, one line per event.
//! Parsing lives in the frontend (`lib/agent-stream.ts`) so it stays testable
//! without a process. See SPECs/agent-chat-spec.md.

use crate::error::AppError;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const PATH_MARKER: &str = "__PENSEE_AGENT_PATH__=";
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const STDERR_TAIL_LINES: usize = 8;
/** The built-in tools the chat needs to read, find and edit pages. */
const AGENT_TOOLS: &str = "Read,Edit,Write,Glob,Grep";

/// Which of a window's Claude processes a call means. The chat keeps one
/// conversation; the second pen (SPECs/second-pen-spec.md) writes one line
/// per request from what the request carries, with no tools and nothing
/// saved, in a process of its own so it never waits on or enters the chat.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Channel {
    Chat,
    Pen,
}

impl Channel {
    fn parse(name: Option<&str>) -> Result<Self, AppError> {
        match name {
            None | Some("chat") => Ok(Self::Chat),
            Some("pen") => Ok(Self::Pen),
            Some(other) => Err(AppError::Io(format!("unknown agent channel: {other}"))),
        }
    }

    /// The sessions map key: a window's label, plus the channel's suffix.
    fn key(self, label: &str) -> String {
        match self {
            Self::Chat => label.to_owned(),
            Self::Pen => format!("{label}#pen"),
        }
    }
}

/// Each window's Claude processes, by `Channel::key`.
#[derive(Default)]
pub struct AgentState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLine {
    request_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExit {
    request_id: String,
    code: Option<i32>,
    stderr: String,
}

/// The login shell's PATH plus the resolved `claude` binary. An app launched
/// from Finder inherits launchd's minimal PATH, not the terminal's, so both
/// are probed once from `$SHELL -ilc` and cached for the process lifetime.
struct ClaudeEnv {
    path: Option<OsString>,
    binary: Option<PathBuf>,
}

fn claude_env() -> &'static ClaudeEnv {
    static ENV: OnceLock<ClaudeEnv> = OnceLock::new();
    ENV.get_or_init(|| {
        let path = probe_login_path();
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let binary = resolve_claude_binary(path.as_deref(), home.as_deref(), |p| p.is_file());
        ClaudeEnv { path, binary }
    })
}

/// A `claude` command with the login shell's PATH, or the error to show when
/// Claude Code isn't installed. The chat, the pen and sign-in all start here.
pub(crate) fn claude_command() -> Result<Command, AppError> {
    let env = claude_env();
    let binary = env.binary.as_ref().ok_or_else(|| {
        AppError::User(
            "Claude Code isn't installed. Install it from claude.com/code, then try again."
                .to_owned(),
        )
    })?;
    let mut command = Command::new(binary);
    if let Some(path) = &env.path {
        command.env("PATH", path);
    }
    Ok(command)
}

fn probe_login_path() -> Option<OsString> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg(format!("printf '\\n{PATH_MARKER}%s\\n' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // An interactive rc can block (update prompts, plugin managers). Bound it
    // and fall back to the fixed install locations rather than hang a send.
    let deadline = Instant::now() + SHELL_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let output = child.wait_with_output().ok()?;
    parse_path_probe(&String::from_utf8_lossy(&output.stdout)).map(OsString::from)
}

fn parse_path_probe(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(PATH_MARKER))
        .map(str::to_owned)
        .filter(|path| !path.is_empty())
}

/// First `claude` found on the login PATH, then the known install locations.
fn resolve_claude_binary(
    login_path: Option<&std::ffi::OsStr>,
    home: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = login_path
        .map(|path| {
            std::env::split_paths(path)
                .map(|dir| dir.join("claude"))
                .collect()
        })
        .unwrap_or_default();
    if let Some(home) = home {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.into_iter().find(|candidate| exists(candidate))
}

fn build_args(
    session_id: Option<&str>,
    instructions: &str,
    model: &str,
    channel: Channel,
) -> Vec<String> {
    let mut args = vec![
        // One long-lived process per window: messages arrive as stream-json
        // lines on stdin, so a question skips Claude Code's ~0.7 s startup.
        "-p".to_owned(),
        "--input-format".to_owned(),
        "stream-json".to_owned(),
        "--output-format".to_owned(),
        "stream-json".to_owned(),
        "--verbose".to_owned(),
        "--include-partial-messages".to_owned(),
        "--model".to_owned(),
        model.to_owned(),
        // A lean Claude: the terminal's MCP servers, plugins (and their hooks),
        // skills and user settings cost 15-30 s before the first word and
        // ~25k tokens of tool definitions per message. The chat reads and
        // edits workspace files, nothing more. Auth is unaffected.
        "--strict-mcp-config".to_owned(),
        "--disable-slash-commands".to_owned(),
        "--setting-sources".to_owned(),
        "project,local".to_owned(),
        "--tools".to_owned(),
        match channel {
            Channel::Chat => AGENT_TOOLS,
            // The pen gets everything it may use in the request itself.
            Channel::Pen => "",
        }
        .to_owned(),
        // Execution mode: reads and edits run without prompts; nothing is planned first.
        "--permission-mode".to_owned(),
        "acceptEdits".to_owned(),
        "--append-system-prompt".to_owned(),
        instructions.to_owned(),
    ];
    if channel == Channel::Pen {
        args.push("--no-session-persistence".to_owned());
    }
    if let Some(session_id) = session_id {
        args.push("--resume".to_owned());
        args.push(session_id.to_owned());
    }
    args
}

/// One user turn as a stream-json input line.
fn message_line(prompt: &str) -> String {
    serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": prompt },
    })
    .to_string()
}

/// What a running process was started with. A send or warm-up with a
/// different key replaces the process (resuming the conversation).
#[derive(Clone, PartialEq)]
struct SpawnKey {
    root: PathBuf,
    model: String,
    instructions: String,
    channel: Channel,
}

/// A window's Claude process. Idle between messages; `current` is the request
/// whose reply is streaming, and every stdout line is tagged with it.
struct Session {
    key: SpawnKey,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    current: Mutex<Option<String>>,
}

/// The running process for this window, started (or replaced) when missing,
/// exited, or started with a different key.
fn ensure_session(
    app: &tauri::AppHandle,
    label: &str,
    key: SpawnKey,
    session_id: Option<&str>,
) -> Result<Arc<Session>, AppError> {
    let state = app.state::<AgentState>();
    let session_key = key.channel.key(label);
    // Held across the spawn so a warm-up and a send can't both start one.
    let mut sessions = state.sessions.lock();
    if let Some(existing) = sessions.get(&session_key) {
        let alive = matches!(existing.child.lock().try_wait(), Ok(None));
        if alive && existing.key == key {
            return Ok(existing.clone());
        }
        let _ = existing.child.lock().kill();
    }

    let mut command = claude_command()?;
    command
        .args(build_args(
            session_id,
            &key.instructions,
            &key.model,
            key.channel,
        ))
        .current_dir(&key.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Io("no stdin".to_owned()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session = Arc::new(Session {
        key,
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        current: Mutex::new(None),
    });
    sessions.insert(session_key.clone(), session.clone());
    start_forwarding(
        app.clone(),
        label.to_owned(),
        session_key,
        session.clone(),
        stdout,
        stderr,
    );
    Ok(session)
}

fn spawn_key(
    app: &tauri::AppHandle,
    label: &str,
    model: String,
    instructions: String,
    channel: Channel,
) -> Result<SpawnKey, AppError> {
    let state = app.state::<AppState>().get_or_create(label);
    let (root, _) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    Ok(SpawnKey {
        root,
        model,
        instructions,
        channel,
    })
}

/// Start this window's Claude ahead of the first question (panel opened, a
/// book opened, model changed), so the question doesn't wait for startup.
#[tauri::command]
pub async fn agent_warm(
    session_id: Option<String>,
    instructions: String,
    model: String,
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let channel = Channel::parse(channel.as_deref())?;
    let key = spawn_key(&app, &label, model, instructions, channel)?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_session(&app, &label, key, session_id.as_deref()).map(|_| ())
    })
    .await
    .map_err(|error| AppError::Io(error.to_string()))?
}

#[tauri::command]
// Each argument is a field of the frontend's invoke payload.
#[allow(clippy::too_many_arguments)]
pub async fn agent_send(
    request_id: String,
    prompt: String,
    session_id: Option<String>,
    instructions: String,
    model: String,
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let channel = Channel::parse(channel.as_deref())?;
    let key = spawn_key(&app, &label, model, instructions, channel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let session = ensure_session(&app, &label, key, session_id.as_deref())?;
        *session.current.lock() = Some(request_id);
        let mut stdin = session.stdin.lock();
        writeln!(stdin, "{}", message_line(&prompt))
            .and_then(|()| stdin.flush())
            .map_err(|error| {
                let _ = session.child.lock().kill();
                AppError::Io(format!(
                    "Claude stopped before the message reached it: {error}"
                ))
            })
    })
    .await
    .map_err(|error| AppError::Io(error.to_string()))?
}

fn start_forwarding(
    app: tauri::AppHandle,
    label: String,
    session_key: String,
    session: Arc<Session>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
) {
    let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let stderr_reader = stderr.map(|stderr| {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut tail = tail.lock();
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        })
    });

    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                // Nothing is asked yet: startup output belongs to no request.
                let Some(request_id) = session.current.lock().clone() else {
                    continue;
                };
                let _ = app.emit_to(label.as_str(), "agent:line", AgentLine { request_id, line });
            }
        }
        if let Some(reader) = stderr_reader {
            let _ = reader.join();
        }
        let code = session
            .child
            .lock()
            .wait()
            .ok()
            .and_then(|status| status.code());
        {
            let state = app.state::<AgentState>();
            let mut sessions = state.sessions.lock();
            if sessions
                .get(&session_key)
                .is_some_and(|s| Arc::ptr_eq(s, &session))
            {
                sessions.remove(&session_key);
            }
        }
        // The frontend ignores this unless that request is still running, so
        // an idle process being replaced or quitting stays silent.
        if let Some(request_id) = session.current.lock().take() {
            let stderr = stderr_tail
                .lock()
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            let _ = app.emit_to(
                label.as_str(),
                "agent:exit",
                AgentExit {
                    request_id,
                    code,
                    stderr,
                },
            );
        }
    });
}

/// Kill a running agent. The reader thread sees EOF and emits `agent:exit`;
/// the next send starts a new process resuming the conversation. A request
/// that already finished is a no-op.
#[tauri::command]
pub fn agent_cancel(
    request_id: String,
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let key = Channel::parse(channel.as_deref())?.key(webview.label());
    let session = app.state::<AgentState>().sessions.lock().get(&key).cloned();
    if let Some(session) = session {
        if session.current.lock().as_deref() == Some(request_id.as_str()) {
            let _ = session.child.lock().kill();
        }
    }
    Ok(())
}

/// New chat (or the pen's next request): end that channel's process so the
/// next one starts fresh.
#[tauri::command]
pub fn agent_reset(
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let key = Channel::parse(channel.as_deref())?.key(webview.label());
    kill_session(&app, &key);
    Ok(())
}

fn kill_session(app: &tauri::AppHandle, key: &str) {
    let session = app.state::<AgentState>().sessions.lock().remove(key);
    if let Some(session) = session {
        let _ = session.child.lock().kill();
    }
}

/// Kill every window's processes, so the next request starts a fresh Claude
/// (after signing in: a running one keeps the sign-in it started with). Every
/// window is told with `agent:ended`, so what it had warm is warmed again and
/// the first request after signing in doesn't wait for Claude to start.
pub(crate) fn end_all_sessions(app: &tauri::AppHandle) {
    let sessions: Vec<_> = app
        .state::<AgentState>()
        .sessions
        .lock()
        .drain()
        .map(|(_, session)| session)
        .collect();
    for session in sessions {
        let _ = session.child.lock().kill();
    }
    if let Err(error) = app.emit("agent:ended", ()) {
        eprintln!("[agent] Couldn't tell the windows their Claude ended: {error}");
    }
}

/// Kill all of a window's processes. Called when the window closes.
pub fn close_window_session(app: &tauri::AppHandle, label: &str) {
    for channel in [Channel::Chat, Channel::Pen] {
        kill_session(app, &channel.key(label));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_process_has_no_resume() {
        let args = build_args(None, "ctx", "haiku", Channel::Chat);
        assert_eq!(
            args,
            [
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--model",
                "haiku",
                "--strict-mcp-config",
                "--disable-slash-commands",
                "--setting-sources",
                "project,local",
                "--tools",
                "Read,Edit,Write,Glob,Grep",
                "--permission-mode",
                "acceptEdits",
                "--append-system-prompt",
                "ctx"
            ]
        );
    }

    #[test]
    fn replacement_process_resumes_session() {
        let args = build_args(Some("abc"), "ctx", "opus", Channel::Chat);
        assert_eq!(&args[args.len() - 2..], ["--resume", "abc"]);
    }

    #[test]
    fn pen_has_no_tools_and_saves_nothing() {
        let args = build_args(None, "pen", "haiku", Channel::Pen);
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(args[tools + 1], "");
        assert!(args.iter().any(|a| a == "--no-session-persistence"));
        assert!(!args.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn channels_have_their_own_sessions() {
        assert_eq!(Channel::parse(None).unwrap().key("main"), "main");
        assert_eq!(Channel::parse(Some("chat")).unwrap().key("main"), "main");
        assert_eq!(Channel::parse(Some("pen")).unwrap().key("main"), "main#pen");
        assert!(Channel::parse(Some("other")).is_err());
    }

    #[test]
    fn message_is_one_stream_json_line() {
        let line = message_line("two\nlines \"quoted\"");
        assert!(!line.contains('\n'));
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["type"], "user");
        assert_eq!(value["message"]["content"], "two\nlines \"quoted\"");
    }

    #[test]
    fn path_probe_ignores_rc_noise() {
        let out = format!("welcome!\n\n{PATH_MARKER}/a/bin:/b/bin\n");
        assert_eq!(parse_path_probe(&out).as_deref(), Some("/a/bin:/b/bin"));
        assert_eq!(parse_path_probe("no marker"), None);
        assert_eq!(parse_path_probe(&format!("{PATH_MARKER}\n")), None);
    }

    #[test]
    fn binary_prefers_login_path_then_fallbacks() {
        let path = OsString::from("/x/bin:/y/bin");
        let home = Path::new("/home/me");
        let found = resolve_claude_binary(Some(&path), Some(home), |p| {
            p == Path::new("/y/bin/claude") || p == Path::new("/home/me/.local/bin/claude")
        });
        assert_eq!(found, Some(PathBuf::from("/y/bin/claude")));

        let found = resolve_claude_binary(None, Some(home), |p| {
            p == Path::new("/home/me/.local/bin/claude") || p == Path::new("/usr/local/bin/claude")
        });
        assert_eq!(found, Some(PathBuf::from("/home/me/.local/bin/claude")));

        assert_eq!(resolve_claude_binary(None, None, |_| false), None);
    }
}
