# Pages from wiki links

## Ask

1. After typing `[[Name]]`, create a page called `Name` automatically, and make the link clickable.
2. Let the user collapse a selection into a page like that: the first line is the title, and the selection is replaced by a link to the new page.
3. Moving a selection into a page that already exists (for example text from a daily note into `主场.md`) adds it to that page.

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

### Move selection to a page

- **Cmd+Alt+N**, or right-click → *Move selection to page…* (shown only with a selection), opens the command palette as a page picker, pre-filled with the name the selection's first line suggests (markdown removed, file-unsafe characters replaced; any script is kept, full-width punctuation such as `：` included).
- The shortcut is matched on the physical key (`event.code === "KeyN"`), not through `keymap`: on a Mac, Option+N is a dead key, so `event.key` is `"Dead"` and a `Mod-Alt-n` keymap binding never fires. This also works under any input source, Chinese Pinyin included.
- The picker lists existing markdown pages matching what is typed (never the page the text is on). A page whose name matches exactly comes first under **Add to page** and is preselected; otherwise **New page: <name>** is first. Enter picks, Esc cancels and leaves the text alone.
- **Existing page**: the text is added to the **end** of it as a new block. If that page is open in another tab, the tab's current text (including unsaved edits) is the base, and the tab refreshes with the result.
- **New page**: created next to the current note, starting with `# <name>`. If a page of that name turns out to exist after all, the text is added to it instead.
- **Which lines move**: into the page the first line names, the first line is the page's title already, so only the lines after it move. Into any other page (typing `主场` for text from a daily note, say), the whole selection moves, first line included.
- The selection is replaced by `[[Page name]]` and a notice confirms where it went. If the selected text changed while the file was being written, the page still gets the text but the original is left in place, and a notice says so. Undo restores the text; the page keeps it.

## Implementation

- `apps/desktop/src/lib/wiki-pages.ts`: naming, location, content, `findWikiPage`, `appendPageBody`, `safePageName`, `textMovedToPage` and `ensureWikiPage` (resolve, else create, once per path even under concurrent calls). File-system calls are injected; covered by `tests/wiki-pages.test.ts`.
- `apps/desktop/src/components/editor-area/wiki-pages-extension.ts`: the leave-the-link trigger, and the move: `moveSelectionToPage` remembers the selection and opens the picker, `completeMoveToPage` / `cancelMoveToPage` finish it.
- `apps/desktop/src/components/command-palette/index.tsx`: the `move-to-page` intent (the picker).
- `wiki-link-extension.ts` click handler falls back to `openWikiPage` when a link is unresolved; `editor-body-menu.ts` / `editor-context-menu.ts` add the menu item.
