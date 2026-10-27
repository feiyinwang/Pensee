//! Agent chat: keeps one headless agent CLI per window running in the
//! workspace, feeds it messages on stdin and forwards its stdout to that
//! window, one line per event. The CLI is Claude Code (stream-json) or Codex
//! (`codex app-server`, JSON-RPC), whichever the writer picked.
//! Parsing lives in the frontend (`lib/agent-stream.ts`) so it stays testable
//! without a process. See SPECs/agent-chat-spec.md and SPECs/codex-spec.md.

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
#[cfg(not(windows))]
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[cfg(not(windows))]
const PATH_MARKER: &str = "__PENSEE_AGENT_PATH__=";
#[cfg(not(windows))]
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const STDERR_TAIL_LINES: usize = 8;
/** The built-in tools the chat needs to read, find and edit pages. */
const AGENT_TOOLS: &str = "Read,Edit,Write,Glob,Grep";

/// Which of a window's Claude processes a call means. The chat keeps one
/// conversation; the second pen (SPECs/second-pen-spec.md) writes one line
/// per request from what the request carries, with no tools and nothing
/// saved, in a process of its own so it never waits on or enters the chat.
/// A talk (SPECs/talk-notes-spec.md#while-you-talk-ask) keeps one more: it
/// sorts what you say into topics while you record, in its own process so a
/// pen request mid-talk never waits on it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Channel {
    Chat,
    Pen,
    Talk,
}

impl Channel {
    fn parse(name: Option<&str>) -> Result<Self, AppError> {
        match name {
            None | Some("chat") => Ok(Self::Chat),
            Some("pen") => Ok(Self::Pen),
            Some("talk") => Ok(Self::Talk),
            Some(other) => Err(AppError::Io(format!("unknown agent channel: {other}"))),
        }
    }

    /// The sessions map key: a window's label, plus the channel's suffix.
    fn key(self, label: &str) -> String {
        match self {
            Self::Chat => label.to_owned(),
            Self::Pen => format!("{label}#pen"),
            Self::Talk => format!("{label}#talk"),
        }
    }
}

/// The agent CLI a request runs on (`agent.provider`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub(crate) fn parse(name: Option<&str>) -> Result<Self, AppError> {
        match name {
            None | Some("claude") => Ok(Self::Claude),
            Some("codex") => Ok(Self::Codex),
            Some(other) => Err(AppError::Io(format!("unknown agent provider: {other}"))),
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
        }
    }

    fn not_installed(self) -> &'static str {
        match self {
            Self::Claude => {
                "Claude Code isn't installed. Install it from claude.com/code, then try again."
            }
            Self::Codex => {
                "Codex isn't installed. Install it with `npm install -g @openai/codex`, then try again."
            }
        }
    }

    /// The binary's file names: Windows has the native `.exe` and npm's `.cmd`.
    fn binaries(self) -> &'static [&'static str] {
        match (self, cfg!(windows)) {
            (Self::Claude, false) => &["claude"],
            (Self::Claude, true) => &["claude.exe", "claude.cmd"],
            (Self::Codex, false) => &["codex"],
            (Self::Codex, true) => &["codex.exe", "codex.cmd"],
        }
    }
}

/// Each window's agent processes, by `Channel::key`.
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

/// The login shell's PATH. An app launched from Finder inherits launchd's
/// minimal PATH, not the terminal's, so it is probed once from `$SHELL -ilc`
/// and cached for the process lifetime. The binary itself is looked up on each
/// call (a few `stat`s), so one installed after launch is found by Check again.
fn login_path() -> Option<&'static OsString> {
    static PATH: OnceLock<Option<OsString>> = OnceLock::new();
    PATH.get_or_init(probe_login_path).as_ref()
}

