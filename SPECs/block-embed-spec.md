# Linked blocks (block embeds)

## Goal

Show a block from one page (a paragraph, a list item, a heading, a picture) in another page, and let the user edit it right there. The edit changes the original page: the two places are one block. Opening a page that holds linked blocks, or typing anywhere, must not get slower.

## Storage

Obsidian's syntax, so the files stay portable markdown and Obsidian reads them the same way:

- The source block ends with ` ^id` (six base-36 characters): `Pack the tent ^k3x9q2`.
- Any page shows it with `![[Page#^id]]`. `Page` is the page's stem when it sits at the workspace root, otherwise its workspace-relative path (`notes/Trip`), which `resolveWikiLink` reads directly, so a stem two folders share still resolves. `![[#^id]]` means the same page.

What counts as the block (`findBlock` in `lib/block-refs.ts`):

- **A list item or a heading** is the one line carrying the id. The item's children are separate blocks.
- **A paragraph** (pictures included) is the id line plus the lines above it, up to a blank line, a heading, a fence, or a line that starts its own block.

Fences, tables, HTML blocks, column rows and rules can't be linked in v1, because a ` ^id` on their last line would change what they are. Obsidian puts the id on its own line under them, and that's the follow-up.

## Behaviour

- **Copy link to block** in the block handle menu gives the block an id (once; one undo removes it again) and copies `![[Page#^id]]`. A notice says so.
- Pasted or typed, `![[Page#^id]]` renders as the block itself in a small live editor. A thin accent rule on the left marks it, and it becomes an outline with the source page's name (click it to open that page) while hovered or focused.
- Typing in the embed edits the source page:
  - **The source page is shown in an editor:** the change is dispatched into that editor as a minimal change. It saves, undoes and updates the store exactly like typing there.
  - **Open but not shown:** written into the editor store, which saves it.
  - **Not open:** spliced into the cached file text and written with `write_file`, debounced 300 ms.
- Edits made anywhere else (the source tab, another embed, an external editor) show up in every embed of that block.
- An edit that would split the block is refused, so text never silently drops out of the embed. That includes a blank line, or a new list item under a list item.
- On the source page the ` ^id` is hidden, and shows faintly while the caret is on its line.
- If the page or block can't be found, the embed says so. If the id is deleted from the source while an embed is shown, the embed greys out and stops writing.
- Moving the caret onto `![[...]]` shows its source text, like every other embed.

## Backlinks

Linking goes both ways, as in RemNote: a referenced block knows where it's used.

- A block other pages show gets a small count at the end of its line: the number of places that show or link to it (`![[Page#^id]]` and `[[Page#^id]]` both count).
- Hovering the count lists those places in the shared hover card: each row is the page's name plus the text around the reference on that line (or its line number). Clicking a row opens that page.
- Counts are live. A reference pasted into an open page counts as soon as typing pauses, before it's saved.

Where the counts come from (`block-backlinks.ts`):

- **Pages on disk:** `find_block_references` (Rust, `commands/search.rs`) reads every indexed markdown file in parallel, off the UI thread. A file with no `#^` costs one substring scan.
- **Open pages:** scanned in memory from the store (`referencesInText`, the same rule as the Rust scan). Their disk copy is ignored, so nothing counts twice and unsaved references count.
- **When it runs:** a page with no ids starts nothing. A page with ids runs one disk scan when it opens. Another runs when a file changes outside the app, when the first index finishes, or when an open page closes (its saved text becomes the disk copy, and the app's own saves raise no watcher event). Store changes refresh the in-memory part only, debounced 300 ms.


- Embeds are found by a regex over CodeMirror's visible ranges only. Off-screen embeds cost nothing.
- Drawing an embed reads its page once: from the store if it's open, else one disk read shared by every embed of that page (bounded LRU of 64 pages).
- `BlockEmbedWidget.eq` compares page, id, host path and root, so typing elsewhere in the host page never rebuilds an embed or its editor.
- There's one store subscription and one file-watcher listener for all embeds, and each exists only while at least one embed is shown.
- A keystroke in an embed costs one scan of the source page's text to find its id, plus one minimal dispatch.

## Ownership

- `lib/block-refs.ts`: pure text rules (parse, find, replace, ids, link text), unit tested in `tests/block-refs.test.ts`.
- `components/editor-area/linked-block-sync.ts`: the single read/write owner for a linked page, plus the live-editor registry and the `blockEmbedHost` facet.
- `components/editor-area/block-embed.ts`: the widget, the id hiding, and the menu action.
- `components/editor-area/block-backlinks.ts`: backlink counts and the list (state field, watcher, badge widget).
- Nested editors (embeds, hover previews) have no `blockEmbedHost`, so a `![[Page#^id]]` inside them renders as a plain link. An embed can never contain itself.

## Follow-ups

- Ids for fences, tables and other opaque blocks (id on its own line beneath).
- Embedding a whole heading section (`![[Page#Heading]]`).
- Jump to the exact line of a reference from the backlinks list (today it opens the page).
- A page-level "Linked references" section listing every block of this page used elsewhere.
- Typing `((` to search all blocks and insert a reference, RemNote-style.
- Keyboard path into an embed (arrow into it from the line above).
- A `^` completion in `[[Page#^` that lists the page's blocks.
