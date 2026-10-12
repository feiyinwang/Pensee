//! Agent chat: runs the user's own Claude Code headless in the workspace and
//! forwards its stream-json stdout to the invoking window, one line per event.
//! Parsing lives in the frontend (`lib/agent-stream.ts`) so it stays testable
//! without a process. See SPECs/agent-chat-spec.md.

use crate::error::AppError;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const PATH_MARKER: &str = "__WRITER_AGENT_PATH__=";
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const STDERR_TAIL_LINES: usize = 8;

/// Running agent processes, keyed by the frontend's request id so Stop can
/// find the child after its stdout has been handed to the reader thread.
#[derive(Default)]
pub struct AgentState {
    children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
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
    prompt: &str,
    session_id: Option<&str>,
    system_prompt: &str,
    model: &str,
) -> Vec<String> {
    let mut args = vec![
        "-p".to_owned(),
        prompt.to_owned(),
        "--output-format".to_owned(),
        "stream-json".to_owned(),
        "--verbose".to_owned(),
        "--include-partial-messages".to_owned(),
        "--model".to_owned(),
        model.to_owned(),
        // Execution mode: reads and edits run without prompts; nothing is planned first.
        "--permission-mode".to_owned(),
        "acceptEdits".to_owned(),
        "--append-system-prompt".to_owned(),
        system_prompt.to_owned(),
    ];
    if let Some(session_id) = session_id {
        args.push("--resume".to_owned());
        args.push(session_id.to_owned());
    }
    args
}

#[tauri::command]
pub async fn agent_send(
    request_id: String,
    prompt: String,
    session_id: Option<String>,
    system_prompt: String,
    model: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let state = app.state::<AppState>().get_or_create(&label);
    let (root, _) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;

    let child = tauri::async_runtime::spawn_blocking(move || {
        let env = claude_env();
        let binary = env.binary.as_ref().ok_or_else(|| {
            AppError::User(
                "Claude Code isn't installed. Install it from claude.com/code, then try again."
                    .to_owned(),
            )
        })?;
        let mut command = Command::new(binary);
        command
            .args(build_args(
                &prompt,
                session_id.as_deref(),
                &system_prompt,
                &model,
            ))
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = &env.path {
            command.env("PATH", path);
        }
        command.spawn().map_err(AppError::from)
    })
    .await
    .map_err(|error| AppError::Io(error.to_string()))??;

    start_forwarding(app, label, request_id, child);
    Ok(())
}

fn start_forwarding(app: tauri::AppHandle, label: String, request_id: String, mut child: Child) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    app.state::<AgentState>()
        .children
        .lock()
        .insert(request_id.clone(), child.clone());

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
                let payload = AgentLine {
                    request_id: request_id.clone(),
                    line,
                };
                let _ = app.emit_to(label.as_str(), "agent:line", payload);
            }
        }
        if let Some(reader) = stderr_reader {
            let _ = reader.join();
        }
        let code = child.lock().wait().ok().and_then(|status| status.code());
        app.state::<AgentState>()
            .children
            .lock()
            .remove(&request_id);
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
    });
}

/// Kill a running agent. The reader thread sees EOF and emits `agent:exit`.
/// A request that already finished is a no-op.
#[tauri::command]
pub fn agent_cancel(request_id: String, app: tauri::AppHandle) {
    let child = app
        .state::<AgentState>()
        .children
        .lock()
        .get(&request_id)
        .cloned();
    if let Some(child) = child {
        let _ = child.lock().kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_message_has_no_resume() {
        let args = build_args("hi", None, "ctx", "haiku");
        assert_eq!(
            args,
            [
                "-p",
                "hi",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--model",
                "haiku",
                "--permission-mode",
                "acceptEdits",
                "--append-system-prompt",
                "ctx"
            ]
        );
    }

    #[test]
    fn follow_up_resumes_session() {
        let args = build_args("next", Some("abc"), "ctx", "opus");
        assert_eq!(&args[args.len() - 2..], ["--resume", "abc"]);
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
