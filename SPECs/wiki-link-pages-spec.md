# Pages from wiki links

## Ask

1. After typing `[[Name]]`, create a page called `Name` automatically, and make the link clickable.
2. Let the user collapse a selection into a page like that: the first line is the title, and the selection is replaced by a link to the new page.

## Behaviour

### Typing a link

- A page is created when the caret **leaves** a finished `[[...]]` link (or the editor loses focus with the caret inside it) and no page matches. Creating on every keystroke would leave `B.md`, `Bu.md`, `Bud.md` behind.
- "Matches" is the same lookup a click uses (`resolveWikiLink`): a unique file stem anywhere in the workspace, or a workspace-relative path for names containing `/`.
- A new page goes next to the note containing the link (workspace root when that note is outside the workspace). A name with `/` is workspace-relative, and missing folders are created.
- The new page starts with its name as a title: `# Name`.
- Nothing is created for embeds (`![[...]]`), fragment-only links (`[[#Heading]]`), links to non-markdown files (`[[photo.png]]`), or links inside code.
- Aliases and fragments are ignored for naming: `[[Budget#Rent|rent]]` creates `Budget.md`.

### Clicking a link

Links were already clickable when their page existed. Clicking one whose page does not exist now creates the page the same way and opens it, so a link is never dead. This also covers the moment after creation when the search index has not caught up with the new file yet.

### Move selection to new page

- **Cmd+Alt+N**, or right-click → *Move selection to new page* (shown only with a selection).
- The first non-blank selected line becomes the title, with markdown removed (heading/list/quote/task markers, emphasis, link syntax) and characters that are unsafe in file names replaced. The rest of the selection becomes the body: `# Title\n\nbody`.
- The page is created next to the current note. An existing page is never overwritten: `Title 2.md`, `Title 3.md`, … are used instead.
- The selection is replaced by `[[Title]]`. If the selected text changed while the file was being written, the page is still created but the text is left alone, and a notice says so.
- Undo restores the text; the new page file stays.

## Implementation

- `apps/desktop/src/lib/wiki-pages.ts`: naming, location, content, unique paths and `ensureWikiPage` (resolve, else create, once per path even under concurrent calls). File-system calls are injected; covered by `tests/wiki-pages.test.ts`.
- `apps/desktop/src/components/editor-area/wiki-pages-extension.ts`: the leave-the-link trigger, `moveSelectionToPage`, and its keymap.
- `wiki-link-extension.ts` click handler falls back to `openWikiPage` when a link is unresolved; `editor-body-menu.ts` / `editor-context-menu.ts` add the menu item.
