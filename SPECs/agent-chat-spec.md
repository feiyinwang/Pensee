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
  - Tool activity: one muted line per call, verb + file name ("Read Draft.md", "Edited Draft.md", "Searched \*.md"). No raw JSON, no tool results.
  - While a run has produced nothing yet: **Thinking**, with Arc's `text-shimmer` light sweep.
  - Fenced code in a reply renders as Arc's `code-block` (language label, **Copy code**, collapses past 12 lines).
  - Errors: one line in the text colour with the reason (Claude Code not found, not signed in, process failed + its last stderr line).
- Empty state: one muted line, **Ask about or edit your open pages.**
- Composer: auto-growing textarea (max 6 lines), **Enter** sends, **Shift+Enter** new line. The send button is disabled while empty and turns into **Stop** while a run is going.
- Context chip above the composer: the focused tab's page title with a file icon. It is the only visible trace of context. No chip when the focused tab is not a file (launcher, settings).
- Model: the current model's name (**Haiku**, **Sonnet**, **Opus**) sits at the right end of the chip row. Clicking it, or typing `/model` in the composer (any prefix, from `/`), opens the model menu between that row and the input: one row per model with a short blurb (Fastest / Balanced / Smartest, slowest) and a tick on the current one. `/model o` narrows it to Opus; a name that matches nothing shows **No model by that name. Try Haiku, Sonnet or Opus.** ↑/↓ move, Enter or Tab picks, Esc clears the command (and doesn't close the panel), a click picks. Picking adds a muted **Model set to Opus** line to the chat and applies from the next message, in the same conversation. A `/model` draft is never sent to Claude.
- The model is the global setting `agent.model` (Settings → Agent → Agent Model), default **haiku** because a fast answer matters more than depth for most questions while reading.

### Context (hidden from the user)

The fixed instructions (workspace root, how to work, reply style) are the process's `--append-system-prompt`. What's on screen changes per message, so each message starts with a `<writer_context>` block rebuilt at send time, followed by what the user typed; the instructions say the latest block replaces earlier ones. The block holds:

