# Block handle menu

Status: implemented (first pass)

The gutter grip (`wr-gutter-grab`) could only drag. This adds a menu that opens
when the pointer rests on it, giving every block the operations that previously
needed either a remembered shortcut or a precise text selection — and giving
pictures, captions and columns operations they had no path to at all.

## Trigger

**Hover opens, press drags.** `pointerdown` on the grip stays a drag,
unconditionally: it cancels a pending open and closes an open panel before
starting. The alternative — click to open, 3px threshold to drag — would put a
decision in front of every drag, and dragging is the older, more frequent verb.

| Event                                                                   | Effect                     |
| ----------------------------------------------------------------------- | -------------------------- |
| Pointer rests on grip `MENU_OPEN_DELAY` (220ms)                         | Open                       |
| Pointer leaves the grip ∪ panel corridor for `MENU_CLOSE_DELAY` (320ms) | Close + hide grip          |
| `pointerdown` on grip                                                   | Close, start drag          |
| `Escape`                                                                | Close                      |
| Editor scrolls, window blurs, document changes                          | Close                      |
| Any menu action                                                         | Close first, then dispatch |

The 220ms is load-bearing. The grip follows the pointer down the left margin,
so a hand crossing a column of paragraphs passes over a dozen grips; without
the delay every one of them opens.

## Geometry

Two rects go into opening the panel: the **grip** says where it hangs from, the
**block** says what it may not cover.

- **Vertical is the invariant, and what it clears is the FIRST LINE — not the
  block.** The panel sits 8px under the first line box, or 8px above it when
  there is no room below. A line spans the whole text column, so no horizontal
  offset could ever have cleared it; that is why "8px right of the grip" landed
  on the block. Anchoring on the _block_ instead — the revision after that —
  cleared it, but made the gap equal to the block's height: flush against a
  quote, a whole picture away on an image. The line is what has to stay visible.
  The block is only the container it sits in.
- A picture's first line box is the degenerate one (top edge, one grip tall), so
  a picture and a paragraph read identically. There is **no per-block-type
  branch here** — every difference is already absorbed by `firstLineBox()`.
- The line box is computed once, in `place()`/`placeBeside()`, and kept as
  `lineBox`: the grip centres on it and the panel hangs off it. `openFor` takes
  it as `VerticalSpan {top, bottom}` rather than a `DOMRect`, so "pass the
  block's rect" stops being expressible.
- **Horizontal is free.** Left edge aligned with the grip, clamped into the
  window. Clamping it can no longer produce an overlap.
- Neither side big enough (a short window): the panel is capped with
  `max-height` and scrolls on the roomier side, rather than being allowed to
  spill across the line.
- The two branches (below / above) both _satisfy_ the invariant; they are not
  the "flip when it doesn't fit" escape hatch that revision 1 was told never to
  reinstate. The test is not "is there a conditional" but "can any arm of it
  overlap".

The grip's own vertical placement centres a 24px chip on the **measured** first
line box — `Range.getClientRects()` over the line's contents, not a computation
from the line's CSS. Heading and code font sizes are tag styles on a span
_inside_ the line, so `.cm-line`'s own `line-height` always resolves against
16px and describes the wrong box: 8.6px out on an h1, 5.8px on an h2, 2.9px on
an h3, 1.4px the other way in a code fence, exact on body text. That is what
"only some block types look off" was.

The grip's horizontal position is the same for every block type:
`textEdge - GRIP_WIDTH - 4`. A heading's hanging `#` occupies that same strip
and yields — the line the grip is parked beside gets a `wr-grip-line` line
decoration and the stylesheet fades its hash. The grip used to be the one that
yielded, sitting a hash-width further out on every heading; that read as the
handle floating away from headings, and it made the grip's x depend on the
block type. Two invariants survive the swap: the grip's x never depends on
whether the hash is showing, and the two never overlap.

