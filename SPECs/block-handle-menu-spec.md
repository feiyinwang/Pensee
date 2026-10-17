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
| Paragraph line, heading, quote    | yes        | up / down / insert above / below | yes       | yes        | no confirm                    |
| List item                         | yes        | up / down among siblings / insert a sibling | yes (as a sibling) | yes | no confirm          |
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
   And never fewer: CodeMirror's history joins a `delete.*` transaction to an
   edit it touches made within 500ms, so a Delete right after typing undid the
   typing with it. The deletes carry `isolateHistory.of("full")`.
2. **The target, not the caret.** No action reads `state.selection`. The grip
   can be beside a block the caret has never visited. The one exception is a
   list item inside a selection of several items (see List items).

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
- Converting a nested item to a non-list shape lifts it out to a top-level
  paragraph; its own children stay where they were.
- Dragging a list item that has nested items moves its own lines only; the
  nested items stay behind. The menu's Move takes them.

## List items

Each list item is its own target, the way each line of a paragraph is: the
grip parks on the item under the pointer and its menu acts on that item.
`listItemAt()` resolves the innermost item whose own lines contain the
pointer's line; an item's extent stops before its nested list, so a parent
never carries its children into a conversion. Every other action takes the
item **with its subtree**: its nested items belong to it, and deleting,
cutting or duplicating only the parent's own line orphaned them under the
item above (or left them out of the copy).

- **Type tiles.** Bullet / numbered / to-do rewrite the item's marker and
  nothing else, so a wrapped second line stays put. Numbers continue from the
  sibling above (`1.` above → `2.`), and when the marker changes width
  (`- ` → `1. `) every line under the item shifts by the difference, or its
  children would fall out of it as siblings. Any other shape takes the item
  out of the list with a blank line on each side — written in place, a
  paragraph line between two items is a lazy continuation of the item above
  and swallows the item below.
- **A selection of items.** When the editor's selection covers several items
  and the grip's own item is one of them, the tiles act on every selected
  item, nested ones included, in one undo step (`selectedListItems()`). The
  lit tile is the shape all of them share; clicking it clears all of them.
  The selection stays over the items, so a second pick converts the same set.
  A grip outside the selection converts only its own item. The structural
  actions follow the selection too; the scope table below says how.
- **Move** swaps with a sibling in the same list only, children travelling with
  their item. Bodies swap and markers stay put, so `1. 2. 3.` keeps counting.
- **Insert / duplicate** add a sibling (`\n` + indent + marker), never `\n\n`,
  which would make the list loose, and land after the item's nested items —
  at the end of its own line they became the new item's children. A to-do
  sibling starts unticked. The copy drops a trailing ` ^id`: two blocks with
  one id make every link and embed of it ambiguous.
- **Delete** removes the item's lines, nested items and indentation included,
  and exactly one newline. **Cut / Copy** put the same lines on the clipboard,
  shifted left so the item starts at column 0 (a nested item pasted at the top
  of a note would otherwise be an indented code block).
- **Numbers are recomputed.** After an insert, duplicate or delete, every
  ordered list the edit touched is numbered in sequence from the number it
  started at, in the same undo step (`dispatchListEdit()`): a duplicated `2.`
  makes the copy `3.` and pushes the rest down; deleting `1.` leaves the list
  starting at 1. A number that gains a digit (`9.` → `10.`) shifts its nested
  items with it. A list written as `1. 1. 1.` comes out `1. 2. 3.` once touched.
- **Drag** sources re-resolve through `gripBlockAt()`, the same narrowing the
  grip uses, so a dragged item or paragraph line is never checked against —
  and removed as — its whole list or paragraph. A dragged parent still leaves
  its nested items behind (see Known gaps).

### Selection scope

The grip's item counts as inside the selection when the selection touches one
of its own lines; a selection ending at the very start of a line does not take
that line. "Outermost" means a selected item inside another selected item's
subtree is not taken twice: its parent's subtree already carries it.

| Action                 | Grip's item inside a selection of 3                                        | Grip's item outside it | Undo steps | Selection afterwards                     |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------- | ---------- | ---------------------------------------- |
| Turn into (type tiles) | all 3                                                                      | that item only         | 1          | the same 3                               |
| Move up / down         | all 3 as one run, when their outermost items are siblings of one list      | that item only         | 1          | the same 3, moved                        |
| Move up / down         | hidden, when the selection spans two depths (no single place to move to)   | —                      | —          | —                                        |
| Insert above / below   | one new item above the first selected / below the last (after its subtree) | beside that item       | 1          | caret in the new item                    |
| Duplicate              | all 3 copied as one run, below the last one's subtree                      | that item              | 1          | the copies (one item: caret in the copy) |
| Cut                    | all 3 on the clipboard, then deleted                                       | that item              | 1          | caret where they were                    |
| Copy                   | all 3 on the clipboard                                                     | that item              | 0          | unchanged                                |
| Copy link to block     | hidden: a link names one block                                             | that item              | 0          | unchanged                                |
| Delete                 | all 3, subtrees included                                                   | that item              | 1          | caret where they were                    |

Why Copy link is hidden instead of acting on the grip's item: every other row
in the panel takes the whole selection, so one that quietly took one item
would read as the same action (`grill-selection-scope` rule 7).

Only list items follow a selection. A selection that also covers a paragraph
acts on the list items in it; the paragraph is left alone.
