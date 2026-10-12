# Spaces Spec

## Summary

The sidebar stops being a folder tree. It shows **Search**, **Today**, a **Spaces** section (Projects, Library, Inspirations, Files, and any space you add), then Pinned and Recents. Clicking a space opens it as a page in the editor area. A space is a saved question about frontmatter, `Type:`, never a folder: a note belongs to Library because it says `Type: Book`, wherever it lives on disk.

Why: in the user's vault 4,165 of 5,540 notes sit in `4. Archive`, every new note since August lands at the root, and 600+ notes already carry `Type:` (Book 162, YouTube 83, Project 66, Paper 58, Course 15). The folders were not being used; the types were.

## Everything stays markdown

- A note joins a space by its own frontmatter (`Type: Book`). No database, no index file in the vault.
- A space you add is a markdown note at the vault root:

  ```yaml
  ---
  Type: Space
  Shows: Recipe
  View: gallery
  ---
  ```

  `Shows` takes one type or a comma list; `View` is `gallery`, `list` or `cards` (default `gallery`). In Obsidian it is an ordinary note.
- The four built-in spaces are defined in code (`lib/spaces.ts`), so a vault gets them without Writer writing files into it.

## Built-in spaces

| Space | Shows | View |
|---|---|---|
| Projects | `Type: Project` | list: name, status, last edited |
| Library | tabs: Books (`Book`), Videos (`YouTube`, `Video`), Courses (`Course`), Podcasts (`Podcast`), Papers (`Paper`) | gallery, one cover shape per tab |
| Inspirations | `Type: Inspiration` | cards: title and first line |
| Files | every file | the folder tree (moved here from the sidebar's Everything section) |

Library opens on Books. Its tabs are an Arc segmented control with the count of each tab.

## Covers

`Cover:` (relative to the note's folder, or an `https` URL) is shown when present. Otherwise each category draws its own default cover from the note's title and author, coloured by a hash of the title so a note keeps its colour:

| Category | Shape | Default cover |
|---|---|---|
| Book | 2:3 | spine edge, serif title, author; three layouts picked by the hash |
| Video | 16:9 | title in a thumbnail frame with a play mark |
| Course | 4:3 | "Course" eyebrow over the title |
| Podcast | 1:1 | show name set large with a microphone mark |
| Paper | 3:4 | a typeset title page: venue and year, serif title, authors, text lines |

A cover that fails to load falls back to the default cover.

## Sidebar

- Today opens today's daily note (`openTodaysNote`).
- Spaces: one row per space, highlighted when its page is the active tab. A `+` beside the label (always visible) opens an inline form: name, the type it shows, view. Create writes `<Name>.md` and opens it; an empty name or an existing file shows an inline error.
- Pinned and Recents are unchanged.
- The Everything tree is gone from the sidebar; it lives in the Files space. Right-click → New file / New folder opens Files and renames the new entry there. Reveal in Files (tab menu) opens Files and scrolls to the row.

## Space page

- A `space` page kind (`page-kinds/space.ts`): `{ kind: "space", id }` for built-ins, `{ kind: "space", id: "note", path }` for a space note (follows renames, closes on delete).
- Opening a note from a space replaces the space in that tab; Back returns to it.
- Empty tab: "Add your first book" and "Any note with Type: Book shows up here."

## Data

`list_typed_notes(types)` (Rust, `commands/spaces.rs`) walks the workspace index and returns the markdown notes whose `Type` matches one of `types` (case-insensitive), with their top-level scalar frontmatter properties, title and first line of text. Each file's parse is cached by path, size and modification time, so repeat calls only re-read changed files. The frontend refetches when the sidebar metadata version changes.

## Not in this pass

- Fetching covers from the web (YouTube thumbnails, podcast artwork).
- A `+ New` button inside a space.
- Project status tabs (Active / Someday / Done): status values in the vault are mostly empty, so the list shows the raw `Status` or "No status".
- Writing the matching notes into the space note as `[[links]]`.