/// A command for `provider`'s CLI with the login shell's PATH, or the error to
/// show when it isn't installed. The chat, the pen and sign-in all start here.
pub(crate) fn cli_command(provider: Provider) -> Result<Command, AppError> {
    let path = login_path();
    // Windows sets USERPROFILE, not HOME.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let binary = resolve_binary(
        provider,
        path.map(OsString::as_os_str),
        home.as_deref(),
        |p| p.is_file(),
    )
    .ok_or_else(|| AppError::User(provider.not_installed().to_owned()))?;
    let mut command = Command::new(binary);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    // A GUI app's console child opens a console window of its own on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command)
}

/// Windows has no `$SHELL` to ask, and an app's own PATH is whatever its
/// launcher had: an installer or a browser started before Claude Code was
/// installed hands down a PATH without it. The registry holds the PATH a new
/// sign-in would get, so it comes first, then the app's own, then the places
/// npm and WinGet put `claude` when their folder isn't on PATH yet.
#[cfg(windows)]
fn probe_login_path() -> Option<OsString> {
    const MACHINE: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
    let mut dirs: Vec<PathBuf> = Vec::new();
    for value in [
        registry_path(
            windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
            "Environment",
        ),
        registry_path(
            windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE,
            MACHINE,
        ),
        std::env::var_os("PATH"),
    ]
    .into_iter()
    .flatten()
    {
        dirs.extend(std::env::split_paths(&value));
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join(r"Microsoft\WinGet\Links"));
    }
    std::env::join_paths(dirs).ok()
}

/// A key's `Path` value, with `%VARIABLES%` expanded (RegGetValueW expands a
/// REG_EXPAND_SZ asked for as REG_SZ).
#[cfg(windows)]
fn registry_path(root: windows_sys::Win32::System::Registry::HKEY, key: &str) -> Option<OsString> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};

    let wide = |s: &str| -> Vec<u16> { std::ffi::OsStr::new(s).encode_wide().chain([0]).collect() };
    let (key, value) = (wide(key), wide("Path"));
    let mut bytes = 0u32;
    // SAFETY: both names are NUL-terminated UTF-16, and a null buffer asks
    // only for the size.
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if status != ERROR_SUCCESS || bytes == 0 {
        return None;
    }
    let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
    // SAFETY: `buffer` holds `bytes` bytes, as the first call asked for.
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(OsString::from_wide(&buffer[..len]))
}

#[cfg(not(windows))]
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

#[cfg(not(windows))]
fn parse_path_probe(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(PATH_MARKER))
        .map(str::to_owned)
        .filter(|path| !path.is_empty())
}

