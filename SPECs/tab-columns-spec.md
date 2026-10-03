# Tab columns

## Ask

Show open tabs the way Andy Matuschak's working notes show pages: side by side in columns, each scrolling on its own. Unlike Andy's notes there is no cap on columns: they form a horizontal strip you scroll with the trackpad, each tab is its own island, and islands can be dragged left or right. This applies whenever more than one tab is open, not only when following a link. Keep Writer's own look.

## Behaviour

- One open tab fills the panel exactly as before.
- With two or more tabs, every tab is a column: the editor panel behind them steps back and each tab becomes its own glass island, 640px wide with an 8px gap, starting below the tab row and ordered like the tab bar. The strip scrolls horizontally (two-finger swipe, Shift+wheel); each island scrolls vertically on its own. Settings and New tab pages are columns too.
- The active tab's island gets a slightly stronger outline and a brighter title. Pressing anywhere in an island activates its tab. Footer stats, window title, sidebar highlight, find, Back/Forward and Cmd+W all act on the active column.
- Activating a tab that is partly off screen (tab bar click, link, keyboard, restore) scrolls its column fully into view, smoothly (instantly under reduced motion). Pressing into a partly visible column does not scroll it, so a text selection there is not pulled out from under the pointer.
- Clicking a link to a workspace page (`[[wiki link]]`, a relative markdown link, a link preview card's title) opens it in a new tab directly right of the current one and activates it. If a tab already shows that page, that tab is activated instead.
- Clicking a file in the sidebar or palette still opens it in the active tab, as before.
- Each island has a header: a grip, the tab title and a close button. The grip and close show on hover (close also on the active column). Close closes the tab; closing down to one tab returns to the full-width page.
- Drag a header left or right to move the column. It follows the pointer with no transition, the columns it passes slide aside, and the strip scrolls when the pointer nears its edge. On release the column eases into place on the spring. The tab bar order follows. With the grip focused, Left/Right move it one place.
- Pinch on the trackpad switches between one tab and all columns. Pinching out (zoom in) shows only the active tab, full width, as if it were the only one; the tab bar still switches tabs. Pinching in (zoom out) brings every column back, with the active one scrolled into view. One pinch makes one switch, after about 40px of travel. Pinches that a board or Mermaid canvas handles (it calls `preventDefault`) still zoom that canvas. The strip eases in from 4% larger or smaller (`--motion-base`), not under reduced motion. The choice lasts for the window's session and is not saved.
- Compact single-file windows keep navigating links in place.
- Motion: a new column fades and slides 24px in (`--motion-base`, `--ease-out`), started by the component setting `data-entering` for one frame. Not `@starting-style`: the app's WebKit applies that block as a plain rule, which left islands hidden. None of it under `prefers-reduced-motion`.

## Implementation

- Store (`editor-store.ts`): `openFileBeside(path)` inserts a file tab after the active one (or activates the tab already showing the file; a file that fails to load closes its tab again) and `moveTab(tabId, toIndex)` reorders. Tab order is the column order, so sessions need nothing new.
- Link entry point: `editorApi.openLinkedPage(path)` — `openFileBeside` in workspace windows, `navigateToFile` in compact ones. A heading anchor is only queued for a page about to mount; following an anchored link to a page already open just activates its tab.
- View (`tab-columns.tsx` + `.css`, rendered by `EditorArea`): one `section` per tab, in tab-creation order with visual position from CSS `order`, so reordering never moves a DOM node (that would reset the scroll position inside it). Without columns, inactive keep-alive tabs stay mounted but hidden, as before. Drag is imperative (transforms on the island elements, no React render per pointer move); the drop commits `moveTab` and a layout effect eases the leftover offset home.
- Page-kind views take `inColumn`: when true they stay visible while another tab is active. `EditorPane` also uses it for a shorter top inset; inside an island `--writer-editor-outer-width` is `100%` and the side padding 2rem.
- Pinch: WebKit delivers a trackpad pinch as a `wheel` event with `ctrlKey` set. `TabColumns` listens on the strip (non-passive), sums `deltaY` until a 250ms quiet gap ends the gesture, and holds `focusedOne` in local state; `isColumns` is `tabs.length > 1 && !focusedOne`, so focused mode reuses the single-tab layout and every page keeps its DOM node and scroll position.
- E2E: `e2e/specs/tab-columns.spec.js`. The driven window is hidden, so WebKit never advances the animation timeline; the spec switches transitions off and presses links and drags with synthetic events.

## Follow-ups

- Column width is fixed at 640px; a setting or per-island resize could come later.
- Following an anchored link to a page already open activates it without scrolling to the heading.
- No exit animation when a column closes.
- Pinch is the only way to switch between one tab and all columns; there is no keyboard shortcut or menu item for it yet.
- The tab bar itself cannot be dragged to reorder; only the islands can.
