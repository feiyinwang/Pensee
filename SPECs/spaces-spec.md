# Spaces Spec

## Summary

The sidebar stops being a folder tree. It shows **Search**, **Today**, a **Spaces** section (Projects, Library, Files, and any space note in the vault), then Pinned and Recents. Clicking a space opens it as a page in the editor area. A space is a saved question about frontmatter, `Type:`, never a folder: a note belongs to Library because it says `Type: Book`, wherever it lives on disk.

Why: in the user's vault 4,165 of 5,540 notes sit in `4. Archive`, every new note since August lands at the root, and 600+ notes already carry `Type:` (Book 162, YouTube 83, Project 66, Paper 58, Course 15). The folders were not being used; the types were.

## Everything stays markdown

- A note joins a space by its own frontmatter (`Type: Book`). No database, no index file in the vault.
- Templates are not entries: a note in the vault's template folder never shows in a space, whatever its `Type`. The folder is Templater's `templates_folder` (`.obsidian/plugins/templater-obsidian/data.json`) and, when that file exists, the core Templates plugin's `folder` (`.obsidian/templates.json`); a folder set to the vault root counts as none. Add project's suggestions and its exact-name match skip them too. Why: a project template says `Type: Project` so the notes made from it do, and it showed on the board, in Done, as a project.
- A custom space is a markdown note (written by hand; Pensée has no button to create one):

  ```yaml
  ---
  Type: Space
  Shows: Recipe
  View: gallery
  ---
  ```

  `Shows` takes one type or a comma list; `View` is `gallery`, `list` or `cards` (default `gallery`). In Obsidian it is an ordinary note.

- The three built-in spaces are defined in code (`lib/spaces.ts`), so a vault gets them without Pensée writing files into it.

## Built-in spaces

