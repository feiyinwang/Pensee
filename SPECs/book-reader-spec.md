# Book Reader Spec

## Goal

Read a PDF or EPUB inside Writer with its book page open beside it. Each
highlight is a block on that page, in the same shape as the Apple Books import.
The agent can see the passage being read, and the right-click menu can ask it
to explain or define something.

## Behavior

### Bringing a book in

- Drop a `.pdf` or `.epub` on the window, or run **Import Book…** from the
  command palette.
- **Book page.** The book page is found the way an Apple Books import finds
  one (`bookPageNames` + `findWikiPage`), using the file's name. If none
  exists, a new page goes in the Book pages folder (`apple-books.folder`):
  ```
  Type: Book
  Book: <file name>
  tags: [Book]
  ```
  and nothing else: no H1 and no `## Highlights` heading, since headings are
  the writer's to add. An existing page gets
  `Type`, the `Book` tag and `Book` only where they are missing.
- **The book file** is copied beside its page (`import_book`, which never
  overwrites; a taken name gets ` 2`, ` 3`, …). `Book` holds its file name,
  relative to the page.
- The book opens in a tab with its page in a column to the right.
- **Reopening a book:**
  - **Open Book** in the palette, from a book page;
  - Cmd+click a highlight block;
  - a `[[Name.pdf]]` link.

### Highlights: the page is the record

- **Adding a highlight.** Select text in the book and choose **Highlight**,
  either in the pill that appears over the selection or in the right-click
  menu. This adds `- <text> ^bk-p<page>-<start>-<end>` (PDF) or
  `^bk-s<section>-<start>-<end>` (EPUB) to the page, in reading order among
  its other highlights wherever the writer has put them. The first one goes
  at the end of a `## Highlights` section the writer made, else at the end of
  the page. No heading is ever added.
  - The id is the location: the page/section plus character offsets into
    that page's text, so no separate store is needed.
  - The id is hidden like every block id, and the block works as a linked
    block.
- **Drawing highlights.** The book draws its highlights from the page's
  blocks, live. That leads to two rules:
  - Delete the block (or undo adding it) and the highlight goes.
  - Remove a highlight in the book (click it → **Remove highlight**) and its
    block, with anything nested under it, goes. This is one undoable change
    on the open page.
- **Editing a block's text** changes nothing in the book. The id still
  anchors the highlight.
- **Jumping back.** Putting the caret on a highlight block scrolls the open
  book to that highlight and flashes it. Cmd+click on the block opens the book
  first if it is closed.
- **Apple Books ids** (`^bk-<12 hex>`) do not match the location form, so they
  are ignored by the reader.

### Agent

- The agent's hidden context gains a `<book_passage>` block for each open
  book, holding:
  - the book and its page;
  - where the reader is (`page 42`, or the chapter for an EPUB);
  - the visible page's text (PDF) or the part of the chapter around the
    viewport (EPUB), capped at 12k characters.

  The book page is already an open tab, so the agent sees the user's notes
  too. When the book tab is in front, "this" means the passage.
- Right-click on a selection in the book shows:
  - **Highlight**
  - **Explain**, which explains the selection in this passage's context;
  - **Define**, offered when the selection is up to three words;
  - **Copy**.

  Explain and Define open the agent panel and send a short prompt quoting the
  selection. While an answer is still running, a notice says so and nothing
  is sent.

### Speed

- `pdfjs-dist` and `fflate` load only when a book tab mounts (a lazy chunk).
  Startup and the editor are untouched.
- **PDF:**
  - pages are fixed-size placeholders;
  - only pages near the viewport get a canvas and text layer, and pages that
    scroll far away drop their canvas;
  - parsing runs in pdf.js's worker.
- **EPUB:** chapters render once into `content-visibility: auto` sections,
  so the browser skips layout and paint off screen.
- **Highlights** use the CSS Custom Highlight API: no DOM is changed and no
  spans are added to the text.
- **Editor cost:** one regex on the caret's line, and only when the caret
  moves to another line.
- **Agent cost:** the passage text is read when a message is sent, not on
  scroll.

## Implementation

- `commands/books.rs`: `import_book(source, dest)` copies with `create_new`
  semantics.
- `lib/book-highlights.ts` (pure) handles:
  - ids;
  - parsing the page's highlights;
  - inserting in reading order and removing a block;
  - the new-page text and `Book` frontmatter.
- `lib/book-import.ts`: the import flow and `openBook`.
- `page-kinds/book.ts`: a `{kind:"book", path}` tab. `primaryPath` is null, so
  `activeFilePath` stays markdown-only.
- `components/book-reader/`: the lazy reader shell, the `pdf-source` and
  `epub-source` renderers, the highlight painter, and the selection pill.
- `stores/book-store.ts`:
  - the open readers (book → page path, current passage);
  - jump requests.
- `components/editor-area/book-jump.ts`: the caret/Cmd+click editor
  extension.
- `lib/agent-context.ts`: the `books` field and the `<book_passage>` block.

## Follow-ups

- Show `.pdf` / `.epub` in the sidebar (the index is markdown-only today).
- Highlight colours.
- EPUB title/author from the OPF metadata instead of the file name.
- A keyboard path to Highlight (a shortcut while a selection is in the book).
