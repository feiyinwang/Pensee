//! Signing Claude Code in and out from Pensée (SPECs/claude-sign-in-spec.md).
//! `claude auth login` opens the browser itself and waits for the writer to
//! approve; the result is checked with `claude auth status`, never assumed
//! from the exit code.

use super::agent::{claude_command, end_all_sessions};
use crate::error::AppError;
use parking_lot::Mutex;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// `auth --help` and `auth status` answer at once; a stuck one is killed.
const QUICK_TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(150);
const TOO_OLD: &str = "This version of Claude Code can't sign in from Pensée. Run `claude update` in Terminal, then try again.";
const NOT_FINISHED: &str = "Signing in didn't finish. Try again.";
const STILL_SIGNED_IN: &str =
    "Claude Code is still signed in. Run `claude auth logout` in Terminal to sign out.";

/// The sign-in running now, if any. One at a time, app-wide: Claude Code has
/// one sign-in per Mac.
#[derive(Default)]
pub struct ClaudeSignInState {
    current: Mutex<Option<Arc<SignIn>>>,
}

struct SignIn {
    /// The window that asked; it hears the URL, and closing it cancels.
    label: String,
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    cancelled: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInUrl {
    url: String,
}

/// Run a short `claude` command to the end, or kill it at the deadline.
fn quick_output(mut command: Command) -> Result<String, AppError> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stdout) = stdout.as_mut() {
            let _ = stdout.read_to_string(&mut text);
        }
        text
    });
    let deadline = Instant::now() + QUICK_TIMEOUT;
    while child.try_wait()?.is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(POLL);
    }
    let _ = child.wait();
    Ok(reader.join().unwrap_or_default())
}

/// Versions without `claude auth` print the main help for `auth --help`
/// (and would take `auth status` as a prompt to send), so ask the help first.
fn supports_auth(help: &str) -> bool {
    help.contains("Manage authentication")
}

/// `claude auth status` prints JSON with `loggedIn`.
fn parse_status(stdout: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    value.get("loggedIn")?.as_bool()
}

fn signed_in() -> Result<bool, AppError> {
    let mut help = claude_command()?;
    help.args(["auth", "--help"]);
    if !supports_auth(&quick_output(help)?) {
        return Err(AppError::User(TOO_OLD.to_owned()));
    }
    let mut status = claude_command()?;
    status.args(["auth", "status"]);
    parse_status(&quick_output(status)?).ok_or_else(|| AppError::User(TOO_OLD.to_owned()))
}

/// The sign-in page Claude Code prints for when the browser didn't open.
fn sign_in_url(line: &str) -> Option<&str> {
    line.split_whitespace()
        .find(|word| word.starts_with("https://"))
}

/// Whether Claude Code is signed in now.
#[tauri::command]
pub async fn claude_auth_status() -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(signed_in)
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

/// Sign Claude Code in: resolves once the writer approved in the browser (or
/// was already signed in), and ends every window's running Claude so the next
/// request uses the new sign-in. The sign-in page's address is sent to the
/// calling window as `claude-sign-in:url`.
#[tauri::command]
pub async fn claude_sign_in(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || sign_in(&app, &label))
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

fn sign_in(app: &tauri::AppHandle, label: &str) -> Result<(), AppError> {
    if signed_in()? {
        end_all_sessions(app);
        return Ok(());
    }

    let mut command = claude_command()?;
    let mut child = command
        .args(["auth", "login", "--claudeai"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session = Arc::new(SignIn {
        label: label.to_owned(),
        stdin: Mutex::new(child.stdin.take()),
        child: Mutex::new(child),
        cancelled: AtomicBool::new(false),
    });
    let state = app.state::<ClaudeSignInState>();
    if let Some(previous) = state.current.lock().replace(session.clone()) {
        previous.cancelled.store(true, Ordering::SeqCst);
        let _ = previous.child.lock().kill();
    }

    let last_line = Arc::new(Mutex::new(String::new()));
    let readers: Vec<_> = [
        stdout.map(|s| Box::new(s) as Box<dyn Read + Send>),
        stderr.map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|stream| {
        let app = app.clone();
        let label = label.to_owned();
        let last_line = last_line.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if let Some(url) = sign_in_url(&line) {
                    let url = url.to_owned();
                    let _ = app.emit_to(label.as_str(), "claude-sign-in:url", SignInUrl { url });
                } else if !line.trim().is_empty() {
                    *last_line.lock() = line.trim().to_owned();
                }
            }
        })
    })
    .collect();

    // Polled, not `wait()`ed, so a cancel can take the lock to kill it.
    loop {
        if session.child.lock().try_wait()?.is_some() {
            break;
        }
        std::thread::sleep(POLL);
    }
    for reader in readers {
        let _ = reader.join();
    }
    {
        let mut current = state.current.lock();
        if current.as_ref().is_some_and(|c| Arc::ptr_eq(c, &session)) {
            *current = None;
        }
    }
    if session.cancelled.load(Ordering::SeqCst) {
        return Err(AppError::User("Signing in was cancelled.".to_owned()));
    }
    if signed_in()? {
        end_all_sessions(app);
        return Ok(());
    }
    let reason = last_line.lock().clone();
    Err(AppError::User(if reason.is_empty() {
        NOT_FINISHED.to_owned()
    } else {
        format!("{NOT_FINISHED} Claude Code said: {reason}")
    }))
}

