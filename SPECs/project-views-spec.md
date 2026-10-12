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
- **Built from Arc** ([docs/arc.md](../docs/arc.md)): List is Arc's `sortable-data-table`, Kanban is Arc Pro's `kanban-board` block, tags are Arc's `badge`. The views module is loaded with `React.lazy`, so Arc and `motion` load only when Projects opens, and it calls `ensureArcTokens()`. Arc's surface tokens are mapped onto Writer's on `.projectViews` and on the space `.page`.
- **List** — Name, Status, Start, Deadline, Last edited, each header sortable (Arc); last edited, newest first, by default. Status sorts in board order. The name opens the note (Cmd+click beside). Status, Start, Deadline and Last edited have fixed widths sized for their longest value and never wrap; Name takes the rest, down to 200px, then ends in "…". Narrower than that (a tab column), the table scrolls sideways inside its card, Arc's rule for wide tables; under a 620px window Arc folds each row into two lines itself.
- **Kanban** — Arc's board: a column per status with its tag and count, a card per project with its deadline tag. Drag a card to another column (it lifts, tilts and springs into the slot that opens); from the keyboard, Space lifts the focused card, arrows move it, Space drops, Esc puts it back. Click or Enter opens the note, Cmd+click opens it beside. **Add project** at a column's foot, or **+** in its head, names a new project in that column. Moving a card inside its column keeps that order for the session only (there is no field for it); across a reload, columns are newest edit first.
- **Timeline** — a sticky name column and a day grid with month labels and a today line. Projects with a date are rows sorted by start; projects with neither date sit under **No dates**. Drag a bar to move both dates, drag an end to change one; a project with one date shows a short bar whose free end sets the other date. Click the empty row of a project with no dates to give it a start on that day. Keyboard on a bar: Left/Right moves it a day, Shift+Left/Right moves its deadline. **Today** scrolls back to today, which is where the timeline opens.
- **New project** — Arc's **Add project** in every kanban column, and **+ New project** under the last timeline row. Type a name, press Enter. A name a note already has takes that note, wherever it is in the vault (`findNoteNamed`: the file name ignoring case, markdown only; of several, one already on the board, then the shortest path):
  - a project already on the board moves to where it was added (its `Status` from a column, `Start: <today>` from the timeline), through the same edit a drag makes;
  - any other note becomes a project there (`adoptProjectNote`): `Type: Project` and the field are written into its frontmatter, the rest stays byte for byte. A note with another `Type` (a Book, say) is only taken after "“Trip” is a Book note. Make it a project instead?" is confirmed, since it would leave that type's space; declining changes nothing.
  - Only a name no note has writes `<Name>.md` at the vault root (`createProjectNote`, sharing the root-note write with `createSpaceNote`), with `Type: Project` plus the field. The frontmatter for both comes from `asProjectFrontmatter`, so the keys are the ones the views read.

  The field stays open for the next one; Esc, or leaving it while empty, closes it. An empty name writes nothing and says why. The project shows at once, first in its column or on today's row, until the notes are re-read with it.
- A move shows at once; the card or bar keeps its new place until the file is re-read with it. A failed write puts it back and says why.

## Tags

Status and deadlines show as Notion-style tags (Arc's badge, `Tag` in `project-views.tsx`), and a colour has one meaning everywhere (`statusTone` and `deadlineTag` in `lib/projects.ts`):

| Tag | Colour |
|---|---|
| To-do | gray |
| Ongoing | blue |
| Done | green |
| A status the vault adds | purple, brown, pink or yellow, fixed by its name |
| Deadline passed (not done) | red, "Overdue · Dec 20, 2023" |
| Deadline today, tomorrow or within 7 days | orange, "Due today" / "Due tomorrow" / "Due Oct 15" |
| Any other deadline, or a done project's | gray, "Due Mar 4" |

No status has no tag, only muted text. The words carry the meaning too, so it never rests on colour alone. Tag text mixes the hue into the theme's text colour; measured at 5:1 or more on the dark and light themes. Timeline bars take their status colour, and a red or orange deadline tag sits beside the bar's dates.

## Not in this pass

- Keeping a card's place inside a column across reloads (there is no field for it).
- Zoom levels on the timeline (one scale: a month is about 90px).
- Kanban/Timeline for spaces you add (`View:` still takes `gallery`, `list`, `cards`).
