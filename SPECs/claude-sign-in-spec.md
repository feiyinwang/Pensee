# Claude sign-in popup

## Problem

The pen (Organize, ⌘.) and the Agent run on Claude Code, the `claude` command on
the writer's Mac. When its sign-in expires or is revoked, every request fails
with a 401, and until now the only way back was to open Terminal, run `claude`
and type `/login`. Writers who never use a terminal are stuck.

## Stories

- As a writer, after Organize (or any pen request) fails because Claude is
  signed out, I sign back in without leaving Pensée, so I can run it again.
- As a writer chatting with the Agent, after my message fails the same way, I
  sign back in from there.
- As a writer whose browser didn't open, or who was shown a code instead of
  being sent back, I can still finish signing in.
- As a writer who opened the popup by accident, or doesn't want to sign in now,
  I close it and nothing else changes.
- As a writer with an old Claude Code that can't sign in from outside a
  terminal, I'm told exactly what to run.

Only a request the writer made opens the popup. A warm-up that fails in the
background stays silent.

## Behaviour

When a pen or Agent request ends with a signed-out error (401, "OAuth",
"authenticat…", "Not logged in", "/login"), the pen or chat says
_Claude is signed out. Sign in, then try again._ and the sign-in popup opens
over the window, unless it is already open.

The popup is an opaque card floating over the window, centred near the top,
with no backdrop: the app behind it stays visible and usable. Its title names the
situation, not the button ("Claude is signed out"; "Signed in" when done).

| State   | Text                                                                                     | Actions                                    |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| Idle    | Organize, the pen and the Agent use Claude Code on this Mac. Sign in to use them again. | Not now `Esc` · Sign in `↵`                |
| Waiting | Finish signing in in your browser, then come back here.                                  | Code field + Continue; Open the sign-in page again · Cancel `Esc` |
| Failed  | The idle text, then the reason in plain words                                            | Not now `Esc` · Try again `↵`              |
| Done    | Run it again.                                                                            | Done `↵`; closes by itself after 1.5s      |

A click outside the card goes to the app and leaves the card open: coming back
from the browser, the first click on the window must not cancel the sign-in it
is waiting for.

- **Sign in** runs `claude auth login --claudeai` from the app. Claude Code opens
  the browser itself; when the writer approves, it exits and the popup moves to
  Done.
- The sign-in page link Claude Code prints is kept, so **Open the sign-in page
  again** works when the browser didn't open.
- A pasted code is written to Claude Code's prompt and the login continues.
- **Cancel**, Esc or closing the window ends the login process.
- Success is checked with `claude auth status`, never assumed from the exit
  code.
- After signing in, every window's running Claude processes (pen and chat) are
  ended so the next request starts with the new sign-in, and each window starts
  again the ones it had (`agent:ended`), so that request doesn't wait for Claude
  to start.
- Claude Code without `auth login` (older than 2.1.x): the popup fails with
  "This version of Claude Code can't sign in from Pensée. Run `claude update` in
  Terminal, then try again."
- Claude Code not installed: the existing "Claude Code isn't installed…" error.
- If Claude Code reports it is already signed in, the popup goes straight to Done.

Keys: ↵ runs the primary action, Esc closes (or cancels while waiting). Each
key shows next to its button, as every control with a shortcut does.

## Not in scope

- A Claude account row in Settings (sign in / sign out at any time).
- Retrying the failed request automatically.

## Code

- `src-tauri/src/commands/claude_auth.rs` — `claude_auth_status`,
  `claude_sign_in`, `claude_sign_in_code`, `claude_sign_in_cancel`.
- `src/lib/agent-stream.ts` — `isSignedOut`, the one signed-out check.
- `src/stores/claude-sign-in-store.ts` — popup state, owns the IPC calls.
- `src/components/claude-sign-in/` — the popup.
