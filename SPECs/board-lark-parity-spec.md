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

Not adopted: Excalidraw's per-element bitmap cache. It belongs to a `<canvas>` renderer, and with the above the SVG renderer already holds 120fps at 300 elements.

## Phases

1. **Portable storage** (this change): the file format, the enhancer on image previews, `/board` creating a file, and fence migration.
2. **Core editing polish** (the user's priority): sticky notes, shapes with text inside, fill / border colour / width / dash, paste pictures. Done: the selection toolbar; sticky text centred and fitted (22→11px); labels centred using a CSS-matching baseline (`baselineIn`), so drawn and edited text sit on the same pixel; an "Add text" hint; typing on a single selected shape, note or text starts editing (tool shortcuts still work with nothing selected); and shapes are hit anywhere inside, not only on the border.
3. **Flowcharts (done):** quick connect (side dots: click adds a blank copy of the shape plus a bound elbow arrow and selects it; drag draws a connector from that side), connector labels (`lb` on lines, drawn at the midpoint on a knock-out, edited like any text), elbow routing between facing side midpoints (`sideAnchor`/`orthogonalRoute`), connector hits tested against the routed path, and Mermaid flowchart import (`board-mermaid.ts`: parser for nodes, shapes, labelled/dashed/chained/grouped links; longest-path ranks, one barycentre sweep, back edges curved). Two ways in: **Convert to board** on a Mermaid block, and pasting Mermaid text onto a board. The rotate handle moved to the bottom-left corner (Lark) to free the top dot.
4. **Mind maps (done):** `MindEl` topics linked by `pa`, sibling order = scene order. `board-mind.ts` lays the tree out Lark-style (root keeps its centre; first-level topics balanced across both sides by subtree height, pinned once placed with `sd`; subtrees stacked and centred on their parent) and writes positions into the elements so the file renders anywhere. Branches are S-curves in the first-level topic's colour (`c`, palette by default; the toolbar's Branch colour recolours a branch). Keys: Tab child, Enter sibling, both also while typing (commit and continue); Delete takes the branch; dragging any topic moves the map; topics have no resize/rotate handles. Mermaid `mindmap` imports through the same registry. Fixed along the way: the overlay's capture-phase Escape handler starved everything inside the board, so Escape now commits text, clears selection, then closes.
5. **Arc board chrome (done):** the tools are Arc Pro's Dock at the bottom centre (`board-dock.tsx`; items as data in `board-dock-items.ts`), lazy-loaded with the selection toolbar. The plain rail stays until the Dock mounts and remains if it fails to load (logged). A Dock tray may be no wider than the bar allows; `trayFits` encodes Arc's geometry and a test enforces it, which is why the shapes tray holds eight shapes (pentagon and cross live in the toolbar's Shape menu). Also: the pen (`DrawEl`: RDP-simplified points relative to the stroke's box, smooth quadratic path, scaled on resize with a non-scaling stroke).
6. **Present mode (done):** `board-present.ts` orders sections into slides (rows by top edge within half a slide height, then left to right; no sections = one slide of everything) and computes the camera (`fitView`; `lerpView` moves zoom geometrically and the centre linearly, so it reads as one glide). The canvas springs between slides with `motion`'s `animate` (0.6s, bounce 0.12; instant under reduced motion), masks everything outside the slide with an even-odd path whose hole lerps with the camera, hides all chrome, and takes over keys and clicks. Entry: the Present button in the top bar, or **Present** on the note's board preview, which opens the board straight into present mode and closes it on exit. The saved viewport is restored before any close, so presenting never rewrites the file.
7. **Find & replace (done):** `board-search.ts` (literal, case-insensitive, over every text-bearing element including section names, results in reading order). The overlay still keeps ⌘F from the note behind it but now routes it to the canvas's `find()`. Replace all is one undo step; touched mind maps re-layout.
8. **Export (done):** Export → PNG (the board SVG with its dark-mode block dropped, drawn at 2× on white in a canvas) or SVG (the same self-contained text as `.board.svg`), through the native save dialog and a `write_export_file` command (base64). Scope is the selection (plus a section's contents and connectors with both ends included) or the whole board. Verified in WKWebView up to the dialog, which the e2e harness cannot drive (Tauri's `invoke` is non-writable, so it cannot be stubbed).
9. **Templates, batch edit, swimlanes (done):** `board-templates.ts` builds Flowchart and Mind map through the Mermaid importer (one layout path), plus Kanban, Retrospective, SWOT, Swimlanes (a section of lane bands with header cells, steps and bound arrows — no new element type) and Slides (three 16:9 sections). An empty board opens the picker (thumbnails via `renderStaticBoard`); the top bar's Templates adds one at the view centre. Batch edit is More → Select all like this (every element of the selected types), then the toolbar applies to all.
10. **Not built:** PlantUML (needs a Java/server renderer, which is against local-first), PDF export, an icon library, importing other tools' formats (Visio, draw.io), comments, translate, mobile.

## Non-goals

- Collaborative editing.
- Embedding the scene in the markdown file itself.
