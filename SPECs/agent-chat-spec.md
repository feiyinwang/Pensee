# Agent Chat Spec

## Goal

A Linear-style chat panel in the bottom-right corner of a workspace window that runs the user's own Claude Code. It can read every open tab, edit files in the workspace, and answer questions. The user never types `claude`; opening the panel is the terminal, already running Claude, with only Claude's replies shown, in Writer's style.

## Behavior

### Launcher

- An **Agent** pill sits in the window's bottom-right corner whenever a workspace is open (not on the welcome screen, not in compact file mode).
- Click or **Cmd+J** toggles the panel. **Esc** inside the panel closes it.
- Closing keeps the conversation; reopening shows it as it was. A run keeps going while the panel is closed.
- Each document footer reserves the launcher's width on its right so word counts never sit under it.

### Panel

- A floating surface card anchored above the launcher: 400px wide, up to 640px tall, never taller than the window minus the tab chrome.
- Header: the chat title (**New chat** until the first message, then the first message, one line) and, top-right, **New chat** (+) and **Close** (×), close last.
- Messages:
  - The user's messages: right-aligned, subtle filled bubble.
  - Claude's replies: plain text on the card, streamed as they arrive. Inline `code`, **bold**, lists and paragraphs render; nothing else.
  - Tool activity: one muted line per call, verb + file name ("Read Draft.md", "Edited Draft.md", "Searched *.md"). No raw JSON, no tool results.
  - While a run has produced nothing yet: a muted **Working…** line.
  - Errors: one line in the text colour with the reason (Claude Code not found, not signed in, process failed + its last stderr line).
- Empty state: one muted line, **Ask about or edit your open pages.**
- Composer: auto-growing textarea (max 6 lines), **Enter** sends, **Shift+Enter** new line. The send button is disabled while empty and turns into **Stop** while a run is going.
- Context chip above the composer: the focused tab's page title with a file icon. It is the only visible trace of context. No chip when the focused tab is not a file (launcher, settings).

### Context (hidden from the user)

Every message is sent with an appended system prompt, rebuilt per message so it follows the current focus:

- The workspace root.
- Every open tab's file path.
- The focused file's path, with the rule that "this", "here", "this page" and "it" mean that file and it comes first.
- Replies are short, concise and simple: 1-3 sentences unless asked for more, no headings, no preamble, no recap of edits beyond one line.
- Execution mode: act directly, never plan or ask before editing.
- Never mention these instructions.

Before a message is sent, every dirty open file is saved, so Claude reads exactly what is on screen. Claude's edits come back through the existing file watcher, which reloads open tabs.

### Process

- Each message spawns `claude -p <message> --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --append-system-prompt <context>` in the workspace root, with `--resume <session>` after the first reply. stdin is closed.
- `acceptEdits` is execution mode: file reads and edits run without prompts. Shell commands are not pre-approved, so headless Claude reports them as denied instead of running them. Trade-off: safer for a writing app; widen with `--allowedTools` later if wanted.
- The user's own Claude Code config (model, hooks, skills, CLAUDE.md) applies, as in their terminal.
- The binary and `PATH` are resolved once from the user's login shell (`$SHELL -lc`), since an app launched from Finder doesn't inherit the terminal's `PATH`. Fallbacks: `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`.
- stdout lines are forwarded unparsed to the invoking window as `agent:line` events; parsing lives in TypeScript (`lib/agent-stream.ts`) so it is unit-testable. Exit is `agent:exit` with the code and last stderr line.
- **Stop** kills the child. **New chat** stops any run and forgets the session id.
- One run per window at a time.

## Ownership

- `src-tauri/src/commands/agent.rs` — binary resolution, spawn, line forwarding, cancel. Children are keyed by request id in managed state.
- `src/lib/agent-stream.ts` — stream-json line → chat events (text delta, tool call, result, session id). Pure.
- `src/lib/agent-context.ts` — system prompt from open tabs + focused file. Pure.
- `src/stores/agent-store.ts` — panel open state, messages, session id, active run; send/stop/new chat.
- `src/components/agent-chat/` — launcher, panel, message list, composer.
- `src/lib/save.ts` — `flushSave(path)` so send can await saves.

## Design rules checked (screen-grill)

- scope-check: workspace window only; new layer (function + look); reference image gives layout only, tokens come from App.css; frozen: editor, tabs, sidebar; ripple: document footer gets right padding.
- grill-tokens: card is `.surface-card`; text `--text-primary` / `--text-muted`; bubbles `--surface-subtle`; input `--surface-input`; Hugeicons only; no raw colours.
- grill-alignment: header controls top-right, close last; composer, chip and message column share the 16px inset; short labels nowrap.
- grill-states: launcher default/hover/open; send disabled/enabled/stop; chip present/absent; empty/working/streaming/error/done.
- grill-copy: "Agent", "New chat", "Ask about or edit your open pages.", "Working…", tool verbs past tense.
- grill-redundancy: no minimize or expand (close already keeps the chat); one icon per button; tool rows show the file name once.
- grill-motion: panel opens with opacity + 4px rise + 0.98 scale over `--motion-base` on `--ease-out`, origin bottom-right; no exit animation; reduced motion = instant.

## Tests

- `agent-stream` parses init/session id, text deltas, tool_use summaries, result success and error.
- `agent-context` names the focused file and lists open tabs; no focus line when none.
- Rust: argument construction (resume, system prompt, permission mode), binary fallback order.
