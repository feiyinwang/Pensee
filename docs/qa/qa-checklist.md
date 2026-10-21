# QA Checklist

The pass every change goes through before it is committed. It answers one
question: do the user journeys this change can reach still work? The journeys
are in [user-journeys.md](./user-journeys.md); the `pensee-qa` skill
(`.claude/skills/pensee-qa/`) walks this file.

Why it exists: unit tests and `vp check` pass while a feature the user relies
on stops working (2026-10-13: calendar clicks went dead in an iCloud vault and
nothing failed). Only driving the real app the way the user does catches that.
It also asks a second one: is every action as fast as before? The PERF
journeys and their rules are in [performance.md](./performance.md).

## 0. Does this change need the pass?

```
Did the change touch apps/desktop/ (src, src-tauri, styles, config)?
├── No (docs, SPECs, website, scripts only) → skip; say "QA: skipped, no app code changed"
└── Yes → run steps 1–6
```

## 1. Static checks

From `apps/desktop/`:

- `vp check` and `vp test`.
- Rust changed: `cargo test`, `cargo clippy`, `cargo fmt --check` in `src-tauri/`.

A failure in a file the change didn't touch is pre-existing: list it in the
report, don't fix it in this task. A failure in a touched file is this change's
to fix. Don't `git stash` to compare: the round-trip touches mtimes and forces
a full Rust rebuild.

## 2. Pick the journeys

