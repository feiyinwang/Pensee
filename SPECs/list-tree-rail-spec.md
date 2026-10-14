# List tree rail: guides

Bullets and tasks show their depth with faint straight guides, one per nested
list, like an editor's indent guides. The guide hanging from the item you are
on is a shade darker, so its column lights up under it without a line on
every item.

## Decision (2026-10-14, from `proto/list-depth`)

Five directions were built behind a picker on a nine-level outline with
wrapped lines and AI-ink runs; **Guides** was picked.

- One straight hairline per nested list, at the parent's bullet column, from
  just under the parent's bullet to the end of the last child's subtree. No
  curves, no per-item connectors.
- A top-level list has no line: it sits at the left edge already.
- Resting colour `--color-border-subtle`; the guide hanging from the hovered
  item (else the caret's item, while the editor has focus) is
  `--color-text-faint`: the line in that item's own bullet column, down its
  subtree. An item with no children has no guide, so nothing darkens.
  (First shipped darkening the guide the item hangs *on*, one column to its
  left; corrected the same day: it read as a different level.) The change is a colour fade on `--motion-hover` with
  `--ease-out`; nothing travels. Instant under reduced motion.
- Rejected:
  - **Current** (the tree from 2026-10-13: a rail down every list and an 8px
    curve into every item, with an accent run gliding to the hovered item):
    one line per item made deep outlines read as wiring, not writing.
  - **Trail** (no lines at rest, only the accent run to your item): calm, but
    a reader who isn't hovering sees depth only from indentation.
  - **Markers** (no lines; dot, ring, dash by depth, ancestors' bullets
    darken): shapes have to be learned, and depths 1 and 4 look the same.
  - **Scope** (no lines; a soft band behind your sibling group): a moving
    filled area competes with the text and with selection.

## What it looks like

- A guide starts 10px under its parent's bullet (14px under a task box) and
  ends 8px above the bottom of the last child's last line, so a wrapped last
  child is covered to its end and the guide never touches the next sibling.
- Guides never cross a marker: a guide sits at its parent's column, and every
  item inside it is at least one indent further right.
- Guides never cross text. Only a marker line gets the list's hanging indent;
  any other text inside a list (a lazy continuation under a nested bullet, a
  paragraph or code under an item) starts at the content edge, left of every
  guide. A guide stops 8px above such a line and, if more children follow,
  starts again 8px below it. Blank lines don't cut a guide.
- Bullets and tasks join. A numbered item is not part of the tree: a bullet
  list under a number has no guide, and numbers keep their look.

## How it is built

`lib/prosemark-core/list/tree-rail.ts`, part of `listExtension`.

- One SVG in a layer on `scrollDOM`, behind the text (`z-index: -1`, like
  CodeMirror's selection layer). Nothing enters the contenteditable DOM, so
  caret motion and hit-testing are unchanged.
- Marker positions are layout offsets (`offsetLeft`/`offsetTop` up to the
  scroller), never client rects: Combine flies its lines in with a transform,
  and a guide measured mid-flight would stay where the line was in flight.
- Task boxes are centred on the bullet column, so bullets and tasks share one
  guide.
- Geometry comes from the syntax tree (`ListItem` with a bullet `ListMark`)
  over the outermost lists that touch the viewport, so a guide that crosses
  the screen is drawn when both of its ends are out of view. Marker centres
  come from the rendered prefix mark (its offset width gives the `ch`; the
  column is `(depth + 0.5) × LIST_UNIT_CH` ch), with `lineBlockAt` for lines
  not in the DOM. A subtree's bottom is the `lineBlockAt` bottom of the
  item's last line.
- Rebuilt on doc, viewport, geometry and tree changes (`treeChanged`); a
  selection, focus or hover change only moves the darker guide.

## Not in scope

- A ball that bounces between bullets (after beui's bounce sidebar): tried
  and removed on 2026-10-14.
- The agent chat's markdown lists.
- Clicking a guide to fold its list.
