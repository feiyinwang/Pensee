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

## Phases

1. **Portable storage** (this change): the file format, the enhancer on image previews, `/board` creating a file, and fence migration.
2. **Core editing polish** (the user's priority): sticky notes, shapes with text inside, fill / border colour / width / dash, paste pictures. Done: the selection toolbar; sticky text centred and fitted (22→11px); labels centred using a CSS-matching baseline (`baselineIn`), so drawn and edited text sit on the same pixel; an "Add text" hint; typing on a single selected shape, note or text starts editing (tool shortcuts still work with nothing selected); and shapes are hit anywhere inside, not only on the border.
3. **Mind maps and flowcharts:** a mind-map node type with auto layout (Tab adds a child, Enter adds a sibling), flowchart connectors that follow their shapes, and import of `mermaid` flowchart/mindmap fences into editable boards.
4. **Arc board chrome:** the tools rail becomes Arc Pro's Dock; menus and the template picker move to Arc too, all lazy-loaded with the selection toolbar. Pro items install with `ARC_PRO_TOKEN` (see `docs/arc.md`).
5. **Present mode:** sections become slides; arrow keys move the camera between them with spring transitions.
6. **Later:** templates, icon library, batch edit, pen tool, PNG/PDF export, import, find & replace, swimlanes, PlantUML. Comments, translate and mobile are out of scope for a local-first app.

## Non-goals

- Collaborative editing.
- Embedding the scene in the markdown file itself.
