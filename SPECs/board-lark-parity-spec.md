# Board: Lark parity in portable markdown

## Goal

`/board` should match what Lark Board offers ([help center](https://www.larksuite.com/hc/en-US/category/7229629290264969221-board)) while every board still shows up in any other markdown app (GitHub, Obsidian, VS Code, Typora). Boards must open close to instantly, because the main use is showing them to people.

## Storage: `.board.svg`

A board is an SVG file in the note's `{stem}-assets/` folder. The markdown references it as an ordinary image:

```md
![Board](note-assets/20261003-101500-ab12.board.svg)
```

- **Other apps** see a normal image: the SVG is the rendered board.
- **Writer** sees the same image. A **board enhancer** on the image widget adds Edit/Open, which loads the scene from the file and opens the full-screen editor.
- **The scene** is the existing JSON Lines format (header line plus one element per line), stored as the text of `<metadata id="writer-board">`. Moving one shape is still a one-line git diff.
- **Colours** are baked into the file's own `<style>`, with light values plus a `prefers-color-scheme: dark` override, so the file renders correctly with no Writer CSS around it.
- **Pictures** stay as files in the assets folder. The scene keeps their path relative to the SVG. The rendered layer embeds them as `data:` URLs, because an SVG shown through `<img>` cannot load outside resources. This makes the SVG bigger, but the markdown file stays small.
- **Load speed:** the in-note preview is just `<img src=…board.svg>`. No JavaScript parses or renders anything until you open the editor.
- **Migration:** a legacy ` ```board ` fence still previews and opens. Its first edit writes a `.board.svg` and swaps the fence for the image line, in one undoable transaction.

## Selection toolbar

Selecting anything on a board shows a floating toolbar centred under the selection, clear of the resize handles. It flips above the selection when it would run into the bottom controls, and it hides during any drag, resize, rotate, marquee or pan. It replaces the old fixed style panel in the top-right corner.

| Control | Shows for | Sets |
| --- | --- | --- |
| Shape | shapes | the shape kind (10 kinds) |
| Fill / Note colour | shapes / sticky notes | fill token / paper colour |
| Border (Line for connectors) | shapes, connectors | colour, width (thin/medium/thick), style (solid/dashed/dotted) |
| Connector | connectors | route (straight/elbow/curved), start and end arrowheads |
| Text colour, Text size, Align | text, shapes with a label | colour token, size (12–48), left/centre/right |
| More | everything | opacity, bring forward, send backward, duplicate, delete |

A control appears when at least one selected element can take it, and shows the first such element's value. Applying it changes every selected element that can take it. The rules live in `board-selection.ts`, and shape labels gained an optional colour (`lb.c`, with ink as the omitted default).

**Not on the toolbar:** lock. The format stores `lk`, but the canvas doesn't enforce it yet, and a control that does nothing would be misleading.

The toolbar is React + Arc (Popover, Tooltip, SegmentedControl, `motion` springs). It is lazy-loaded on the first board open, and Arc's tokens are injected scoped (see `arc-tokens.ts`, `docs/arc.md`).

## Performance

Measured in the real app (WKWebView, 120Hz display, frame-to-frame time with one input event per frame). The JavaScript was never the problem (about 1ms per pointer event); painting was.

| | Before | After |
| --- | --- | --- |
| Pan | 47ms avg, 110ms max | 8ms median, 10ms max |
| Drag a shape | 17ms avg, 71ms max | 8ms avg |
| Pinch/⌘-scroll zoom | 23ms median, 41ms p90 | 8ms median, 10ms p90 |
| 300 elements, drag / pan | — | 8ms / 10ms avg |
| Open a board | — | 6–24ms to first content |

What made the difference, in order of impact. Several follow Excalidraw's renderer (`renderer/staticScene.ts`, `renderElement.ts`, `throttleRAF`, `shouldCacheIgnoreZoom`):

1. **Grid off the SVG.** The dot grid was an SVG `<pattern>`. WebKit re-rasterised the full-screen pattern whenever its transform was touched, which happened every pan frame: about 45ms a frame on its own. It is now a CSS background on a composited layer (`.wr-board-grid-layer`), moved with `translate3d` snapped to the spacing, and re-tiled only when zoom changes. Like Excalidraw, the grid hides below 10px spacing.
2. **Zoom gestures stretch, then commit.** Mid-gesture, the svg and the grid get a compositor-only CSS transform from the last painted viewport to the live one, and the real repaint happens 160ms after the last step (`zoomGesture`; Excalidraw does the same with `shouldCacheIgnoreZoom` and 300ms). The preview and the committed result match to 0.00px.
3. **No saves on viewport moves.** Pan and zoom used to end in a full file save: re-rendering the board SVG, inlining pictures, writing, and reloading the note's preview image behind the board. A viewport change is not an edit. It is written with the next change or on close. Debounced saves no longer reload the preview; only closing does.
4. **One update per frame.** Pointer moves are coalesced into a single `requestAnimationFrame` (Excalidraw's `throttleRAF`). Pen strokes still keep every point through `getCoalescedEvents`. A pending move is flushed before pointer-up.
5. **Moving does not re-render.** For elements whose drawing does not depend on their position, the reconciler stamps without x/y and only rewrites the group's `transform` on a move. Linkers and mind topics are the exception, because their geometry depends on others.
6. **No forced layout per event.** The stage rect is cached (refreshed on resize and pointer-down) instead of `getBoundingClientRect` on every pointer event. The zoom label and selection toolbar are only touched when their content changes. The toolbar is placed from a React layout effect once its size is known, rather than waiting for a `ResizeObserver`.

Second pass ("instant no matter what I move"), measured A/B against the previous build on a mixed board (sections, sticky notes, a flowchart, a 13-topic mind map, a large picture), interleaved runs:

| | Before | After |
| --- | --- | --- |
| Input → drawing changes, every kind of move | 8–10ms (one frame) | ~1ms (same frame) |
| Frame time while moving | 8–11ms | 8–10ms |
| Click to select, to next frame | 16ms | 10ms median |

7. **Same-frame moves.** The first pointer move in a frame is applied synchronously, and later moves in that frame fold into one when it turns. Deferring every move to `requestAnimationFrame` had added a full frame of lag. (Trackpad scrolling had the same treatment until 13 made it a compositor move.)
8. **Gestures touch only what can change.** At drag, resize or rotate start, the set that can change is fixed: the moving elements plus connectors bound to them. Each frame re-renders only that set (`SceneRenderer.renderSome`), with no stamp pass over the rest of the board. Mind topics are stamped relative to their parent, so dragging a whole map is transforms only. Selecting skips the element pass entirely.
9. **The toolbar stays out of the frame.** While the selection is being moved, the bar is hidden by a class, with no React work. Its size is cached from React commits and resize entries, never read on the per-frame path, where it forced a full layout. It uses a tighter shadow than Arc's `--shadow-floating`, whose 55px blur is painted in software each time the bar reappears.
10. **Culled boards re-cull while panning.** Above 300 elements, only what is near the screen is drawn. (Superseded by 13: the culled set now follows the overscanned svg.)

Third pass ("is it still snappy with loads of everything?"), on a stress board of 2,640 elements: 64 tiles, each a section with six sticky notes, a five-step flowchart with arrows, a 17-topic mind map, three pen strokes, two text boxes, three labelled shapes, and a picture in every fourth tile. Interleaved A/B in WKWebView; "far" is 10% zoom with most of the board on screen.

| | Before | After |
| --- | --- | --- |
| Zoom commit (repaint after a pinch rests), mid zoom | 14–44ms | 15–28ms |
| Zoom commit, far | 94–154ms | 54–71ms |
| JavaScript per zoom step, far | 62–71ms | 9–19ms |
| Pan frame, far | 106ms median, every frame slow | 8ms median (one slow frame per 192px of travel) |
| Pinch frame, far, p90 | 9–474ms | 9–10ms |

A normal board (36 elements) is unchanged: 8ms frames, 9–29ms commits.

11. **Lookups, not scans, while rendering.** Each render pass builds an id map and a children map once (`sceneLookup` in `board-mind.ts`) and hands it to stamping and mind-topic drawing. Before, every topic searched `scene.els` for its parent, its first-level ancestor and its siblings, and every connector for both ends: 145ms of stamping across four commits on the stress board, now 10ms.
12. **No labels when they are unreadable, on big boards.** Below 30% zoom (`FAR_ZOOM`) on boards of 300+ elements (`CULL_THRESHOLD`), text inside shapes, sticky notes, topics and connectors is hidden by one class on the host (`.is-far`), toggled at commit. Small boards keep their labels: there the saving is small and the labels popping out read as a glitch. At that zoom it is 3-6px tall, and it was two thirds of each frame's paint. Free text and section titles stay.
13. **Pans move the painted svg, like zooms.** The svg overscans the stage by 256px on every side (`OVERSCAN`; its transform origin stays the stage's corner). A pan only translates it on the compositor and repaints once it has used three quarters of the margin; culled boards draw exactly the overscanned area around where the svg was last painted. With everything on screen, a repaint per pan frame measured 60-87ms, and a compositor move 8ms. 512px halved the number of pan repaints but doubled each one and the zoom commits, so 256px it is. The stage rect is now measured on the host, since the svg is larger and moves. The stage clips with `overflow: clip`, not `hidden`: an overflow:hidden box with overflowing content is a scroll container, and WebKit latched trackpad and wheel gestures to it, so the board's handler (now on the host) never saw them.
14. **The svg is always its own layer.** It used to be promoted for each zoom gesture and demoted at commit, paying a full raster both times.
15. **The grid thins instead of vanishing.** It used to switch off below 10px spacing. Now spacing steps by 4× (`gridSpec` in `board-grid.ts`): between 20px and 10px the fine dots fade out over a second background layer of every fourth dot, which then carries on as the fine level. Outside that band it is one gradient layer, as before. A `<canvas>` grid was tried and measured slower in WebKit (28-33ms a zoom commit against 16-24ms), mostly from reallocating the canvas.
16. **Small boards sharpen sooner.** A zoom gesture commits after 100ms of rest under 300 elements, 160ms above, where a commit mid-gesture would be a visible stall.

Not adopted: Excalidraw's per-element bitmap cache. It belongs to a `<canvas>` renderer, and with the above the SVG renderer already holds 120fps at 300 elements.

## Mind map quick dots

A selected topic shows blue quick dots (`mindDots`, `growMind` in `board-mind.ts`). The root has one on each side and each adds a first-level branch pinned (`sd`) to that side. Any other topic has one on its outer side (a child) and one above and below (a parallel topic before or after it; a parallel first-level topic is pinned to the same side). There is no dot on the side the branch arrives from. A click grows the map, re-runs the layout and starts typing in the new topic, the same as Tab and Enter. A drag from any dot draws an arrow to whatever it is dropped on, like a shape's dots.

## Page links in cards

Any card text (sticky, shape label, text, mind topic, connector label) can hold the editor's `[[Page]]`, `[[Page#Heading]]` or `[[Page|shown text]]` links. Stored as typed, so the `.board.svg` source stays plain markdown.

- **Render**: `parseInline` (`board-render.ts`) turns a link into a run with `ln` (the raw inner text) and shows the alias or page name. It wins over emphasis that starts at or after it, so `[[my_page]]` keeps its underscore; emphasis around it still applies. The tspan carries `data-wiki` plus `fill`/`text-decoration` attributes (not CSS), so the saved file shows links outside Writer too.
- **Open**: a click on link text (`linkAt` in `board-canvas.ts`) waits `LINK_CLICK_DELAY_MS` for a second click, so a double-click still edits the text; a drag still moves the card. Then `onOpenLink` → the overlay closes (writing the board back) and `followWikiLink` (`wiki-pages-extension.ts`, shared with the editor's click handler) opens the page, creating it when missing.
- **Type**: `[[` in the card's text field lists matching pages (`board-link-complete.ts`, same `fuzzySearch` and `canonicalWikiTarget` as the editor). Arrows move, Enter/Tab insert `[[Target]]` (eating an auto-typed `]]`), Esc closes the list without leaving the field.

Not built: a hover preview of the linked page, `((` block references, a backlinks count for boards.

## Edit in the note

Hovering a board's preview shows **Present**, **Edit here** and **Open board**. **Edit here** mounts the same editor (`openBoardFullscreen` with `inline`) inside the preview frame instead of over the window: the picture is hidden while a `.wr-board-inline` child exists (CSS `:has`), the frame grows to `clamp(420px, 70vh, 760px)`, and Esc or Close puts the picture back. Saving is the full-screen path unchanged (debounced commits, a final write on close, then the preview refreshes).

- **Events.** The board now sits inside CodeMirror's `contentDOM`. Its root carries `data-owns-events`, which the image widget's `ignoreEvent` honours, so the note's keymap, mouse selection and drop handling never see the board's input. Events still bubble to the document, so app shortcuts and Arc popovers' outside-click handling keep working. The overlay's ⌘F/⌘S/⌘Z handling applies only to keys typed into the board.
- **Lifetime.** One board is open at a time. Opening another (here or full screen) closes the in-place one first, which saves it. An image enhancer can now return a cleanup that the widget's `destroy` runs, so when CodeMirror drops the preview (scrolled out of the viewport, edited away, note closed) the board is written back and torn down rather than orphaned.
- **Position.** The canvas caches its screen rect; a capture-phase `scroll` listener on `window` drops the cache, because an in-place board moves when the note scrolls.
- Wheel and trackpad gestures over the board pan and zoom it, not the note (that is the conflict the static card avoids). It is accepted here because editing in place is an explicit mode the user enters and leaves.

## Phases

1. **Portable storage** (this change): the file format, the enhancer on image previews, `/board` creating a file, and fence migration.
2. **Core editing polish** (the user's priority): sticky notes, shapes with text inside, fill / border colour / width / dash, paste pictures. Done: the selection toolbar; sticky text centred and fitted (22→11px); labels centred using a CSS-matching baseline (`baselineIn`), so drawn and edited text sit on the same pixel; an "Add text" hint; typing on a single selected shape, note or text starts editing (tool shortcuts still work with nothing selected); and shapes are hit anywhere inside, not only on the border.
3. **Flowcharts (done):** quick connect (side dots: click adds a blank copy of the shape plus a bound elbow arrow and selects it; drag draws a connector from that side), connector labels (`lb` on lines, drawn at the midpoint on a knock-out, edited like any text), elbow routing between facing side midpoints (`sideAnchor`/`orthogonalRoute`), connector hits tested against the routed path, and Mermaid flowchart import (`board-mermaid.ts`: parser for nodes, shapes, labelled/dashed/chained/grouped links; longest-path ranks, one barycentre sweep, back edges curved). Two ways in: **Convert to board** on a Mermaid block, and pasting Mermaid text onto a board. The rotate handle moved to the bottom-left corner (Lark) to free the top dot.
4. **Mind maps (done):** `MindEl` topics linked by `pa`, sibling order = scene order. `board-mind.ts` lays the tree out Lark-style (root keeps its centre; first-level topics balanced across both sides by subtree height, pinned once placed with `sd`; subtrees stacked and centred on their parent) and writes positions into the elements so the file renders anywhere. Branches are S-curves in the first-level topic's colour (`c`, palette by default; the toolbar's Branch colour recolours a branch). Keys: Tab child, Enter sibling, both also while typing (commit and continue); Delete takes the branch; dragging any topic moves the map; topics have no resize/rotate handles. Mermaid `mindmap` imports through the same registry. Fixed along the way: the overlay's capture-phase Escape handler starved everything inside the board, so Escape now commits text, clears selection, then closes.
5. **Arc board chrome (done):** the tools are Arc Pro's Dock at the bottom centre (`board-dock.tsx`; items as data in `board-dock-items.ts`), lazy-loaded with the selection toolbar. The plain rail stays until the Dock mounts and remains if it fails to load (logged). A Dock tray may be no wider than the bar allows; `trayFits` encodes Arc's geometry and a test enforces it, which is why the shapes tray holds eight shapes (pentagon and cross live in the toolbar's Shape menu). Also: the pen (`DrawEl`: RDP-simplified points relative to the stroke's box, smooth quadratic path, scaled on resize with a non-scaling stroke).
6. **Present mode (done):** `board-present.ts` orders sections into slides (rows by top edge within half a slide height, then left to right; no sections = one slide of everything) and computes the camera (`fitView`; `lerpView` moves zoom geometrically and the centre linearly, so it reads as one glide). The canvas springs between slides with `motion`'s `animate` (0.6s, bounce 0.12; instant under reduced motion), masks everything outside the slide with an even-odd path whose hole lerps with the camera, hides all chrome, and takes over keys and clicks. Entry: the Present button in the top bar, or **Present** on the note's board preview, which opens the board straight into present mode and closes it on exit. The saved viewport is restored before any close, so presenting never rewrites the file.
7. **Find & replace (done):** `board-search.ts` (literal, case-insensitive, over every text-bearing element including section names, results in reading order). The overlay still keeps ⌘F from the note behind it but now routes it to the canvas's `find()`. Replace all is one undo step; touched mind maps re-layout.
8. **Export (done):** Export → PNG (the board SVG with its dark-mode block dropped, drawn at 2× on white in a canvas) or SVG (the same self-contained text as `.board.svg`), through the native save dialog and a `write_export_file` command (base64). Scope is the selection (plus a section's contents and connectors with both ends included) or the whole board. Verified in WKWebView up to the dialog, which the e2e harness cannot drive (Tauri's `invoke` is non-writable, so it cannot be stubbed).
9. **Templates, batch edit, swimlanes (done; templates removed 2026-10-04 at the user's request — the picker and `board-templates.ts` are gone, new boards open blank):** `board-templates.ts` builds Flowchart and Mind map through the Mermaid importer (one layout path), plus Kanban, Retrospective, SWOT, Swimlanes (a section of lane bands with header cells, steps and bound arrows — no new element type) and Slides (three 16:9 sections). An empty board opens the picker (thumbnails via `renderStaticBoard`); the top bar's Templates adds one at the view centre. Batch edit is More → Select all like this (every element of the selected types), then the toolbar applies to all.
10. **Not built:** PlantUML (needs a Java/server renderer, which is against local-first), PDF export, an icon library, importing other tools' formats (Visio, draw.io), comments, translate, mobile.

## Non-goals

- Collaborative editing.
- Embedding the scene in the markdown file itself.
