# QA Checklist

The pass every change goes through before it is committed. It answers one
question: do the user journeys this change can reach still work? The journeys
are in [user-journeys.md](./user-journeys.md); the `pensee-qa` skill
(`.claude/skills/pensee-qa/`) walks this file.

Why it exists: unit tests and `vp check` pass while a feature the user relies
on stops working (2026-10-13: calendar clicks went dead in an iCloud vault and
nothing failed). Only driving the real app the way the user does catches that.

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

1. List changed files: `git status --short` plus `git diff --name-only master...`.
2. For each feature section in user-journeys.md, the section is **in** when a
   changed file sits under one of its **Code** paths (relative to `apps/desktop/`).
3. A shared file pulls in every section that uses it. `src/styles/tokens.css`,
   `src/components/app-layout.tsx`, `src/stores/editor-store.ts`,
   `src/hooks/use-keyboard-shortcuts.ts` and `src-tauri/src/lib.rs` put **all**
   sections in, because each of them reaches every screen.
4. Always add every ★ journey (the smoke set), whatever changed.

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
apps/desktop/e2e/qa/run.sh core calendar <other areas>
```

- It builds a debug e2e app (`target/debug`, about 90s incremental; it never
  touches the release build `scripts/ship-local.sh` uses), then runs the specs.
  Each spec file starts on a freshly seeded QA vault (`e2e/qa/seed-vault.mjs`)
  with default settings.
- `--no-build` only when nothing under `apps/desktop/` changed since the last
  build: the app embeds the frontend, so a stale build tests old code.
- No arguments runs every journey spec.

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
```

Put the same `QA:` line in the commit message body.

## Harness notes

Learned the hard way; each one cost a failed run.

- Act like the user: click and type on what is on screen. Use IPC (`invoke`)
  only to arrange files before a journey or to read the result on disk.
- The WebDriver plugin's `click()` sends no pointer events and no coordinates.
  - Radix menus and popovers open on `pointerdown`: dispatch it (see
    `switchView` in `calendar.spec.js`).
  - CodeMirror links resolve their target from the click's coordinates: use
    `mouseClick(element)` from `_helpers.js`. It also takes `{ metaKey: true }`.
- The e2e window is never in front (`document.hasFocus()` is false), so
  CodeMirror ignores a DOM selection set from a script: put the caret with a
  mouse click at the text's coordinates (`caretAfter` in `pen.spec.js`).
- React-controlled inputs: `fillField(selector, text)`. CodeMirror text:
  `typeInEditor(text)`. `browser.keys` does not reach either.
- `waitForClickable` fails on visible elements; use `waitForExist`.
- `browser.execute(async () => …)` returns `null`; use `executeAsync(done)`.
- A rejected `invoke` throws a WebDriverError instead of resolving
  `{ ok: false }`: check `fileExists` before deleting.
- Function selectors (`$(() => el)`) are not supported; tag the element with an
  attribute in `execute` and select that (`frontTitleField`).
- Opening a link puts its page in a new column. "The note in front" is the
  `[data-column-tab][data-focused]` column: use `activeTitle()` / `waitForTitle()`.
- The QA vault is small and local. Bugs that need a big or iCloud vault don't
  show here; make them `you` journeys, or time the Rust command directly
  against the user's vault, read-only.
- The pen waits on empty lines of yours that show faint words (`.cm-pen-waiting`, a widget CodeMirror ignores events on): put the caret there by clicking just left of the words (`caretInWaiting` in `pen.spec.js`); to replace typed text, click after it and send Backspace keydowns (CodeMirror runs its keymap on them).
