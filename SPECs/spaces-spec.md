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
| Projects | `Type: Project` | list, kanban or timeline ([project-views-spec.md](project-views-spec.md)) |
| Library | tabs: Books (`Book`), Videos (`YouTube`, `Video`), Courses (`Course`), Podcasts (`Podcast`), Papers (`Paper`) | gallery, one cover shape per tab |
| Inspirations | `Type: Inspiration` | cards: title and first line |
| Files | every file | the folder tree (moved here from the sidebar's Everything section) |

Library opens on Books. Its tabs are an Arc segmented control with the count of each tab.

Clicking a card opens its note in place. When the note's `Book` file (a PDF or EPUB, relative to the note) exists, the book opens in the column right after the note, as **Open beside** does (`openBookBesideOpenPage` in `lib/book-import.ts`). A note without one, or whose file is gone, just opens, with no notice.

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

A local `Cover:` is drawn from a thumbnail, never the full picture: the gallery asks for `thumb://` (`convertFileSrc(path, "thumb")?w=&h=`, `src-tauri/src/thumbs.rs`) with the box its kind is drawn in at 2x (`THUMB_BOX` in `space-cover.tsx`), and the handler scales the image to cover that box, encodes it as JPEG (PNG when it has transparency) and caches it in the app's cache folder under `cover-thumbs/`, keyed by path, size and modified time. It runs on the blocking pool, not the main thread, and checks the asset protocol's scope. A picture already inside the box, or one the decoder can't read, is served as it is. Why: a Library of ~130 saved covers at ~700×1024 (some 2000×3000) made WebKit decode and downscale hundreds of megabytes of bitmaps while scrolling, and the gallery stalled.

### Covers from the web

Covers come from the note's own link (`url`, `link` or `source`, first non-blank; a bare `youtube.com/…` gets `https://`). Parsing lives in `lib/covers.ts`.

- **Shown live:** a video with a YouTube link (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`) and no `Cover:` shows `https://i.ytimg.com/vi/<id>/hqdefault.jpg` straight away. That is one image request per card, and nothing is written.
- **Saved on request:** nothing is downloaded or written until the user asks. A card that has a cover to get (that YouTube thumbnail, or a podcast's page) shows a **Get cover** button over the cover's corner on hover. The gallery's "N covers not saved in their notes yet · **Get covers**" line gets them all, one at a time. `save_web_cover` (Rust, `commands/covers.rs`) runs the URL through `fetch_link_preview`. A direct image is used as is; a page gives its Open Graph image. The command downloads the image (`image/*` only, 10 MB cap) to `<stem>-assets/cover.<ext>` (`cover-2.<ext>` when one exists) and returns that path. The frontend writes it with `withCover` through `editPage`: it fills a blank or `null` `Cover:` line in place, else adds the line after `Type:`, and leaves every other line byte for byte. A cover the note already has is never replaced.
- **Why not automatic:** saving changes the note's modified time, and Library sorts by last edited. Fetching on open would reorder the list and rewrite dozens of files without asking.
- A failure shows an editor notice and leaves the note as it was.

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

`list_typed_notes(types)` (Rust, `commands/spaces.rs`) walks the workspace index and returns the markdown notes whose `Type` matches one of `types` (case-insensitive), with their top-level scalar frontmatter properties, title and first line of text. Each file's parse is cached by path, size and modification time, so repeat calls only re-read changed files. `useTypedNotes` reads at once when a space opens and keeps the last read per workspace and set of types, so a space opened again paints its notes on the first frame while the reread runs behind it. Only rereads after a file change (the sidebar metadata version) wait 300 ms, so a burst of saves costs one read.

## Not in this pass

- Covers for other video hosts (Vimeo, Bilibili) and for books, courses and papers.
- A `+ New` button inside a space.
- Writing the matching notes into the space note as `[[links]]`.
