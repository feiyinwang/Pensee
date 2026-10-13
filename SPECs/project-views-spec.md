# Project Views Spec

## Summary

The Projects space (SPECs/spaces-spec.md) shows its notes as a **Kanban**, one column per status. Moving a card writes the project note's own frontmatter, so the board stays plain markdown and Obsidian sees the same values.

Why: 66 project notes carry `Type: Project`, but only 18 have a status and almost none have dates. A list could show that; it could not help fix it.

There used to be **List** and **Timeline** views beside it, picked from a segmented control in the header. They were removed on 2026-10-13, at the user's request, leaving the board alone.

## Fields

The board reads one model (`lib/projects.ts`), so a project shows the same status and dates on every card.

| Field    | Read from (first one set wins, keys ignore case)                                                      | Written to                                                     |
| -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Status   | `Status`                                                                                              | `Status`                                                       |
| Start    | `Start`, `Start date`, `Start_date`, `Starting date`, `Starting_date`, then `Dates`, `Creation Dates` | the first of the `Start` keys the note has, else a new `Start` |
| Deadline | `Deadline`, `Due`, `End date`, `End_date`, `Ending_date`                                              | the first of those the note has, else a new `Deadline`         |

- `Dates` and `Creation Dates` are when the vault's template made the note, so they stand in for a missing start but are never written.
- Dates are read as `YYYY-MM-DD`, with or without a time or `[[ ]]`; anything else (a Templater `<% … %>` left in) counts as no date. Writes are `YYYY-MM-DD`.
- A write changes only that key's line (and its indented continuation lines); a missing key is added as the last line. The rest of the frontmatter stays byte for byte. Writes go through `editPage`, so an open note gets an undoable edit and a closed one is written to disk.

## Status

Columns, left to right: **No status**, **To-do**, **Ongoing**, **Done**, then any other value the vault uses, in the order first seen. Values match ignoring case and spelling: `todo`, `to do` → To-do; `in progress`, `doing`, `active` → Ongoing; `complete`, `completed`, `finished` → Done. The kanban shows the column's name, not the raw value. Moving a card writes the column's name (No status writes an empty `Status:`). The board only writes `Status`; a new project's template may still set dates.

## Views

- **One view, no switcher** — the page header shows only the title and count.
- **Built from Arc** ([docs/arc.md](../docs/arc.md)): Arc Pro's `kanban-board` block, tags are Arc's `badge`. The views module is loaded with `React.lazy`, so Arc and `motion` load only when Projects opens, and it calls `ensureArcTokens()`. Arc's surface tokens are mapped onto Pensée's on `.projectViews` and on the space `.page`.
- **Kanban** — a column per status with its tag and count; a card per project with its deadline tag. Drag a card to another column (it lifts, tilts and springs into the slot that opens); from the keyboard, Space lifts the focused card, arrows move it, Space drops, Esc puts it back. Click or Enter opens the note, Cmd+click opens it beside. **Add project** at a column's foot, or **+** in its head, names a new project in that column. Moving a card inside its column keeps that order for the session only (there is no field for it); across a reload, columns are newest edit first.
- **Uses the room it has** — the Projects page drops the 1100px reading width the other spaces keep (`.page.fill`) and the board runs to the bottom of the pane. Columns share the width and narrow to 200px (`--kanban-col-min`, a Pensée patch on Arc's block) before the board scrolls sideways, so a tab pinched open to the whole window shows every column with no scrollbar. In a narrow tab column the board scrolls sideways and opens with **Ongoing** in the middle. It scrolls down inside itself only when a column is taller than the pane; under 420px of board height the page scrolls instead.
- **Done folds** — Done shows as many cards, newest first, as fit in one screen of the board, with room left for the toggle and the add row. The rest fold behind **Show N more** at the column's foot; **Show fewer** folds them again. The column head keeps counting all of them. What fits is measured with every card rendered, in a layout pass before paint, and measured again when the board's size changes (a pinch, a column split, a window resize) or the done cards change. The fold lasts the session. Folded cards aren't on the board, so a drag can't land between them; they keep their place at the end of Done.
- **New project** — Arc's **Add project** (and **+**) in every kanban column opens the add field (`AddField`, rendered through the block's `composer` patch). Typing lists up to six notes whose names match (`fuzzySearch`, markdown only). A project already on the board shows its status tag; any other note shows its folder. The first row is the note named exactly what was typed (of several, one already on the board, then the shortest path, as `findNoteNamed` picks). Without one, the first row is **Create “name”**. Enter takes the highlighted row, arrows move it, and a click picks a row. Enter typed before the suggestions arrive still finds an exact name through `findNoteNamed`, so nothing is duplicated:
  - a project already on the board moves to the column it was added in, through the same edit a drag makes;
  - any other note becomes a project there (`adoptProjectNote`): `Type: Project` and the field are written into its frontmatter, the rest stays byte for byte. A note with another `Type` (a Book, say) is only taken after "“Trip” is a Book note. Make it a project instead?" is confirmed, since it would leave that type's space; declining changes nothing.
  - Only a name no note has makes a new note (`createProjectNote`), from the vault's project template: the Templater folder template (`.obsidian/plugins/templater-obsidian/data.json`, `folder_templates`) whose note is `Type: Project`. The note goes in that folder, with the template's properties and body. `tp.file.title` and `tp.file.creation_date(…)` / `tp.date.now(…)` with a plain format are filled; any other tag can't run here and is dropped (`lib/project-template.ts`). Then the field is set (`asProjectFrontmatter`). A new note's `Status` is the column's, so the template's own status never hides it. Templater's settings and the project template are read once per vault (only templates named for projects at first, so a vault of iCloud placeholders downloads one file, not every template) and kept until one changes; Projects asks for them when it opens, so a new project doesn't wait on them (`hooks/vault-templates.ts`). Without such a template, `<Name>.md` is written at the vault root with `Type: Project` plus the field. Notes are made exclusively (`create_file`), so a note written meanwhile is never overwritten.

  The field stays open for the next one; Esc, or leaving it while empty, closes it. An empty name writes nothing and says why. The project shows at once, first in its column, until the notes are re-read with it.

- A move shows at once; the card keeps its new place until the file is re-read with it. A failed write puts it back and says why.

## Tags

Status and deadlines show as Notion-style tags (Arc's badge, `Tag` in `project-views.tsx`), and a colour has one meaning everywhere (`statusTone` and `deadlineTag` in `lib/projects.ts`):

| Tag                                       | Colour                                              |
| ----------------------------------------- | --------------------------------------------------- |
| To-do                                     | gray                                                |
| Ongoing                                   | blue                                                |
| Done                                      | green                                               |
| A status the vault adds                   | purple, brown, pink or yellow, fixed by its name    |
| Deadline passed (not done)                | red, "Overdue · Dec 20, 2023"                       |
| Deadline today, tomorrow or within 7 days | orange, "Due today" / "Due tomorrow" / "Due Oct 15" |
| Any other deadline, or a done project's   | gray, "Due Mar 4"                                   |

No status has no tag, only muted text. The words carry the meaning too, so it never rests on colour alone. The colours are the writing inks (red is oxblood, orange sepia, green verdigris, blue indigo, gray graphite; [ink-only-colour-spec.md](ink-only-colour-spec.md#project-tags)); tag text mixes the ink into the theme's text colour, measured at 5.2:1 or more on Cream and 6.5:1 on Ink. 

## Not in this pass

- Keeping a card's place inside a column across reloads (there is no field for it).
- Keeping Done unfolded across launches.
- Kanban for spaces you add (`View:` still takes `gallery`, `list`, `cards`).
