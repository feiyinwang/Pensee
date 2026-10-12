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
- **Book or paper.** A new page for a PDF is retyped `Paper` when its first
  pages read like one, and a PDF nothing decides offers **Change to paper**
  (SPECs/add-to-library-spec.md).
- **Book page.** An existing page is always used before a new one is made.
  It is found the way an Apple Books import finds
  one (`bookPageNames` + `findWikiPage`), from the file's name without
  download-site tags (`(z-library.sk, 1lib.sk, z-lib.sk)`, `[Z-Library]`, a
  bare `z-lib.sk`; `cleanBookTitle`). It tries the full title, then the title
  without bracketed asides such as the author (`Skip the Line (James
  Altucher)` matches `Skip the line.md`), then the title before a subtitle.
  Opening a book whose page isn't known (a link) does the same before making
  one.
- **Author decides between same-named pages.** The book's author comes from
  the file: an EPUB's `dc:creator`s or a PDF's Author field (`book-meta.ts`,
  reading only those parts). When the file doesn't say, it comes from the
  download's file name (`Skip the Line (James Altucher James Altucher )` →
  `James Altucher`). A page with the book's name is used when its `Author`
  matches (`sameAuthor`: the same names in any order or punctuation, or a
  subset of them) or when either side has no author. A page by a different
  author is someone else's book, so the book gets its own page,
  `<Title> (<Author>)`.
- **Author property.** New pages get `Author`, and a matched page gets it
  when it has none. A different author already on a page is never
  overwritten. If none
  exists, a new page goes in the Book pages folder (`apple-books.folder`):
  ```
  Type: Book
  Author: <author, when known>
  Book: <file name>
  tags: [Book]
  ```
  and nothing else: no H1 and no `## Highlights` heading, since headings are
  the writer's to add. An existing page gets
  `Type`, the `Book` tag and `Book` only where they are missing.
- **The book file** is copied beside its page, unless the page already has
  its `Book` file there (the same book dropped again), which is then opened
  instead (`import_book`, which never
  overwrites; a taken name gets ` 2`, ` 3`, …). `Book` holds its file name,
  relative to the page.
- The book opens in a tab with its page in a column to the right.
- **Book card.** While the book isn't open, its page shows a card under the
  properties: the book's cover, title, author and PDF/EPUB, and
  **Open beside**. It hides while the book is open (`book-card.tsx`).
  - The cover is the book's own: the EPUB's cover image, or the PDF's first
    page drawn small (`book-cover.ts`), loaded lazily once per book per
    session. That is what Apple Books shows. The page's `Cover` is only a
    fallback while it loads or when the book has none: a saved Apple Books
    cache image can come out black.
- **Opening beside its page.** With the page already open, the book goes in
  the column right after it and comes into view. Otherwise the book opens and
  its page follows to its right (`openBook`).
- **Pinch.** Zooming into a book or its page shows the two side by side as one
  block, half each, with a hairline between them (`book-pair.ts`). Like the
  columns, the pair keeps clear of the tab row above and the footer stats
  below. Zooming
  into a book page whose book is closed opens the book first. Zooming out
  brings back every column.
- **Reopening a book:**
  - **Open Book** in the palette, from a book page;
  - Cmd+click a highlight block;
  - a `[[Name.pdf]]` link.

### Reading place

- Each book reopens where it was left (`lib/book-positions.ts`). The saved
  place is:
  - the section at the middle of the view (PDF page or EPUB chapter);
  - how far the top of the view sits from that section's top, in section
    heights.
- It is saved in the app's preferences by book file, 400ms after scrolling
  settles and when the tab closes.
- EPUB chapters off screen sit at a placeholder height until the browser lays
  them out, which can be frames after a jump. Restoring therefore places the
  book, lays out every chapter in or near the view at once (`layOutInView`),
  and places it again until nothing new lays out, so the place never depends
  on how fast the browser catches up.
- A highlight jump asked for on open (Cmd+click) wins over the saved place.
- An open book tab is part of the session: after a restart it opens again at
  its saved place. Restoring the session reads only the tabs' documents, never
  the book file itself.

### Selecting

- App.css's global no-select rule leaves out `.book-reader-pages`, and the
  reader sets `user-select: text` on them. "auto" would take the no-select
  of the frame around them.
- A highlight takes whole words: a selection that stops mid-word is widened
  to the word's edges (`toWordEdges`), as in Apple Books.

### Library and search

- Every book that opens in the reader (dropped, imported, from its page's
  card, a highlight or a link) is recorded in the workspace's library
  (`lib/book-library.ts`): book file, book page, title. It is kept in the
  app's `preferences.json` per workspace, never in the vault; the file index
  stays markdown-only.
- The command palette lists library books whose title or file name matches
  the search, between commands and pages, marked **Book**. Picking one opens
  it beside its page. A book whose file is gone is dropped from the library
  with a notice.

### Highlights: the page is the record

- **Adding a highlight.** Select text in the book and choose **Highlight**,
  in the pill that appears over it. This adds `- <text> ^bk-p<page>-<start>-<end>` (PDF) or
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
- Selecting text, or clicking or right-clicking a selection, shows one pill
  with **Highlight** and **Define**. Clicking a highlight shows **Remove
  highlight**. There is no second, right-click menu.
  - **Define** opens the agent panel and asks it to define a word or phrase
    of up to three words as used in this passage, or to explain what a
    longer selection means here.
  - **A single word** also gets its pronunciation: the agent is asked to
    start with the IPA, and the word is said aloud with the system voice
    (`lib/speak.ts`, Web Speech API). The voice's language comes from the
    word's script: English, Chinese, Japanese, Korean or Russian.
  - While an answer is still running, a notice says so and nothing is sent.

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
