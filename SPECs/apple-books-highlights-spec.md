# Apple Books Highlights Spec

## Goal

Bring the writer's Apple Books highlights and notes into the workspace on their
own, one page per book, so reading notes live beside everything else as plain
markdown.

## Behavior

- Off by default. **Settings → Apple Books → Import Highlights**
  (`apple-books.sync`, workspace scope, so it applies to one vault, not every
  workspace). **New Book Pages Folder** (`apple-books.folder`) picks where new
  pages go: blank is the workspace root, and the folder rules are the daily-note
  folder's (`resolveDailyNoteFile`): a folder outside the workspace is refused
  with a notice, never rewritten.
- While on, a sync runs when the workspace's file index is built and every 10
  minutes after. **Import Apple Books Highlights** in the command palette runs one
  any time, setting on or off, and always reports the result.
- Per book with at least one highlight:
  - **Finding the page.** The book's full title (made file-safe with
    `safePageName`), then the title before any subtitle (`Atomic Habits: An Easy…`
    → `Atomic Habits`), each looked up the way a `[[name]]` click finds a page
    (`findWikiPage`: a unique case-insensitive stem match anywhere in the
    workspace, then the would-be path in the folder).
  - **Existing page.** `Book` is added to its frontmatter `tags` (a missing key is
    appended as a line so the rest stays byte-for-byte; an existing list or
    Obsidian space/comma string gets `Book` added once; unreadable YAML is left
    untagged and logged). New highlights go at the end of its `## Highlights`
    section, or in a new one at the end of the page.
  - **No page.** A new page named after the short title, in the folder:
    frontmatter `tags: [Book]` and `author`, an H1 with the name, and
    `## Highlights`.
- A highlight is a bullet, its note a child bullet:
  `- highlight text ^bk-<12 hex of the Apple Books UUID>` /
  `    - note`. Paragraphs in a highlight are joined into one line; a leading
  heading/quote/list marker is escaped. The ` ^id` is an Obsidian block id, which
  Writer hides and which makes each highlight linkable as a linked block.
- **Append-only.** A highlight whose id is anywhere on the page is never added
  again. Edits to imported highlights, highlights moved or deleted by the writer,
  and everything else on the page stay as they are. Highlights deleted in Apple
  Books stay on the page.
- Open pages are edited in place (one undoable change in the live editor, then the
  normal save); closed pages are read and written through `write_file`.
- Automatic syncs are quiet unless they add something; a failure (for example
  macOS denying access to Apple Books' data) shows once per session until a sync
  succeeds. One book failing does not stop the others.

## Implementation

- `commands/apple_books.rs` — `read_apple_books_highlights`: finds
  `AEAnnotation*.sqlite` and `BKLibrary*.sqlite` under
  `~/Library/Containers/com.apple.iBooksX/Data/Documents`, copies each with its
  `-wal` to a temp dir (Books keeps them open in WAL mode; nothing touches its
  files), and returns non-deleted, text-bearing annotations grouped by book in
  location order. Books no longer in the library are skipped. macOS only
  (`rusqlite` linked against the system SQLite); elsewhere it errors.
- `lib/apple-books.ts` — pure naming, markdown, tagging, merge and the injected
  `syncAppleBooks` loop.
- `linked-block-sync.ts` `editPage` — the whole-page write path for open
  (live view / store, frontmatter kept separate) and closed pages.
- `hooks/use-apple-books-sync.ts` — the schedule, the index wait (an unbuilt
  index would miss the existing page and make a duplicate), single-flight, and
  notices.

## Follow-ups

- A note edited in Apple Books after import is not updated on the page.
- Chapter headings within a book's highlights.
- Watch the Books database instead of polling.