/// First binary found on the login PATH, then the known install locations:
/// Claude Code's installer (`~/.local/bin`, `~/.claude/local`), Homebrew, and
/// npm's prefix when it isn't on PATH yet.
fn resolve_binary(
    provider: Provider,
    login_path: Option<&std::ffi::OsStr>,
    home: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let names = provider.binaries();
    let mut candidates: Vec<PathBuf> = login_path
        .map(|path| {
            std::env::split_paths(path)
                .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
                .collect()
        })
        .unwrap_or_default();
    if let Some(home) = home {
        for name in names {
            candidates.push(home.join(".local/bin").join(name));
            match provider {
                Provider::Claude => candidates.push(home.join(".claude/local").join(name)),
                Provider::Codex => candidates.push(home.join(".npm-global/bin").join(name)),
            }
        }
    }
    if !cfg!(windows) {
        for name in names {
            candidates.push(Path::new("/opt/homebrew/bin").join(name));
            candidates.push(Path::new("/usr/local/bin").join(name));
        }
    }
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
            // The pen and the talk get everything they may use in the request itself.
            Channel::Pen | Channel::Talk => "",
        }
        .to_owned(),
        // Execution mode: reads and edits run without prompts; nothing is planned first.
        "--permission-mode".to_owned(),
        "acceptEdits".to_owned(),
        "--append-system-prompt".to_owned(),
        instructions.to_owned(),
    ];
    if channel != Channel::Chat {
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

/// JSON-RPC ids of the requests a Codex process sends on its own: the thread
/// (started or resumed), and a fresh thread when resuming failed. Turns count
/// up from `FIRST_TURN_ID`.
const CODEX_THREAD_ID: u64 = 1;
const CODEX_FRESH_THREAD_ID: u64 = 2;
const CODEX_FIRST_TURN_ID: u64 = 10;

/// The thread's settings, the same for `thread/start` and `thread/resume`.
/// The chat may edit the workspace and nothing else (Codex reads with shell
/// commands, so it needs the sandbox, not a tool list); nothing ever asks for
/// approval, a command outside the sandbox just fails. The pen and the talk
/// replace Codex's coding-agent prompt with their own instructions: they get
/// everything in the request, and the coding prompt costs ~40k tokens a turn.
fn codex_thread_params(key: &SpawnKey) -> serde_json::Value {
    let chat = key.channel == Channel::Chat;
    let mut params = serde_json::json!({
        "cwd": key.root,
        "approvalPolicy": "never",
        "sandbox": if chat { "workspace-write" } else { "read-only" },
    });
    params[if chat {
        "developerInstructions"
    } else {
        "baseInstructions"
    }] = key.instructions.clone().into();
    // An empty model is Codex's own default for the account.
    if !key.model.is_empty() {
        params["model"] = key.model.clone().into();
    }
    params
}

fn codex_thread_start(id: u64, key: &SpawnKey) -> String {
    let mut params = codex_thread_params(key);
    // The pen's and the talk's threads are never resumed: keep them off disk.
    params["ephemeral"] = (key.channel != Channel::Chat).into();
    serde_json::json!({ "id": id, "method": "thread/start", "params": params }).to_string()
}

/// What a new `codex app-server` is sent before any message: the handshake,
/// then the thread, resumed when the chat has one.
fn codex_startup_lines(session_id: Option<&str>, key: &SpawnKey) -> Vec<String> {
    let initialize = serde_json::json!({
        "id": 0,
        "method": "initialize",
        "params": {
            "clientInfo": { "name": "pensee", "title": "Pensée", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "experimentalApi": false, "requestAttestation": false },
        },
    });
    let thread = match session_id {
        Some(thread_id) => {
            let mut params = codex_thread_params(key);
            params["threadId"] = thread_id.into();
            serde_json::json!({ "id": CODEX_THREAD_ID, "method": "thread/resume", "params": params })
                .to_string()
        }
        None => codex_thread_start(CODEX_THREAD_ID, key),
    };
    vec![
        initialize.to_string(),
        serde_json::json!({ "method": "initialized" }).to_string(),
        thread,
    ]
}

/// One user turn as a Codex `turn/start` request.
fn codex_turn_line(id: u64, thread_id: &str, prompt: &str) -> String {
    serde_json::json!({
        "id": id,
        "method": "turn/start",
        "params": {
            "threadId": thread_id,
            "input": [{ "type": "text", "text": prompt, "text_elements": [] }],
        },
    })
    .to_string()
}

/// What a Codex response line means for the process's thread.
#[derive(Debug, PartialEq)]
enum CodexReply {
    /// `thread/start` or `thread/resume` answered with this thread.
    Thread(String),
    /// Resuming failed (the thread is gone): start a fresh one.
    ResumeFailed,
    Other,
}

fn codex_reply(line: &str) -> CodexReply {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return CodexReply::Other;
    };
    // Notifications and Codex's own requests carry a method; responses don't.
    if value.get("method").is_some() {
        return CodexReply::Other;
    }
    let id = value.get("id").and_then(serde_json::Value::as_u64);
    if id != Some(CODEX_THREAD_ID) && id != Some(CODEX_FRESH_THREAD_ID) {
        return CodexReply::Other;
    }
    if let Some(thread) = value.pointer("/result/thread/id").and_then(|v| v.as_str()) {
        return CodexReply::Thread(thread.to_owned());
    }
    if id == Some(CODEX_THREAD_ID) && value.get("error").is_some() {
        return CodexReply::ResumeFailed;
    }
    CodexReply::Other
}

