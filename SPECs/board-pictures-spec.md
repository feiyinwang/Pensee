# Every picture on a board

Status: built (2026-10-27)

## Why

A talk draws a topic as a mind map, steps, a matrix, a timeline or a chart. Only mind maps and steps
became boards; the rest stayed pictures in the note that couldn't be moved, arranged or added to by
hand. Every picture should live on a board, the same as the others, and a board should be able to
start any of them.

## What it does

- **Every picture is a board.** A talk topic, whatever its picture, is saved as a `.board.svg` beside
  the note and shown in the talk box with the board's renderer; after Stop the note embeds the board,
  never a Mermaid block. A topic whose text can't be read shows Pele's message instead.
- **Pieces where they help.** A matrix and a timeline are made of the board's own pieces, so you
  drag, rename and add to them like any card:
  - **Matrix** (`quadrantChart`): four sections in a 2×2 grid, tinted blue, purple, orange and green
    (the mind map's order), named after the quadrants; each idea a blue card placed by its two
    scores; the axes as text below and beside (the y axis reads bottom to top). Dragging a section
    carries its cards.
  - **Timeline**: a card per period on an arrow, each period its own tint, its events in outlined
    cards of the same hue under it.
  - **Steps** and **mind maps** as before (SPECs/talk-notes-spec.md#topic-boards).
- **Chart cards.** A bar, line or pie chart, and any other diagram Pele reads (journey, sankey,
  sequence…), is one chart card: a raised surface with a hairline ring, the chart drawn inside from
  its Mermaid text every time the board draws, so new numbers redraw it. The card takes its
  drawing's size, so its words read like the cards around it; a bar or line chart is drawn at
  440×300 unless its text sets its own size. Double-click a chart card to edit its text in place
  (⌘↵ or Esc to finish); emptying it keeps the old text.
- **Colours.** The chart card sets Pele's colour variables from the board's own colour tokens, which
  the `.board.svg` carries in its `<style>`: the chart follows the board's palette and theme in the
  editor, in the talk box, in the note's image preview and in other apps. Words Pele writes on a
  filled shape (a pie slice's share) take the light one of the theme's surface and ink.
- **The Picture tray.** The board's dock has a **Picture** group: Mind map, Steps, Matrix, Timeline,
  Chart, named as the talk box's buttons name them. Each drops its skeleton in the middle of the
  view, selected: a central topic; three steps; four empty sections with Low → High axes; three
  periods; a chart with placeholder numbers to write over (a chart can't draw without some). The
  old Mind map tool and its M key stay gone; N and M pick nothing.
- **Pasting** any Mermaid diagram into a board gives the same pieces (a pasted flowchart keeps its own
  shapes), and **Convert to board** on a Mermaid block in a note works for every type.
- **Hand edits in a talk** (`topic-board-merge.ts`): a matrix or timeline you changed is yours, and
  the AI's drawings leave it (as with steps). A chart card you only moved or resized keeps its place
  and takes the new numbers; one whose text you edited is yours. Redrawn as another picture, a board
  you'd changed gets a new board and yours stays on disk.

## How it's built

- `board-model.ts`: `ChartEl { t: "chart", src }`, parsed and written like the other elements.
- `board-chart.ts`: Pele draws a chart's text (each diagram type's renderer loads on first use; a
  render before then draws "Drawing…" and `onChartsReady` redraws), sanitised, cached by text;
  `CHART_INKS` maps Pele's variables to the board's tokens; `loadCharts` and `fitCharts` let a
  writer wait for the drawing and size the card to it. The board file waits for it before writing.
- `board-pictures.ts`: the matrix, timeline and chart-card importers; `board-mermaid.ts` tries them
  after flowchart and mind map, and `pictureToElements` is what Pensée draws itself (the talk, the
  tray), with steps as the board's cards.
- `board-dock-items.ts`: the Picture group and each picture's starter text.
