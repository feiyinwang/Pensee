# Calendar Panel Spec

## Goal

A right-hand calendar that makes every day, week, month, quarter and year one
click away from its note, and lets the agent chat read the notes for the
periods the user is in now.

## Behavior

- **Cmd+]** toggles the panel (workspace windows only), and so does a toggle button that mirrors the sidebar's: on the panel's inner (left) edge in its header row while it is open, and 12px inside the editor's top-right corner while it is closed, with the tab row ending before it. **Cmd+[** and **Cmd+\\**
  keep toggling the left sidebar. The palette has **Toggle Calendar**. Visibility
  persists in the global `appearance.calendar-visible` setting (default off).
- The panel is a fixed 288px column right of the editor. It snaps open and shut
  like the sidebar (docs/motion.md). The tab row and the agent launcher move left
  by its width (`--right-panel-width`).
- A segmented control switches three views, each starting on the current period:
  - **Days**: Arc Calendar, Monday-first, six rows. A week-number column (`W42`)
    sits left of the rows.
  - **Months**: the year's 12 months in 4 rows of 3; each row is a quarter, with
    `Q1`–`Q4` on the left.
  - **Years**: the decade plus one year either side.
- Clicking a day, week, month, quarter or year creates-or-opens its note:
  `2026-10-12.md`, `2026-W42.md` (ISO week and week-year), `2026-10.md`,
  `2026-Q4.md`, `2026.md`, in the daily-note folder. These are the Obsidian
  Periodic Notes default names. Existing day notes keep their names.
- States: the current period reads in the accent colour. The open note gets the
  accent fill (on days, Arc's gliding selection disc). A note that exists shows a
  dot under its label. The folder is re-read on every watcher event.
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
  (`calendar` with the Writer patch, `segmented-control`).
- `lib/agent-open-files.ts` `collectAgentPeriodNotes` and `lib/agent-context.ts`:
  the agent context.

## Follow-ups

- Templates per period.
- Keyboard focus into the week and quarter columns (they are buttons, but Arc's
  arrow-key grid skips them).
- Title inference for period-note names (`isDailyNoteName` covers days only).
