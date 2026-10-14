# List tree rail

Bullets and tasks hang on thin lines that show the outline's shape, after the
spectrumui [tree-nav](https://ui.spectrumhq.in/r/tree-nav.json) and the reply
lines in a Reddit thread.

## What it looks like

- **Top-level items:** one hairline runs down the bullet column, from the
  list's first item to its last, with a small gap around each dot (or box).
- **Nested items:** the parent's line drops from under its bullet and curves
  into each child's bullet (an 8px quarter turn, smaller when the indent is
  narrow). A nested list has no rail of its own at its column: the curves from
  the parent's line already join its items, the way a thread's line does.
- No collapse button on the line, and no diamond marker (tree-nav has one).
- Bullets and tasks join. A numbered item is not part of the tree: a bullet
  list under a number starts its own rail, and numbers keep their look.

## The accent run

tree-nav's accent run, followed along the tree: a darker line from the top of
the list down to one item, through each ancestor's curve.

- It follows the hovered item. With no hover, it rests on the caret's item
  while the editor has focus, and fades out otherwise.
- Hovering another item glides: the run retracts along what is drawn to where
  the two paths part, then grows along the new path. One eased progress over
  the whole distance, `--motion-settle` on `--ease-out`, and a retarget starts
  from what is on screen, so sweeping the pointer down a list never snaps.
- Caret moves (keyboard, typing) and layout changes jump with no motion.
  Coming back from hidden, the run appears in place and only fades in.
- Reduced motion: no glide and no fade.

## The bounce ball

After beui's bounce sidebar: a solid ball marks the hovered item, at its
level; with no hover, the item the caret is in.

- On a bullet it covers the bullet. On a task it sits on the line just left of
  the box.
- When the pointer moves onto another item, or the caret goes to another item
  with no hover (a click, the arrow keys, Enter onto a new item), the ball
  hops there: one spring over a curve that bulges left, away
  from the text, about 5px between neighbouring rows and at most 20px on a
  long jump. The spring's overshoot carries on along the curve's end, which is
  the landing bounce. A long jump gets a softer spring.
- Typing in the same item, or the layout moving, moves it with no hop; a
  layout move mid-hop shifts where the hop lands instead of snapping.
- Hidden with no hover and the caret outside a bullet or task list (or the
  editor not focused). Reduced motion: no hop, no fade.
- Motion's `arc()` path only works through its React components, so the curve
  is drawn by hand from the spring's progress.

## How it is built

`lib/prosemark-core/list/tree-rail.ts`, part of `listExtension`.

- One SVG in a layer on `scrollDOM`, behind the text (`z-index: -1`, like
  CodeMirror's selection layer). Nothing enters the contenteditable DOM, so
  caret motion and hit-testing are unchanged.
- Positions are layout offsets (`offsetLeft`/`offsetTop` up to the scroller),
  never client rects: Combine flies its lines in with a transform, and a rail
  measured mid-flight would stay where the line was in flight.
- Task boxes are centred on the bullet column (they sat 5px left of it), so
  bullets and tasks share one rail.
- Geometry comes from the syntax tree (`ListItem` with a bullet `ListMark`)
  over the outermost lists that touch the viewport, so a rail that crosses
  the screen is drawn when both of its ends are out of view. Marker centres
  come from the rendered prefix mark (its offset width gives the `ch`; the column is
  `(depth + 0.5) × LIST_UNIT_CH` ch), with `lineBlockAt` for lines not in the
  DOM.
- The gaps around markers are an SVG mask, not background-coloured knockouts,
  so translucent themes work.
- Rebuilt on doc, viewport, geometry and tree changes (`treeChanged`); a
  selection or focus change only moves the accent and the dot.

## Not in scope

- The agent chat's markdown lists.
- Clicking the rail (tree-nav rows are links; here the text is the target).
