# Calendar Panel Spec

## Goal

A right-hand calendar that makes every day, week, month, quarter and year one
click away from its note, and lets the agent chat read the notes for the
periods the user is in now.

## Behavior

- **Cmd+]** toggles the panel (workspace windows only), and so does a toggle button that mirrors the sidebar's: on the panel's inner (left) edge in its header row while it is open, and 12px inside the editor's top-right corner while it is closed, with the tab row ending before it. **Cmd+[** and **Cmd+\\**
  keep toggling the left sidebar. The palette has **Toggle Calendar**. Visibility
  persists in the global `appearance.calendar-visible` setting (default off).
- The panel is a fixed 304px column right of the editor. It snaps open and shut
  like the sidebar (docs/motion.md). The tab row and the agent launcher move left
  by its width (`--right-panel-width`).
- The title ("October 2026") is an Arc dropdown that switches three views, each starting on the current period; Today and previous / next sit beside it:
  - **Days**: Arc Calendar, Monday-first, six rows. A week-number column (`W42`)
    sits left of the rows.
  - **Months**: the year's 12 months in 4 rows of 3; each row is a quarter, with
    `Q1`–`Q4` on the left.
  - **Years**: the decade plus one year either side.
- Clicking a day, week, month, quarter or year creates-or-opens its note:
  `2026-10-12.md`, `2026-W42.md` (ISO week and week-year), `2026-10.md`,
  `2026-Q4.md`, `2026.md`, in the daily-note folder. These are the Obsidian
  Periodic Notes default names. Existing day notes keep their names.
- Cmd+click (Ctrl+click off the Mac) does the same but opens the note in a
  new column right of the active tab, or focuses the tab already showing it.
- States: the current period reads in the accent colour. The open note gets the
  accent fill (on days, Arc's gliding selection disc). A note that exists shows a
  dot under its label. The folder is re-read on every watcher event, by file name only (`list_markdown_stems`): opening each note for its title (`read_directory`) took over a minute in an iCloud vault and, repeated on every event, starved the clicks' own file reads.
- Agent chat: every message carries the current year, quarter, month, week and
  day notes that exist, broadest first, as `<period_note period=… path=…>`. A note
  already open as a tab is referenced with `open_tab="true"` and not sent twice.
  Each note is capped at `MAX_FILE_CHARS`. Missing notes are skipped and never
  created.

## Ownership

- `lib/periodic-notes.ts`: names (`periodNoteStem`), ISO weeks, and path
  resolution through `resolveDailyNoteFile`.
- `lib/daily-note.ts` `openDatedNote`: the single create-or-open path and its
  errors, shared by Today's note and every period note.
- `hooks/use-daily-note.ts` `openPeriodNote`: binds the stores to it.
- `components/calendar-panel/`: a lazy chunk, because it is built on Arc
  (`calendar` and `dropdown-menu`, both with Pensée patches).
- QA: journeys `CAL-*` in `docs/qa/user-journeys.md`, specs in
  `e2e/specs/journeys/calendar.spec.js`.
- `lib/agent-open-files.ts` `collectAgentPeriodNotes` and `lib/agent-context.ts`:
  the agent context.

## Follow-ups

- Templates per period.
- Keyboard focus into the week and quarter columns (they are buttons, but Arc's
  arrow-key grid skips them).
- Title inference for period-note names (`isDailyNoteName` covers days only).
