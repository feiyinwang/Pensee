# Codex: Pensée on a ChatGPT plan

## Problem

Organize, the pen, talks and the Agent ran on Claude Code only, so a writer
without a Claude subscription had no AI at all. Most writers have either
Claude or ChatGPT, and ChatGPT's Free plan includes Codex (OpenAI's coding
CLI, signed in with a ChatGPT account). Researched 2026-10-27: Gemini CLI
stopped serving free personal accounts on 2026-06-18 and Qwen Code's free
tier ended on 2026-04-15, so Codex is the free option with official terms.

## Stories

- As a writer with ChatGPT and no Claude, I pick ChatGPT during onboarding
  and Organize, the pen, talks and the Agent work on my plan.
- As a writer with both, I pick which one in onboarding or Settings → Agent.
- As a writer with neither installed, onboarding tells me Pensée needs one
  of them and how to install each, and I can still skip.
- As a writer whose ChatGPT sign-in expired, a request tells me so and the
  sign-in popup signs me back in, as it does for Claude.

## Behaviour

- **Setting.** `agent.provider` (Settings → Agent → **AI**): **Claude Code**
  (default, so nothing changes for existing writers) or **Codex (ChatGPT)**.
  Everything that runs an agent reads it: the chat, the pen (Organize, ⌘.),
  talks.
- **Models.** `agent.model` is a tier, shown as **Fastest / Balanced /
  Smartest** in Settings. Each CLI maps it to its own model:

  | Tier     | Claude Code | Codex                 |
  | -------- | ----------- | --------------------- |
  | Fastest  | Haiku       | Luna (`gpt-6-luna`)   |
  | Balanced | Sonnet      | Sol (`gpt-6.1-sol`)   |
  | Smartest | Opus        | Astra (`gpt-6-astra`) |

  The chat's model chip and `/model` menu show the chosen CLI's names, and
  `/model` matches by them. Organize and talks still ask for Balanced at
  least. Claude's ids are aliases that follow new releases; Codex has none,
  so the Codex ids change in `lib/agent-models.ts` when OpenAI renames a
  family. A plan without a model (Free may lack Astra) fails the request
  with Codex's own message.

- **Switching CLI** keeps the chat on screen; the next message starts a new
  conversation on the new CLI (a Claude session can't continue in Codex).
- **Sign-in.** The same popup and Settings row as Claude
  (SPECs/claude-sign-in-spec.md), naming the plan: _ChatGPT is signed out_.
  Sign in runs `codex login` (it opens the browser and hands the sign-in
  back through its own local page, so the popup has no code field); status
  is `codex login status` ("Logged in using …" / "Not logged in", on
  stderr); Sign out runs `codex logout`.
- **Onboarding, screen 2** (SPECs/onboarding-spec.md): _Which AI should
  Pensée use?_ with _Pensée needs Claude or ChatGPT, on the plan you already
  have (ChatGPT Free works)._ Each CLI found on this Mac gets a button:
  **Use Claude** / **Use ChatGPT** (with the CLI's name on the right) when
  signed in, **Sign in to …** when not. Signed in first, then the one
  already chosen. **Use …** sets `agent.provider` and moves on. A CLI that
  isn't installed shows its install line (`npm install -g @openai/codex` for
  Codex) with **Check again**: open when none is installed, behind **Other
  options** otherwise. **Skip for now** always stays.

## Process

Codex runs as `codex app-server` (JSON-RPC over stdio, one JSON object per
line), one per window and channel, kept running like Claude Code's
stream-json process (SPECs/agent-chat-spec.md#process). Measured
(2026-10-27, Plus account): ready in 0.4 s, first streamed word 1.7–4 s
after a message, file edits work, turns continue in one process. `codex
exec --json` was rejected: one process per message and no streamed text.

- **Startup** writes `initialize`, `initialized`, then `thread/start` (or
  `thread/resume` with the chat's thread id). A message sent before the
  thread answers waits in the process and goes out as `turn/start` when it
  does. A failed resume (thread gone) starts a fresh thread, unseen.
- **Thread settings.** `approvalPolicy: never` everywhere: nothing ever
  waits on an approval prompt, a command outside the sandbox just fails.
  - Chat: `sandbox: workspace-write` (Codex reads and searches with shell
    commands, so it needs a sandbox, not a tool list: it may write inside
    the workspace and nowhere else, with no network), Pensée's instructions
    as `developerInstructions` on top of Codex's own, saved so it can
    resume.
  - Pen and talk: `sandbox: read-only`, `ephemeral`, and Pensée's
    instructions as `baseInstructions`, replacing Codex's coding-agent
    prompt (~40k tokens a turn) since everything they need is in the
    request.
  - An empty model means Codex's default for the account.
- **Events** go to the window as `agent:line` unparsed; `lib/agent-stream.ts`
  tells the two CLIs apart (Claude's lines have a `type`, Codex's don't):
  `item/agentMessage/delta` → text (a later message in the same turn is a
  new paragraph); `item/started` with a command → **Read Draft.md** /
  **Searched for "…"** / **Ran a command** from its parsed actions, a file
  change → **Edited Draft.md**; `turn/completed` → the result, its text the
  turn's last agent message; the response naming the thread → the session.
- **Signed out.** Codex retries a 401 five times (~17 s) before failing the
  turn; the first 401 `error` notification ends the request at once with
  _ChatGPT is signed out. Sign in, then try again._
- **Binary**: the login shell's PATH, then `~/.local/bin`,
  `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin` (`codex.exe`
  / `codex.cmd` on Windows). The binary is looked up on every start, so one
  installed after Pensée launched is found by **Check again**.
- **Stop** kills the process, as for Claude; the next message resumes the
  thread.

## Trade-offs

- `app-server` is marked experimental by OpenAI; its IDE extension runs on
  it. The protocol was checked against Codex 0.165.0
  (`codex app-server generate-ts`); a breaking change shows as a failed
  request, not a hang.
- The chat's turns carry Codex's coding prompt (~40k input tokens, mostly
  cached), which spends a Free plan's small allowance faster than Claude's
  lean chat does.
- Gemini CLI and the "Another CLI" command field are dropped from onboarding:
  Gemini no longer serves free accounts, and nothing ran on either.

## Code

- `src-tauri/src/commands/agent.rs` — `Provider`, `cli_command`, the Codex
  startup lines, thread and turn requests (`Session::send`,
  `Session::on_codex_line`).
- `src-tauri/src/commands/claude_auth.rs` — status, sign in, sign out for
  either CLI (`provider` argument).
- `src-tauri/src/commands/onboarding.rs` — `claude_installed(provider)`.
- `src/lib/agent-models.ts` — providers and per-CLI model tiers. Pure.
- `src/lib/agent-target.ts` — the chosen CLI and model, for every invoke.
- `src/lib/agent-stream.ts` — Codex events → chat events.
- `src/stores/claude-sign-in-store.ts` — per-CLI accounts and the popup's CLI.
- `src/components/onboarding/index.tsx` — screen 2.

## Tests

- Rust: Codex startup lines (chat vs pen settings, resume), thread replies,
  turn lines, provider parsing, binary locations, `codex login status`
  parsing, the sign-in URL skipping Codex's local callback.
- `agent-stream`: Codex session, deltas, tool labels, finished and failed
  turns, the early 401, failed requests.
- `agent-models`: per-CLI tiers and `/model` matching.
- `claude-sign-in-store`: per-CLI accounts, Codex sign-in.
- Journeys: docs/qa/user-journeys.md § Agent — AGT-CODEX.
