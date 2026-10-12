# Project Views Spec

## Summary

The Projects space (SPECs/spaces-spec.md) shows its notes three ways, picked with an Arc segmented control in the page header where Library keeps its type tabs: **List** (the table it had), **Kanban** (one column per status) and **Timeline** (a bar per project from its start to its deadline). Moving a card or a bar writes the project note's own frontmatter, so the views stay plain markdown and Obsidian sees the same values.

Why: 66 project notes carry `Type: Project`, but only 18 have a status and almost none have dates. The list could show that; it could not help fix it.

## Fields

All three views read one model (`lib/projects.ts`), so a project shows the same status and dates everywhere.

| Field | Read from (first one set wins, keys ignore case) | Written to |
|---|---|---|
| Status | `Status` | `Status` |
| Start | `Start`, `Start date`, `Start_date`, `Starting date`, `Starting_date`, then `Dates`, `Creation Dates` | the first of the `Start` keys the note has, else a new `Start` |
| Deadline | `Deadline`, `Due`, `End date`, `End_date`, `Ending_date` | the first of those the note has, else a new `Deadline` |

- `Dates` and `Creation Dates` are when the vault's template made the note, so they stand in for a missing start but are never written: moving the bar adds `Start` and leaves them alone.
- Dates are read as `YYYY-MM-DD`, with or without a time or `[[ ]]`; anything else (a Templater `<% … %>` left in) counts as no date. Writes are `YYYY-MM-DD`.
- A write changes only that key's line (and its indented continuation lines); a missing key is added as the last line. The rest of the frontmatter stays byte for byte. Writes go through `editPage`, so an open note gets an undoable edit and a closed one is written to disk.

## Status

Columns, left to right: **No status**, **To-do**, **Ongoing**, **Done**, then any other value the vault uses, in the order first seen. Values match ignoring case and spelling: `todo`, `to do` → To-do; `in progress`, `doing`, `active` → Ongoing; `complete`, `completed`, `finished` → Done. The list and the kanban show the column's name, not the raw value. Moving a card writes the column's name (No status writes an empty `Status:`).

## Views

- **The view tabs** — List · Kanban · Timeline, List first and the default. The last one picked is remembered per space (`preferences.json`, `spaces.views`, keyed by space). The page title stays "Projects".
- **List** — Name, Status, Start, Deadline, Last edited; newest edit first, as before.
- **Kanban** — equal-width columns with a name and count; cards show the title and, when set, the deadline. Newest edit first in each column. Drag a card (pointer, 4px threshold) onto a column to move it; the target column highlights. Keyboard: Alt+Left / Alt+Right moves the focused card to the neighbouring column (history Back/Forward skips a key a control already handled). Esc cancels a drag. Click opens the note, Cmd+click opens it beside.
- **Timeline** — a sticky name column and a day grid with month labels and a today line. Projects with a date are rows sorted by start; projects with neither date sit under **No dates**. Drag a bar to move both dates, drag an end to change one; a project with one date shows a short bar whose free end sets the other date. Click the empty row of a project with no dates to give it a start on that day. Keyboard on a bar: Left/Right moves it a day, Shift+Left/Right moves its deadline. **Today** scrolls back to today, which is where the timeline opens.
- **New project** — **+ New project** sits at the foot of every kanban column and under the last timeline row. Click it, type a name, press Enter: Writer writes `<Name>.md` at the vault root (the name cleaned the way a new space's is) with `Type: Project`, plus `Status: <column name>` from a column (an empty `Status:` from No status) or `Start: <today>` from the timeline, and opens nothing. The field stays open and empty for the next one; Esc, or leaving it while empty, closes it. An empty name or one a note already has shows the reason under the field and writes nothing. The new project shows at once, first in its column or on today's row, until the notes are re-read with it. Both views create through one path (`createProjectNote` in `hooks/use-spaces.ts`, which shares the root-note write with `createSpaceNote`; the frontmatter comes from `projectNoteContent`, built with `withProjectEdit` so the keys are the ones the views read).
- A move shows at once; the card or bar keeps its new place until the file is re-read with it. A failed write puts it back and says why.

## Not in this pass

- Ordering cards inside a column (there is no field for it).
- Zoom levels on the timeline (one scale: a month is about 90px).
- Kanban/Timeline for spaces you add (`View:` still takes `gallery`, `list`, `cards`).