- The workspace root.
- What the user is looking at, not whole files, since every token is read before the first word of a reply:
  - A page up to 6,000 characters goes in whole (what's in the editor for loaded tabs, the file on disk otherwise).
  - A longer page goes in only as the lines on screen in an editor showing it (`on_screen="lines 120-164 of 2000"`, in file lines, frontmatter included), marked so Claude reads the file for the rest. Editors register in `lib/editor-views.ts`; the visible lines are the editor clipped by its scroll container and the window.
  - A longer page not on screen (a background tab) is listed by path only.
  - A question can be about any open tab; Claude is told to work out which from the question and to read the files before saying something isn't there.
- Boards: a `.board.svg` open as a tab, or embedded in an open page as an image link, is sent as its scene (one JSON line per node, with its text). The SVG itself can carry inlined pictures, so it is never sent raw.
- Caps: 12,000 characters for one page's on-screen part, 40,000 in total, focused tab first; anything cut is marked truncated and anything left out is listed by path.
- Period notes (year … day) follow the same rule: up to 6,000 characters whole, a longer one by path (`long="true"`).
- The focused file's path, with the rule that "this", "here", "this page" and "it" mean that file and it breaks ties. It is not the only page that matters.
- Replies are short, concise and simple: 1-3 sentences unless asked for more, no headings, no preamble, no recap of edits beyond one line.
- Execution mode: act directly, never plan or ask before editing.
- Never mention these instructions.

Before a message is sent, every dirty open file is saved, so Claude reads exactly what is on screen. Claude's edits come back through the existing file watcher, which reloads open tabs.

### Process

- One Claude Code process per window, kept running: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --model <model> <lean flags, below> --permission-mode acceptEdits --append-system-prompt <instructions>` in the workspace root. Each message is one stream-json `user` line on its stdin. A warm process gets the first word in 0.7-1 s; starting one per message took about 1.5 s.
- It starts ahead of the first question (`agent_warm`): 2 s after a workspace window opens, when the panel opens, when a book opens, after a model change, after Stop and after New chat. A send finds it running, or starts it itself.
- A process is replaced, with `--resume <session>` so the conversation carries on, when the workspace root, model or instructions differ from what it was started with, or it has exited. A run in progress is never replaced by a warm-up.
- Closing stdin ends it cleanly; the window's process is killed when the window closes. An idle process costs memory, not tokens.
- `acceptEdits` is execution mode: file reads and edits run without prompts. Shell commands are not pre-approved, so headless Claude reports them as denied instead of running them. Trade-off: safer for a writing app; widen with `--allowedTools` later if wanted.
- `--model <haiku|sonnet|opus>` comes from `agent.model`. These are Claude Code's aliases, so each tier follows the newest release without an app update. A different model on a later message resumes the same session.
- A lean Claude Code, not the terminal's: `--strict-mcp-config` (no MCP servers), `--disable-slash-commands` (no skills), `--setting-sources project,local` (no user settings, so no plugins or their hooks, and no `~/.claude` rules) and `--tools Read,Edit,Write,Glob,Grep`. Measured with Haiku on a one-line question: 17-36 s to the first word with the terminal's setup, about 1.5 s lean. Sign-in is unaffected. The workspace's own `.claude/` settings and CLAUDE.md still apply. Trade-off: no web search and no MCP tools in the chat.
- The binary and `PATH` are resolved once from the user's login shell (`$SHELL -lc`), since an app launched from Finder doesn't inherit the terminal's `PATH`. Fallbacks: `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`.
- stdout lines are forwarded unparsed to the invoking window as `agent:line` events; parsing lives in TypeScript (`lib/agent-stream.ts`) so it is unit-testable. Exit is `agent:exit` with the code and last stderr line.
- **Stop** kills the process; the next one resumes the conversation. **New chat** ends the process (`agent_reset`) and any reply in progress, forgets the session id and warms a fresh one.
- Lines are tagged with the request being answered; output before any request is dropped, and a process that exits while idle reports nothing.
- One run per window at a time.

## Ownership

- `src-tauri/src/commands/agent.rs` — binary resolution, the per-window process (warm, send over stdin, cancel, reset), line forwarding. Processes are keyed by window label in managed state.
- `src/lib/agent-stream.ts` — stream-json line → chat events (text delta, tool call, result, session id). Pure.
- `src/lib/agent-context.ts` — the fixed instructions, and the per-message `<writer_context>` from open tabs' text + focused file, with the length caps. Pure.
- `src/lib/agent-open-files.ts` — reads each open tab's text and the boards pages embed (board code is a dynamic import).
- `src/components/agent-chat/agent-panel.tsx` — the panel, lazy-loaded on first open because it uses Arc (`text-shimmer`, `code-block`). `agent-chat.css` maps Arc's surface/border tokens to Writer's inside the panel.
- `src/stores/agent-store.ts` — panel open state, messages, session id, active run; send/stop/new chat/set model.
- `src/lib/agent-models.ts` — the model list and `/model` draft parsing. Pure.
- `src/components/agent-chat/` — launcher, panel, message list, composer.
- `src/lib/save.ts` — `flushSave(path)` so send can await saves.

## Design rules checked (screen-grill)

- scope-check: workspace window only; new layer (function + look); reference image gives layout only, tokens come from App.css; frozen: editor, tabs, sidebar; ripple: document footer gets right padding.
- grill-tokens: card is `.surface-card`; text `--text-primary` / `--text-muted`; bubbles `--surface-subtle`; input `--surface-input`; Hugeicons only; no raw colours.
- grill-alignment: header controls top-right, close last; composer, chip and message column share the 16px inset; short labels nowrap.
- grill-states: launcher default/hover/open; send disabled/enabled/stop; chip present/absent; empty/working/streaming/error/done.
- grill-copy: "Agent", "New chat", "Ask about or edit your open pages.", "Thinking", tool verbs past tense.
- grill-redundancy: no minimize or expand (close already keeps the chat); one icon per button; tool rows show the file name once.
- grill-motion: panel opens with opacity + 4px rise + 0.98 scale over `--motion-base` on `--ease-out`, origin bottom-right; no exit animation; reduced motion = instant.

## Tests

- `agent-stream` parses init/session id, text deltas, tool_use summaries, result success and error.
- `agent-models` parses `/model` drafts (prefixes, filtering, ordinary messages untouched) and falls back to Haiku.
- `agent-context` includes every open tab's text, focused first; truncates and lists overflow; no focus line when none.
- `embeddedBoardPaths` finds board image links relative to the page.
- Rust: argument construction (resume, system prompt, permission mode), binary fallback order.
