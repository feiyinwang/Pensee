# Stacked pages

## Ask

Follow links the way Andy Matuschak's working notes do: opening a link puts the page in a new column beside the one you came from, so the trail of pages stays readable side by side, each column scrolling on its own. Unlike Andy's notes there is no cap on columns: they form a horizontal strip you scroll with the trackpad, each page is its own island, and islands can be dragged left or right to rearrange them. Keep Writer's own look.

## Behaviour

- A file tab shows one page, full width, exactly as before, until a link is followed.
- Clicking a link to a workspace page (`[[wiki link]]`, a relative markdown link, or the title of a link preview card) opens that page as a column directly right of the page the link is in, and focuses it. Columns already to the right shift over; nothing is closed.
- Following a link to a page already showing in the tab focuses that column instead of opening a second copy.
- With two or more pages the editor panel behind them steps back and each page becomes its own glass island, 640px wide with an 8px gap, starting below the tab row. The strip scrolls horizontally (two-finger swipe, Shift+wheel); each island scrolls vertically on its own.
- The focused column gets a slightly stronger outline and its title brightens. Pressing anywhere in a column focuses it. The footer stats, window title, sidebar highlight and find all follow the focused column.
- A newly focused column that is partly off screen scrolls fully into view (smoothly, instantly under reduced motion). Pressing into a partly visible column does not scroll it, so text selection there is not pulled out from under the pointer.
- Each island has a header: a grip, the page title and a close button. The grip and close button show on hover (close also on the focused column).
- Drag a header left or right to move the island. It follows the pointer with no transition, the islands it passes slide aside, and the strip scrolls when the pointer nears its edge. On release the island eases into its slot on the spring. With the grip focused, Left/Right arrow keys move it one place.
- Close removes the column and focuses its left neighbour; closing down to one page returns to the single full-width page.
- Clicking a file in the sidebar (or the palette) navigates the tab as before, replacing the whole stack; Back brings the stack back. Opening a sidebar file that is already one of the columns focuses it instead.
- Column changes (open, focus, move, close) are not history entries.
- The stack is saved with the session and restored on relaunch. Renames and deletes are applied to every column.
- Compact single-file windows keep navigating in place; there is no room for columns.
- Motion: a new island fades and slides 24px in (`--motion-base`, `--ease-out`), started by the component setting `data-entering` for one frame — not `@starting-style`, which the app's WebKit applies as a plain rule, leaving islands hidden. None of it under `prefers-reduced-motion`.

## Implementation

- Model: `FileLocation` (`page-kinds/file.ts`) gains `stack?: string[]` — every page left to right, always containing the focused `path`, present only with two or more pages. `fileLocationFrom` collapses a one-page stack; `paths()` returns the stack, so session restore, file pruning, rename and delete all cover every column through the existing page-kind registry.
- Store (`editor-store.ts`): `openStackedPage(from, to)`, `focusStackedPage`, `closeStackedPage`, `moveStackedPage`, all through `replaceFileTabLocation`, which swaps the tab's location without touching back/forward and prunes files no tab references any more. A page that fails to load is dropped from the stack again.
- Link entry point: `editorApi.openLinkedPage(fromPath, toPath)` — columns in workspace windows, `navigateToFile` in compact ones. A heading anchor is only queued for a page that is about to mount; following an anchored link to a page already in the stack just focuses it.
- View (`stacked-pages.tsx` + `.css`): the file page kind's view. Each page renders in a slot (`lib/stacked-page-slots.ts`): slots are reused when a page is swapped for another (navigating a single page, back/forward reshaping a stack) so the CodeMirror view survives, and they never move in the DOM — visual order comes from CSS `order`, because moving a node resets the scroll position inside it. Drag is imperative (transforms on the island elements, no React renders per pointer move); the drop commits `moveStackedPage` and a layout effect eases the leftover offset home.
- `EditorPane` takes `inStack`: always visible (the strip hides with its tab) and a shorter top inset, since the island already starts below the tab row. Inside an island `--writer-editor-outer-width` is `100%` and the side padding is 2rem.

## Follow-ups

- Cmd+W closes the whole tab even with several columns; closing just the focused column from the keyboard needs a binding.
- Column width is fixed at 640px; a setting or per-island resize could come later.
- Following an anchored link to a page already in the stack focuses it without scrolling to the heading.
- No exit animation when a column closes.