/// Sign Claude Code out (Settings → Agent → Claude), then end every window's
/// running Claude: a running one keeps the sign-in it started with.
#[tauri::command]
pub async fn claude_sign_out(app: tauri::AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || sign_out(&app))
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

fn sign_out(app: &tauri::AppHandle) -> Result<(), AppError> {
    // Checks `auth` exists first, so an old CLI never gets `auth logout` as a prompt.
    if !signed_in()? {
        return Ok(());
    }
    let mut logout = claude_command()?;
    logout.args(["auth", "logout"]);
    quick_output(logout)?;
    // A sign-in from the shell (an API key in the environment) outlives logout.
    if signed_in()? {
        return Err(AppError::User(STILL_SIGNED_IN.to_owned()));
    }
    end_all_sessions(app);
    Ok(())
}

/// The code the browser shows when it can't hand the sign-in back by itself.
#[tauri::command]
pub fn claude_sign_in_code(code: String, app: tauri::AppHandle) -> Result<(), AppError> {
    let session = app.state::<ClaudeSignInState>().current.lock().clone();
    let session = session.ok_or_else(|| AppError::User(NOT_FINISHED.to_owned()))?;
    let mut stdin = session.stdin.lock();
    let stdin = stdin
        .as_mut()
        .ok_or_else(|| AppError::User(NOT_FINISHED.to_owned()))?;
    writeln!(stdin, "{}", code.trim())
        .and_then(|()| stdin.flush())
        .map_err(|_| AppError::User(NOT_FINISHED.to_owned()))
}

/// Stop the sign-in running now; `claude_sign_in` then fails as cancelled.
#[tauri::command]
pub fn claude_sign_in_cancel(app: tauri::AppHandle) {
    cancel(&app, None);
}

/// The window that started the sign-in closed: nobody is left to finish it.
pub fn close_window_sign_in(app: &tauri::AppHandle, label: &str) {
    cancel(app, Some(label));
}

fn cancel(app: &tauri::AppHandle, label: Option<&str>) {
    let state = app.state::<ClaudeSignInState>();
    let session = {
        let mut current = state.current.lock();
        if label.is_some_and(|label| current.as_ref().is_some_and(|c| c.label != label)) {
            return;
        }
        current.take()
    };
    if let Some(session) = session {
        session.cancelled.store(true, Ordering::SeqCst);
        let _ = session.child.lock().kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_support_comes_from_the_help() {
        assert!(supports_auth(
            "Usage: claude auth [options] [command]\n\nManage authentication\n"
        ));
        assert!(!supports_auth(
            "Usage: claude [options] [command] [prompt]\n\nClaude Code - starts an interactive session"
        ));
    }

    #[test]
    fn status_reads_logged_in() {
        assert_eq!(
            parse_status("{\n  \"loggedIn\": false,\n  \"authMethod\": \"none\"\n}"),
            Some(false)
        );
        assert_eq!(parse_status("{\"loggedIn\": true}"), Some(true));
        assert_eq!(parse_status("Invalid API key · Please run /login"), None);
        assert_eq!(parse_status("{}"), None);
    }

    #[test]
    fn url_comes_from_the_fallback_line() {
        assert_eq!(
            sign_in_url("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true"),
            Some("https://claude.com/cai/oauth/authorize?code=true")
        );
        assert_eq!(sign_in_url("Opening browser to sign in…"), None);
    }
}
