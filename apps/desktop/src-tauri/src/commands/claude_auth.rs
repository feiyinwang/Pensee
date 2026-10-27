//! Signing the agent CLI in and out from Pensée (SPECs/claude-sign-in-spec.md,
//! SPECs/codex-spec.md). `claude auth login` and `codex login` open the browser
//! themselves and wait for the writer to approve; the result is checked with
//! the CLI's status command, never assumed from the login's exit code.
//! Every command takes the `provider` (`claude` when absent).

use super::agent::{cli_command, end_all_sessions, Provider};
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

fn still_signed_in(provider: Provider) -> String {
    let logout = match provider {
        Provider::Claude => "claude auth logout",
        Provider::Codex => "codex logout",
    };
    format!(
        "{} is still signed in. Run `{logout}` in Terminal to sign out.",
        provider.name()
    )
}

/// The sign-in running now, if any. One at a time, app-wide: each CLI has one
/// sign-in per Mac, and one popup asks for it.
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

/// What a short command printed: Claude Code answers on stdout, Codex's
/// `login status` on stderr.
struct QuickOutput {
    stdout: String,
    stderr: String,
}

fn read_all(stream: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stream) = stream {
            let _ = stream.read_to_string(&mut text);
        }
        text
    })
}

/// Run a short CLI command to the end, or kill it at the deadline.
fn quick_output(mut command: Command) -> Result<QuickOutput, AppError> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = read_all(child.stdout.take());
    let stderr = read_all(child.stderr.take());
    let deadline = Instant::now() + QUICK_TIMEOUT;
    while child.try_wait()?.is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(POLL);
    }
    let _ = child.wait();
    Ok(QuickOutput {
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
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

/// `codex login status` prints "Logged in using ChatGPT" (or "using an API
/// key") or "Not logged in".
fn parse_codex_status(output: &str) -> Option<bool> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    if line.starts_with("Logged in") {
        Some(true)
    } else if line.starts_with("Not logged in") {
        Some(false)
    } else {
        None
    }
}

fn signed_in(provider: Provider) -> Result<bool, AppError> {
    if provider == Provider::Codex {
        let mut status = cli_command(provider)?;
        status.args(["login", "status"]);
        let output = quick_output(status)?;
        return parse_codex_status(&format!("{}\n{}", output.stderr, output.stdout)).ok_or_else(
            || {
                AppError::User(format!(
                    "Couldn't tell whether Codex is signed in: {}",
                    output.stderr.trim()
                ))
            },
        );
    }
    let mut help = cli_command(provider)?;
    help.args(["auth", "--help"]);
    if !supports_auth(&quick_output(help)?.stdout) {
        return Err(AppError::User(TOO_OLD.to_owned()));
    }
    let mut status = cli_command(provider)?;
    status.args(["auth", "status"]);
    parse_status(&quick_output(status)?.stdout).ok_or_else(|| AppError::User(TOO_OLD.to_owned()))
}

/// The sign-in page the CLI prints for when the browser didn't open (Codex
/// also prints its local `http://localhost` callback, which isn't it).
fn sign_in_url(line: &str) -> Option<&str> {
    line.split_whitespace()
        .find(|word| word.starts_with("https://"))
}

/// Whether the CLI is signed in now.
#[tauri::command]
pub async fn claude_auth_status(provider: Option<String>) -> Result<bool, AppError> {
    let provider = Provider::parse(provider.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || signed_in(provider))
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

/// Sign the CLI in: resolves once the writer approved in the browser (or was
/// already signed in), and ends every window's running agent so the next
/// request uses the new sign-in. The sign-in page's address is sent to the
/// calling window as `claude-sign-in:url`.
#[tauri::command]
pub async fn claude_sign_in(
    provider: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let label = webview.label().to_owned();
    let provider = Provider::parse(provider.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || sign_in(&app, &label, provider))
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

fn sign_in(app: &tauri::AppHandle, label: &str, provider: Provider) -> Result<(), AppError> {
    if signed_in(provider)? {
        end_all_sessions(app);
        return Ok(());
    }

    let mut command = cli_command(provider)?;
    match provider {
        Provider::Claude => command.args(["auth", "login", "--claudeai"]),
        Provider::Codex => command.arg("login"),
    };
    let mut child = command
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
    if signed_in(provider)? {
        end_all_sessions(app);
        return Ok(());
    }
    let reason = last_line.lock().clone();
    Err(AppError::User(if reason.is_empty() {
        NOT_FINISHED.to_owned()
    } else {
        format!("{NOT_FINISHED} {} said: {reason}", provider.name())
    }))
}

/// Sign the CLI out (Settings → Agent), then end every window's running
/// agent: a running one keeps the sign-in it started with.
#[tauri::command]
pub async fn claude_sign_out(
    provider: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let provider = Provider::parse(provider.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || sign_out(&app, provider))
        .await
        .map_err(|error| AppError::Io(error.to_string()))?
}

fn sign_out(app: &tauri::AppHandle, provider: Provider) -> Result<(), AppError> {
    // Checks `auth` exists first, so an old CLI never gets `auth logout` as a prompt.
    if !signed_in(provider)? {
        return Ok(());
    }
    let mut logout = cli_command(provider)?;
    match provider {
        Provider::Claude => logout.args(["auth", "logout"]),
        Provider::Codex => logout.arg("logout"),
    };
    quick_output(logout)?;
    // A sign-in from the shell (an API key in the environment) outlives logout.
    if signed_in(provider)? {
        return Err(AppError::User(still_signed_in(provider)));
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
    fn codex_status_reads_its_line() {
        assert_eq!(parse_codex_status("Logged in using ChatGPT\n"), Some(true));
        assert_eq!(
            parse_codex_status("\nLogged in using an API key - sk-…\n"),
            Some(true)
        );
        assert_eq!(parse_codex_status("Not logged in\n"), Some(false));
        assert_eq!(parse_codex_status("error: unexpected argument"), None);
        assert_eq!(parse_codex_status(""), None);
    }

    #[test]
    fn url_skips_codex_local_callback() {
        assert_eq!(
            sign_in_url("Starting local login server on http://localhost:1455. If your browser did not open, navigate to this URL to authenticate: https://auth.openai.com/oauth/authorize?x=1"),
            Some("https://auth.openai.com/oauth/authorize?x=1")
        );
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