| Space    | Shows                                                                                                                   | View                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Projects | `Type: Project`                                                                                                         | kanban ([project-views-spec.md](project-views-spec.md))            |
| Library  | tabs: Books (`Book`), Videos (`YouTube`, `Video`, `Course`: courses are videos), Podcasts (`Podcast`), Papers (`Paper`) | gallery, one cover shape per tab                                   |
| Files    | every file                                                                                                              | the folder tree (moved here from the sidebar's Everything section) |

Library opens on Books. Its tabs are an Arc segmented control with the count of each tab. A gallery space (Library, or one you add with `View: gallery`) has no reading-width cap: its cover grid fills the width its tab has, adding a column for every cover's width of room.

Clicking a card opens its note in place. When the note's `Book` file (a PDF or EPUB, relative to the note) exists, the book opens in the column right after the note, as **Open beside** does (`openBookBesideOpenPage` in `lib/book-import.ts`). A note without one, or whose file is gone, just opens, with no notice.

## Covers

A book whose `Book:` is an EPUB shows the cover inside that file first (see below). Then `Cover:` (relative to the note's folder, or an `https` URL) is shown when present. Otherwise each category draws its own default cover from the note's title and author, coloured by a hash of the title so a note keeps its colour:

| Category | Shape | Default cover                                                          |
| -------- | ----- | ---------------------------------------------------------------------- |
| Book     | 2:3   | spine edge, serif title, author; three layouts picked by the hash      |
| Video    | 16:9  | title in a thumbnail frame with a play mark                            |
| Podcast  | 1:1   | show name set large with a microphone mark                             |
| Paper    | 3:4   | a typeset title page: venue and year, serif title, authors, text lines |

A cover that fails to load falls back to the next one: the book's own cover, then `Cover:`, then a video's live thumbnail, then the default cover.

**A book's own cover.** When a note's `Book:` names an `.epub` (relative to the note's folder, optionally in `[[ ]]`), the gallery asks `thumb://` for that EPUB, and the handler serves the cover inside it, the one Apple Books shows. It reads only the zip's directory and three entries: `META-INF/container.xml` names the package file, the package file's manifest marks the cover (EPUB 3 `properties="cover-image"`, else EPUB 2 `<meta name="cover" content="<id>">`, else the first `image/*` item), and that entry is scaled, cached and checked for one flat colour exactly like a `Cover:` image. An EPUB without a cover answers 404, so the card moves on to `Cover:`. The book's cover wins over `Cover:` because a saved cover can be stale or solid black, and the note's page card (`book-card.tsx`) already prefers the book's own. Why on the server: reading whole EPUBs in the webview for every card would bring back the scrolling stalls the thumbnails fixed. A PDF book keeps its `Cover:`: drawing a PDF's first page would need a PDF renderer in Rust, and the page card does that in the webview only for the one book open.

A local `Cover:` is drawn from a thumbnail, never the full picture: the gallery asks for `thumb://` (`convertFileSrc(path, "thumb")?w=&h=`, `src-tauri/src/thumbs.rs`) with the box its kind is drawn in at 2x (`THUMB_BOX` in `space-cover.tsx`), and the handler scales the image to cover that box, encodes it as JPEG (PNG when it has transparency) and caches it in the app's cache folder under `cover-thumbs/`, keyed by path, size and modified time. It runs on the blocking pool, not the main thread, and checks the asset protocol's scope. A picture already inside the box, or one the decoder can't read, is served as it is. A picture of one flat colour (every pixel of a 32×32 sample within 12 per channel) is refused with 422, and the refusal is cached as `<key>.blank`, so the card draws its default cover. Why: an Apple Books export can save a cover that is solid black, which reads as an error, not a cover. Why: a Library of ~130 saved covers at ~700×1024 (some 2000×3000) made WebKit decode and downscale hundreds of megabytes of bitmaps while scrolling, and the gallery stalled.

### Covers from the web

Covers come from the note's own link (`url`, `link` or `source`, first non-blank; a bare `youtube.com/…` gets `https://`). Parsing lives in `lib/covers.ts`.

- **Shown live:** a video or a podcast with a YouTube link (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`) and no `Cover:` shows `https://i.ytimg.com/vi/<id>/hqdefault.jpg` straight away. That is one image request per card, and nothing is written.
- **Saved on request:** nothing is downloaded or written until the user asks. A card that has a cover to get (that YouTube thumbnail, or a podcast's page; a podcast on YouTube gets its thumbnail) shows a **Get cover** button over the cover's corner on hover. The gallery's "N covers not saved in their notes yet · **Get covers**" line gets them all, one at a time. `save_web_cover` (Rust, `commands/covers.rs`) runs the URL through `fetch_link_preview`. A direct image is used as is; a page gives its Open Graph image. The command downloads the image (`image/*` only, 10 MB cap) to `<stem>-assets/cover.<ext>` (`cover-2.<ext>` when one exists) and returns that path. The frontend writes it with `withCover` through `editPage`: it fills a blank or `null` `Cover:` line in place, else adds the line after `Type:`, and leaves every other line byte for byte. A cover the note already has is never replaced.
- **Why not automatic:** saving changes the note's modified time, and Library sorts by last edited. Fetching on open would reorder the list and rewrite dozens of files without asking.
- A failure shows an editor notice and leaves the note as it was.

## Sidebar

- Today opens today's daily note (`openTodaysNote`).
- Spaces: one row per space, highlighted when its page is the active tab. The label has no `+`: the four built-ins cover the vault, and the add-space form was removed (2026-10-12). A space note you write by hand still shows.
- Pinned and Recents are unchanged.
- The Everything tree is gone from the sidebar; it lives in the Files space. Right-click → New file / New folder opens Files and renames the new entry there. Reveal in Files (tab menu) opens Files and scrolls to the row.

## Space page

- A `space` page kind (`page-kinds/space.ts`): `{ kind: "space", id }` for built-ins, `{ kind: "space", id: "note", path }` for a space note (follows renames, closes on delete).
- Opening a note from a space replaces the space in that tab; Back returns to it.
- Empty tab: "Add your first book" and "Any note with Type: Book shows up here." A Library tab you fill by hand also has **Add book** (its own noun), and the header a **+**; both open the palette's add mode (SPECs/add-to-library-spec.md).

## Data

`list_typed_notes(types)` (Rust, `commands/spaces.rs`) walks the workspace index and returns the markdown notes whose `Type` matches one of `types` (case-insensitive), with their top-level scalar frontmatter properties, title and first line of text. Each file's parse is cached by path, size and modification time, so repeat calls only re-read changed files. The cache is also saved to the app's cache folder (`note-meta.json`) after each scan and every 20 s during one, and loaded on the first scan after launch, so a launch only `stat`s each note; notes that are gone are dropped when it is saved. Why: on an iCloud vault mid-sync opening a note can take seconds while a stat stays instant, and rereading all ~5,500 heads at every launch left Library empty for over twenty minutes. While a scan runs it sends `spaces:notes-read` at most every 2 s, and `useTypedNotes` answers it (and its first read) with `list_typed_notes(types, cachedOnly: true)`: the notes whose heads are cached so far, without opening a file or waiting on the lock. That preview shows until the full read lands and never replaces one. Why: the first scan after the cache is lost still reads every head, and a blank Library for that whole time reads as all books gone. Only one scan runs at a time: a call waits on an async lock (holding no thread) until the previous scan ends. Why: each scan reads on up to 8 threads, and on an iCloud vault mid-sync reads stall for minutes; the rereads asked for after each file change overlapped until the app reached macOS's 4096 threads per process and aborted. `find_block_references` takes its own lock for the same reason. `useTypedNotes` reads at once when a space opens and keeps the last read per workspace and set of types, so a space opened again paints its notes on the first frame while the reread runs behind it. Only rereads after a file change (the sidebar metadata version) wait 300 ms, so a burst of saves costs one read. Every read, preview or full, drops the notes in the template folders (`inFolders`, `lib/project-template.ts`), so every space and ⌘O's Library rows get the rule from one place. The folders, like the project template, are read once per vault and kept until the watcher reports a change to one of their files (`hooks/vault-templates.ts`); the list is filtered with the folders known so far and again when they land, and Add project's suggestions do the same, so neither waits on them. Why: in an iCloud vault the settings and templates are placeholders, and reading one took 1–4 s, and minutes mid-sync; read beside every list, keystroke and new project, they made Add project feel stuck. Add project's exact-name match (`findNoteNamed`) does wait for them, so it never takes a template.

## Not in this pass

- Covers for other video hosts (Vimeo, Bilibili), for papers, and the first page of a PDF book.
- A `+ New` button inside a space.
- Writing the matching notes into the space note as `[[links]]`.