The grip → panel corridor is a single padded rect (grip ∪ panel) tested in
`holdIfReaching`, next to the code that positions the panel. It used to be
`.wr-bmenu::before`, a strip on the panel's edge; that could not span a gap as
tall as a block, and being in a different file from `position()` it went stale
the first time the panel changed sides.

While the panel is open the grip is **frozen**: `place()` returns early. The
grip is both the panel's anchor and its target, and letting it wander is the
one way this could quietly act on the wrong block.

## Contents

Built per target; an item that would be a no-op is not rendered rather than
greyed out.

| Target                            | Type tiles | Move / insert                    | Duplicate | Cut / Copy | Delete                        |
| --------------------------------- | ---------- | -------------------------------- | --------- | ---------- | ----------------------------- |
| Paragraph, heading, list, quote   | yes        | up / down / insert above / below | yes       | yes        | no confirm                    |
| Picture, fence, table, HTML, rule | no         | up / down / insert above / below | yes       | yes        | no confirm                    |
| Band (a column's caption)         | yes        | —                                | yes       | yes        | no confirm                    |
| Column                            | no         | left / right                     | yes       | yes        | **confirm, with block count** |

Nine type tiles: Text, H1–H3, numbered, bulleted, to-do, code, quote. The tile
matching the block is lit; clicking it again clears the block back to Text.

A band gets no insert: bands are derived from a column's blocks at render time,
so an empty one is trimmed away the moment it is written. There is nothing to
put the caret in.

Deleting a single block is one `Cmd+Z` away, so a confirmation costs more than
the mistake it prevents. A column takes several blocks at once and what went
missing is not on screen afterwards, so that one asks — inline, inside the
panel, not through `confirm()`, which would take the event loop with it.

**Align and Indent** and **Color Options** are rendered but inert, with a `?`
explaining that markdown has nowhere to store them. The slot is where it will
be if that changes; hiding them would read as "this editor cannot".

## Structure

```
columns-model.ts      pure strings: parse a row, split a column into bands
    ↑             ↑
block-actions.ts  columns-decorations.ts (renders rows, owns the grip)
    ↑                     ↓
block-handle-menu.ts ← ───┘   (panel DOM, hover state machine)
```

`columns-model.ts` exists so `block-actions.ts` and `columns-decorations.ts`
can share one row implementation without importing each other.

### Addressing

The grip holds DOM elements, because that is the only way to point at a band —
the row widget owns that DOM and there is no document position inside it. The
menu cannot: its first dispatch rebuilds the widget and every element it was
holding is detached. So `toActionTarget()` crosses from one world to the other
exactly once, when the panel opens, producing an `ActionTarget` of offsets and
indices. Every action re-reads the document from that.

### Two rules for every action

1. **One dispatch.** `Cmd+Z` returns to the state before the click, once.
2. **The target, not the caret.** No action reads `state.selection`. The grip
   can be beside a block the caret has never visited.

`block-actions.ts` is typed against `BlockEditor` — `{ state, dispatch, focus? }`
— rather than `EditorView`, so the rules above can be tested without a DOM.
`tests/block-actions.test.ts` covers caret landing, which blank line a delete
eats, the one-column-row unwrap, and the dispatch count.

## Conversion vs toggling

`markdown-formatting.ts` now owns both verbs, side by side so the prefixes
cannot be spelled two ways:

- The **keyboard commands toggle**. `Cmd+Shift+8` on a quoted line adds a
  bullet and leaves the quote alone.
- `setBlockType()` **converts**. The tiles are a radio group, so picking one
  clears the previous prefix first, or the block ends up wearing two.

`setParagraph` (`Cmd+Alt+0`) changed with this: it used to strip only heading
hashes, so "Paragraph" left a bulleted line bulleted. It now clears every block
prefix, which is what the name promises and what the Text tile does.

## Known gaps

- No submenus yet; the two rows that would have them are inert.
- No keyboard path to the menu — the grip is still `aria-hidden`.
- List blocks are addressed whole; there is no drill-down to one `li`.