/// What a running process was started with. A send or warm-up with a
/// different key replaces the process (resuming the conversation).
#[derive(Clone, PartialEq)]
struct SpawnKey {
    provider: Provider,
    root: PathBuf,
    model: String,
    instructions: String,
    channel: Channel,
}

/// A window's agent process. Idle between messages; `current` is the request
/// whose reply is streaming, and every stdout line is tagged with it.
struct Session {
    key: SpawnKey,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    current: Mutex<Option<String>>,
    codex: Mutex<CodexThread>,
}

/// Codex only: a turn needs the thread's id, which arrives after startup. A
/// message sent before that waits here and goes out when the thread answers.
/// Lock order: `codex`, then `stdin`.
#[derive(Default)]
struct CodexThread {
    id: Option<String>,
    waiting: Vec<String>,
    next_request: u64,
}

impl Session {
    fn write_line(&self, line: &str) -> std::io::Result<()> {
        let mut stdin = self.stdin.lock();
        writeln!(stdin, "{line}").and_then(|()| stdin.flush())
    }

    /// Send one message: a stream-json line to Claude, a turn to Codex (or
    /// queued until its thread is ready).
    fn send(&self, prompt: &str) -> std::io::Result<()> {
        match self.key.provider {
            Provider::Claude => self.write_line(&message_line(prompt)),
            Provider::Codex => {
                let mut codex = self.codex.lock();
                match codex.id.clone() {
                    Some(thread_id) => {
                        let id = codex.next_turn();
                        self.write_line(&codex_turn_line(id, &thread_id, prompt))
                    }
                    None => {
                        codex.waiting.push(prompt.to_owned());
                        Ok(())
                    }
                }
            }
        }
    }

    /// A Codex stdout line: keep the thread's id and send what waited for it.
    /// Returns whether the line goes on to the window: a failed resume is
    /// handled here (a fresh thread), so it never ends the request.
    fn on_codex_line(&self, line: &str) -> std::io::Result<bool> {
        match codex_reply(line) {
            CodexReply::Thread(thread_id) => {
                let mut codex = self.codex.lock();
                for prompt in std::mem::take(&mut codex.waiting) {
                    let id = codex.next_turn();
                    self.write_line(&codex_turn_line(id, &thread_id, &prompt))?;
                }
                codex.id = Some(thread_id);
                Ok(true)
            }
            CodexReply::ResumeFailed => {
                self.write_line(&codex_thread_start(CODEX_FRESH_THREAD_ID, &self.key))?;
                Ok(false)
            }
            CodexReply::Other => Ok(true),
        }
    }
}

impl CodexThread {
    fn next_turn(&mut self) -> u64 {
        self.next_request = self.next_request.max(CODEX_FIRST_TURN_ID) + 1;
        self.next_request
    }
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

    let mut command = cli_command(key.provider)?;
    match key.provider {
        Provider::Claude => command.args(build_args(
            session_id,
            &key.instructions,
            &key.model,
            key.channel,
        )),
        Provider::Codex => command.arg("app-server"),
    };
    command
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
    let startup = match key.provider {
        Provider::Claude => Vec::new(),
        Provider::Codex => codex_startup_lines(session_id, &key),
    };
    let session = Arc::new(Session {
        key,
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        current: Mutex::new(None),
        codex: Mutex::new(CodexThread::default()),
    });
    for line in &startup {
        if let Err(error) = session.write_line(line) {
            let _ = session.child.lock().kill();
            return Err(AppError::Io(format!(
                "Codex stopped while starting: {error}"
            )));
        }
    }
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
    provider: Provider,
    model: String,
    instructions: String,
    channel: Channel,
) -> Result<SpawnKey, AppError> {
    let state = app.state::<AppState>().get_or_create(label);
    let (root, _) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    Ok(SpawnKey {
        provider,
        root,
        model,
        instructions,
        channel,
    })
}