Run only the journeys this change's code can reach. A journey whose Code paths
the change didn't touch is not run, ★ or not: running it proves nothing about
this change and costs minutes per pass (the user's call, 2026-10-15).

1. List the files **this task** changed (not other sessions' edits in the same
   tree): your own edits, plus `git diff --name-only master...` on a branch.
2. For each feature section in user-journeys.md, the section is **in** when a
   changed file sits under one of its **Code** paths (relative to `apps/desktop/`).
   A file named with a parenthesised list (`fs.rs (write_file)`,
   `editor-area/ (link-preview.ts, …)`) only pulls the section in when the
   change touches one of the listed parts.
3. Inside a section that is in, pick the journeys the changed code can reach,
   not the whole table: a change to the board's drag code picks the drag
   journeys, not the one that renames a board. When you can't tell which rows
   a file reaches, pick them all.
4. Shared files reach every screen: `src/styles/tokens.css`,
   `src/components/app-layout.tsx`, `src/stores/editor-store.ts`,
   `src/hooks/use-keyboard-shortcuts.ts`, `src-tauri/src/lib.rs`. For these,
   pick every ★ journey (one per feature) plus the rows the specific edit
   reaches (a new shortcut in `use-keyboard-shortcuts.ts` → that shortcut's
   journeys), never every row of every section.
5. Always add `PERF`, every speed journey ([performance.md](./performance.md)),
   whatever the change touched: a slowdown often lands far from the code that
   caused it, so speed is checked on every pass. Other than PERF, nothing
   picked (the change only reaches `manual`/`you` rows, or no Code path at
   all, e.g. a dev-only script) → run PERF alone.

Write the picked IDs down before running anything, so the report can show what
was and wasn't covered.

## 3. Automate what you'll check

For each picked journey whose Check is `manual`:

```
Is the journey in the feature this change is about?
├── Yes → write its it("<ID> …") in e2e/specs/journeys/<area>.spec.js now,
│         set Check to `auto: <area>`
└── No (pulled in by path only)
    └── Leave it `manual`; report it as "not checked"
```

Why: a spec is written once and runs on every later pass; a manual check is
redone each time and is the first thing skipped. Never report a `manual` or
`you` journey as passing without having run it.

A journey that needs an outside account, Finder, a file dialog, a trackpad
gesture, or a vault far larger than the QA vault becomes `you`, and goes in the
report for the user to try.

## 4. Run

```bash
apps/desktop/e2e/qa/run.sh --only CAL-02,CAL-05,ED-01
```

- `--only <IDs>` runs just those `it("<ID> …")` journeys, from whichever spec
  files hold them. Prefer it to naming areas: `core` and `pen` hold 17 and 24
  journeys, and an area name runs all of them.
- A picked journey that fails only under `--only` but passes when its whole
  file runs leans on an earlier journey's state: fix the spec so it arranges
  its own state (in its `it` or the file's `before`).
- It builds a debug e2e app (`target/debug`, about 90s incremental; it never
  touches the release build `scripts/ship-local.sh` uses), then runs the specs.
  Each spec file starts on a freshly seeded QA vault (`e2e/qa/seed-vault.mjs`)
  with default settings.
- `--no-build` only when nothing under `apps/desktop/` changed since the last
  build: the app embeds the frontend, so a stale build tests old code.
- No arguments runs every journey spec: only when the user asks for a full
  pass, never as the default.
- A PERF journey fails on its budget or on its baseline: follow the failure
  tree in [performance.md](./performance.md). Speed is the change's to fix in
  this task, the same as a broken journey.

## 5. Fix what fails

For each failing journey:

```
Does the app do the wrong thing for a user, or is the spec wrong?
├── App is wrong → fix the app (this task), rerun the journey
└── Spec is wrong (selector, timing, a harness gap)
    → fix the spec; never loosen the Expected column to make it pass
```

To tell them apart, look at the app: log the DOM or the file on disk from the
spec (`console.log` in the `it`, read with `grep DEBUG`). Per CLAUDE.md, if the
first fix doesn't work, add a debug log before trying a second.

Rerun every picked journey after the last fix, not just the one that failed: a
fix can break a neighbour.

## 6. Report

End the reply with:

```
QA: <n> journeys run, <n> pass, <n> fixed
- Fixed: CAL-02 (day click did nothing: …)
- Not checked (manual): ED-09, LNK-03
- For you to try: CAL-08 (large iCloud vault)
- Pre-existing failures: `vp check` type error in src/lib/library-add.ts
Speed: PERF-01 3.4ms (was 3.2), PERF-02 18ms (was 21, baseline updated), … all within budget
```

Put the same `QA:` and `Speed:` lines in the commit message body.

## Harness notes

Learned the hard way; each one cost a failed run.

- Act like the user: click and type on what is on screen. Use IPC (`invoke`)
  only to arrange files before a journey or to read the result on disk.
- The WebDriver plugin's `click()` sends no pointer events and no coordinates.
  - Radix menus and popovers open on `pointerdown`: dispatch it (see
    `switchView` in `calendar.spec.js`).
  - CodeMirror links resolve their target from the click's coordinates: use
    `mouseClick(element)` from `_helpers.js`. It also takes `{ metaKey: true }`.
  - So code that must react to the user's click listens for `click`, not
    `mousedown` (onboarding's click-to-write, `practice-guide.tsx`).
  - `waitForClickable` can time out on a button that `click()` presses fine:
    wait with `waitForExist`, then click (`onboarding.spec.js`).
- `browser.keys(["Enter"])` on a focused `<button>` sends the keydown but
  doesn't press the button: a screen that runs its focused choice on ↵
  handles Enter itself (onboarding's `Question`).
- The hidden e2e window throttles timers to about one a second: anything
  typed out character by character on a timer should write at once when
  `document.hidden` (onboarding's `typeInto`).
- The e2e window is never in front (`document.hasFocus()` is false), so
  CodeMirror ignores a DOM selection set from a script: put the caret with a
  mouse click at the text's coordinates (`caretAfter` in `pen.spec.js`).
- React-controlled inputs: `fillField(selector, text)`. CodeMirror text:
  `typeInEditor(text)`. `browser.keys` does not reach either.
- `waitForClickable` fails on visible elements; use `waitForExist`.
- A CodeMirror list line's `textContent` starts with its bullet (`- ` sits in
  a `cm-list-prefix` span) and a heading's with its hidden `## `: match
  `/^-?\s*Key: /`, and read a style off the text node holding the words, not
  the first text node.
- When another session is mid-edit in the same checkout, `run.sh` builds its
  half-done code too: run the journeys from a clean `git worktree` holding
  HEAD plus only this task's files.
- `browser.execute(async () => …)` returns `null`; use `executeAsync(done)`.
- A rejected `invoke` throws a WebDriverError instead of resolving
  `{ ok: false }`: check `fileExists` before deleting.
- Function selectors (`$(() => el)`) are not supported; tag the element with an
  attribute in `execute` and select that (`frontTitleField`).
- Opening a link puts its page in a new column. "The note in front" is the
  `[data-column-tab][data-focused]` column: use `activeTitle()` / `waitForTitle()`.
- A note's title also shows in the sidebar's file tree, so `//button[.//*[normalize-space(.)="A paper"]]` clicks the sidebar row, which opens the note without the Library card's extras (LIB-07): scope a Library card to its gallery, `//*[@data-cover="paper"]//button[…]`.
- The composer is `[role="dialog"][aria-label="New note"]` only when other UI is open beside it; in a spec run on its own it has no dialog role. Find its field as `input.composer-title[aria-label="Title"]` (LIB-08), and wait for `.app-splash` to go before ⌘N.
- A `timeoutMsg` is built when `waitUntil` is called, so a variable the condition fills (`seen`) shows its starting value: report it from a `.catch` instead (`waitForReaderBeside` in `library.spec.js`).
- The QA vault is small and local. Bugs that need a big or iCloud vault don't
  show here; make them `you` journeys, or time the Rust command directly
  against the user's vault, read-only.
- The pen waits on empty lines of yours that show faint words (`.cm-pen-waiting`, a widget CodeMirror ignores events on): put the caret there by clicking just left of the words (`caretInWaiting` in `pen.spec.js`); to replace typed text, click after it and send Backspace keydowns (CodeMirror runs its keymap on them).
- Only one QA run at a time per machine: `run.sh` kills any `tauri-webdriver` at start and every run uses the same port, so a second session's run kills the first mid-spec (ECONNREFUSED, "session not found"). Before running, check `pgrep -f "[w]dio.js run"` and wait for it to exit. Keep the brackets: without them the pattern matches the shell running your own wait loop (and every other session's), so the wait never ends.
- A wait loop that checks for other QA runs with `pgrep -f "…run\.sh…"` waits forever: every session's waiting shell has `run.sh` in its own command line (the run it is waiting to start), so the loops see each other, and themselves, as runs. Match real processes instead: `pgrep -f "^node .*[w]dio(\.js)? run"`, `pgrep -x tauri-webdriver`, `pgrep -x cargo`.
- An e2e app left running (often from another worktree's run) keeps the app's WebDriver port 4445, and every spec then drives its old build: journeys fail on code you didn't write, and the loaded bundle (`[...document.scripts]`) isn't the one in `dist/`. `run.sh` now stops with the holder's pid; quit that app, then rerun.
- Reading or typing into "the visible editor" with `.find((el) => el.offsetParent)` picks the leftmost column when a session restores several; scope it to `[data-column-tab][data-focused]` (as `typeInEditor` and `frontTitle` do).
- The e2e window is hidden (`document.visibilityState` is `hidden`): WebKit freezes its animation clock and runs measure frames late. Wait for an animation to start (`waitUntil`), and to check what happens when one ends, `finish()` it from the spec (ED-13). `getAnimations()` leaves out `::before`/`::after` animations; pass `{ subtree: true }`.
- The e2e window is hidden, so WebKit does not run CSS transitions in it: `getComputedStyle` and screenshots show colours frozen at the start of a transition (an `oklab(…)` value is the tell). Before checking a colour or taking a screenshot of a state change, inject `*{transition:none!important}`.
- A note written with `write_file` after launch doesn't show in the ⌘O
  palette (its index is built at startup): seed the note in
  `e2e/qa/seed-vault.mjs` instead.
- `navigator.clipboard.readText()` is refused in the e2e webview: read what
  a Copy button wrote with `execSync("pbpaste")` in the spec (YT-07).
- With the Agent panel open, a note opened from ⌘O leaves focus on `<body>`, not in the editor: a journey that types right after opening a note runs before any journey that opens the Agent in its file (YT-10 before YT-08).
- Two `run.sh` runs at once (another session's) share the driver port 4444: the second's specs fail with `UND_ERR_SOCKET` / `ECONNREFUSED` on `/session` before any journey runs. Wait until `pgrep -f e2e/qa/run.sh` is empty, then rerun with `--no-build`.
- The launch splash (`.app-splash`) never runs in the hidden e2e window; `ENTRANCE_GUARD_MS` in `app-splash.tsx` finishes it after 3s and unmounts it (the hidden window sends no `animationend`, so a `finish()` alone leaves it mounted). It ignores the pointer, so clicks reach the app under it, but a screenshot or a check of what is visible in the first 3s of a spec sees the splash: wait for `.app-splash` to be gone first (WS-05). Any pointerdown or keydown in those 3s skips it to its reveal (WS-06), which is harmless for a spec.
- The AUTH journeys need Claude Code signed out, and must never sign out the Claude this Mac works with: run them on a sandbox Claude, `CLAUDE_CONFIG_DIR=$(mktemp -d) apps/desktop/e2e/qa/run.sh --only AUTH-…` (the app's `claude` inherits it; a fresh dir is signed out). Add `ANTHROPIC_API_KEY=not-a-real-key` for AUTH-09. AUTH-07 runs only on a sandbox that is signed in.
- Board drags (BRD-07, PERF-07): a synthetic pointer can't be captured, so stub `setPointerCapture` / `releasePointerCapture` on the board's `svg.wr-board-svg` before dispatching. The board handles the first `pointermove` of a gesture at once and coalesces later ones to animation frames, which the hidden window barely runs: drive a gesture as pointerdown, one move, pointerup (pointerup applies a still-pending move), and keep each move well past the drag threshold from where the card now sits (it may have snapped). The fullscreen board's `is-open` class waits on an animation frame too: wait for a card's rect to stop changing instead. The glide and hand-over after a dock are frame-driven, so read a docked card's place from the `.board.svg` (its scene is XML-escaped in `<metadata>`).
- A board with a card selected types a letter key into that card instead of picking a tool (BRD-08): clear the selection first with an Escape keydown on `.wr-board-host`, only while `.wr-board-selbox` exists, since Escape with nothing selected closes the board.
- A colour animated by a CSS animation still reads back from `getComputedStyle` as `oklab(…)` after `finish()`; to check a resting colour, `cancel()` the animations instead (resting styles are the last frame when the keyframes go `from` a first frame, as the Full Disk Access guide's do; IMP-03).
- A scroll in the hidden e2e window runs none of the frames that follow it: the section rail's active heading (`useActiveHeadings`, rAF) stays put, and CodeMirror never re-measures, so a scroll to a far heading lands short by its height guess (ED-21). Check that the target came into view, not that it is marked; the mark following a scroll is a `you` journey (ED-24).
- A tooltip placed after the page moves (the pen's box, PEN-33) needs CodeMirror to measure it again, and the hidden window runs no frames for that: a 1px scroll on each poll stands in for them (`waitForBoxOnScreen`). Where the page keeps moving after the click (a note just opened putting back its scroll, PEN-32), even that isn't enough: it's a `you` journey.
- `typeInEditor` types at CodeMirror's own selection, not at the end: CodeMirror ignores the scripted DOM range it sets. A journey that leaves several items selected (BLK-05) makes the next journey's typing replace them. Click the caret into place first (`caretAtEnd` in `blocks.spec.js`).
- A wiki link that wraps across two lines has two boxes, and its `getBoundingClientRect()` centre falls between them, so a synthetic press there opens nothing: press `getClientRects()[0]` (PERF-08).
- CodeMirror places its measured overlays (H1–H6 labels, grips) on an animation frame, which the hidden e2e window barely runs, so a freshly opened note shows its `.cm-heading-line`s but often no `.wr-heading-level` labels and only the first few lines. Wait on the lines; a pinch (TAB-09) measures synchronously and is what places the labels.
- The book reader paints its highlights, and a jump's flash, on an animation frame (`reader-controller.ts`), which the hidden e2e window barely runs: a spec sees no `CSS.highlights` entries at all, saved highlights included. Check a highlight's or a jump's look by hand (BK-06); a spec can check the pin, the tooltip and the reader opening (BK-05).
- ⌘O lists only the vault's recent notes until you type, and the seed clears them, so a fresh vault's ⌘O shows "No results found.": a spec that needs rows on an empty query opens a few notes first (PERF `before`), and waiting for any `[cmdk-item]` right after opening ⌘O hangs. Recent also lists the note you're about to search for, so tell results apart by the `[cmdk-group-heading]` reading `Results` (PERF-03).