/// Start this window's agent ahead of the first question (panel opened, a
/// book opened, model changed), so the question doesn't wait for startup.
#[tauri::command]
// Each argument is a field of the frontend's invoke payload.
#[allow(clippy::too_many_arguments)]
pub async fn agent_warm(
    session_id: Option<String>,
    instructions: String,
    model: String,
    provider: Option<String>,
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let channel = Channel::parse(channel.as_deref())?;
    let provider = Provider::parse(provider.as_deref())?;
    let key = spawn_key(&app, &label, provider, model, instructions, channel)?;
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
    provider: Option<String>,
    channel: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let channel = Channel::parse(channel.as_deref())?;
    let provider = Provider::parse(provider.as_deref())?;
    let key = spawn_key(&app, &label, provider, model, instructions, channel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let session = ensure_session(&app, &label, key, session_id.as_deref())?;
        *session.current.lock() = Some(request_id);
        session.send(&prompt).map_err(|error| {
            let _ = session.child.lock().kill();
            AppError::Io(format!(
                "{} stopped before the message reached it: {error}",
                provider.name()
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
                if session.key.provider == Provider::Codex {
                    match session.on_codex_line(&line) {
                        Ok(true) => {}
                        Ok(false) => continue,
                        // Its stdin is gone, so the process is going too: its
                        // exit reports the request.
                        Err(error) => eprintln!("[agent] Couldn't write to Codex: {error}"),
                    }
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
    for channel in [Channel::Chat, Channel::Pen, Channel::Talk] {
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

    fn codex_key(channel: Channel, model: &str) -> SpawnKey {
        SpawnKey {
            provider: Provider::Codex,
            root: PathBuf::from("/notes"),
            model: model.to_owned(),
            instructions: "ctx".to_owned(),
            channel,
        }
    }

    #[test]
    fn codex_chat_starts_a_saved_thread_that_may_edit() {
        let lines = codex_startup_lines(None, &codex_key(Channel::Chat, "gpt-6-luna"));
        let methods: Vec<serde_json::Value> = lines
            .iter()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap()["method"].clone())
            .collect();
        assert_eq!(methods, ["initialize", "initialized", "thread/start"]);
        let thread: serde_json::Value = serde_json::from_str(&lines[2]).unwrap();
        let params = &thread["params"];
        assert_eq!(params["cwd"], "/notes");
        assert_eq!(params["sandbox"], "workspace-write");
        assert_eq!(params["approvalPolicy"], "never");
        assert_eq!(params["developerInstructions"], "ctx");
        assert!(params.get("baseInstructions").is_none());
        assert_eq!(params["model"], "gpt-6-luna");
        assert_eq!(params["ephemeral"], false);
    }

    #[test]
    fn codex_pen_is_read_only_off_disk_and_on_its_own_prompt() {
        let lines = codex_startup_lines(None, &codex_key(Channel::Pen, ""));
        let params =
            serde_json::from_str::<serde_json::Value>(&lines[2]).unwrap()["params"].clone();
        assert_eq!(params["sandbox"], "read-only");
        assert_eq!(params["baseInstructions"], "ctx");
        assert_eq!(params["ephemeral"], true);
        // No model: Codex's default for the account.
        assert!(params.get("model").is_none());
    }

    #[test]
    fn codex_chat_resumes_its_thread() {
        let lines = codex_startup_lines(Some("t1"), &codex_key(Channel::Chat, ""));
        let thread: serde_json::Value = serde_json::from_str(&lines[2]).unwrap();
        assert_eq!(thread["method"], "thread/resume");
        assert_eq!(thread["params"]["threadId"], "t1");
    }

    #[test]
    fn codex_replies_name_the_thread() {
        assert_eq!(
            codex_reply(r#"{"id":1,"result":{"thread":{"id":"t1"},"model":"m"}}"#),
            CodexReply::Thread("t1".to_owned())
        );
        assert_eq!(
            codex_reply(r#"{"id":2,"result":{"thread":{"id":"t2"}}}"#),
            CodexReply::Thread("t2".to_owned())
        );
        assert_eq!(
            codex_reply(r#"{"id":1,"error":{"code":-32600,"message":"no rollout"}}"#),
            CodexReply::ResumeFailed
        );
        assert_eq!(
            codex_reply(r#"{"method":"thread/started","params":{"thread":{"id":"t1"}}}"#),
            CodexReply::Other
        );
        assert_eq!(codex_reply(r#"{"id":11,"result":{}}"#), CodexReply::Other);
    }

    #[test]
    fn codex_turn_is_one_line() {
        let line = codex_turn_line(11, "t1", "two\nlines");
        assert!(!line.contains('\n'));
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["method"], "turn/start");
        assert_eq!(value["params"]["threadId"], "t1");
        assert_eq!(value["params"]["input"][0]["text"], "two\nlines");
    }

    #[test]
    fn providers_parse() {
        assert_eq!(Provider::parse(None).unwrap(), Provider::Claude);
        assert_eq!(Provider::parse(Some("codex")).unwrap(), Provider::Codex);
        assert!(Provider::parse(Some("gemini")).is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn codex_binary_found_in_npm_and_homebrew() {
        let home = Path::new("/home/me");
        let found = resolve_binary(Provider::Codex, None, Some(home), |p| {
            p == Path::new("/home/me/.npm-global/bin/codex")
        });
        assert_eq!(found, Some(PathBuf::from("/home/me/.npm-global/bin/codex")));
        let found = resolve_binary(Provider::Codex, None, Some(home), |p| {
            p == Path::new("/opt/homebrew/bin/codex")
        });
        assert_eq!(found, Some(PathBuf::from("/opt/homebrew/bin/codex")));
    }

    #[cfg(not(windows))]
    #[test]
    fn path_probe_ignores_rc_noise() {
        let out = format!("welcome!\n\n{PATH_MARKER}/a/bin:/b/bin\n");
        assert_eq!(parse_path_probe(&out).as_deref(), Some("/a/bin:/b/bin"));
        assert_eq!(parse_path_probe("no marker"), None);
        assert_eq!(parse_path_probe(&format!("{PATH_MARKER}\n")), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn binary_prefers_login_path_then_fallbacks() {
        let path = OsString::from("/x/bin:/y/bin");
        let home = Path::new("/home/me");
        let found = resolve_binary(Provider::Claude, Some(&path), Some(home), |p| {
            p == Path::new("/y/bin/claude") || p == Path::new("/home/me/.local/bin/claude")
        });
        assert_eq!(found, Some(PathBuf::from("/y/bin/claude")));

        let found = resolve_binary(Provider::Claude, None, Some(home), |p| {
            p == Path::new("/home/me/.local/bin/claude") || p == Path::new("/usr/local/bin/claude")
        });
        assert_eq!(found, Some(PathBuf::from("/home/me/.local/bin/claude")));

        assert_eq!(
            resolve_binary(Provider::Claude, None, None, |_| false),
            None
        );
    }

    #[cfg(windows)]
    #[test]
    fn binary_finds_windows_installs() {
        let path = OsString::from(r"C:\x\bin;C:\npm");
        let home = Path::new(r"C:\Users\me");
        let found = resolve_binary(Provider::Claude, Some(&path), Some(home), |p| {
            p == Path::new(r"C:\npm\claude.cmd")
        });
        assert_eq!(found, Some(PathBuf::from(r"C:\npm\claude.cmd")));

        let found = resolve_binary(Provider::Claude, None, Some(home), |p| {
            p == Path::new(r"C:\Users\me\.local\bin\claude.exe")
        });
        assert_eq!(
            found,
            Some(PathBuf::from(r"C:\Users\me\.local\bin\claude.exe"))
        );
    }
}
