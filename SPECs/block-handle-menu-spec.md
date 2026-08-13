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

| Event | Effect |
| --- | --- |
| Pointer rests on grip `MENU_OPEN_DELAY` (220ms) | Open |
| Pointer leaves grip **and** panel for `MENU_CLOSE_DELAY` (150ms) | Close + hide grip |
| `pointerdown` on grip | Close, start drag |
| `Escape` | Close |
| Editor scrolls, window blurs, document changes | Close |
| Any menu action | Close first, then dispatch |

The 220ms is load-bearing. The grip follows the pointer down the left margin,
so a hand crossing a column of paragraphs passes over a dozen grips; without
the delay every one of them opens.

The 6px gap between grip and panel is bridged by `.wr-bmenu::before`, a
transparent strip above the panel. Leaving the grip starts the close timer and
entering the panel cancels it, so the corridor has to be part of the panel's
hit area — in CSS, not in a JavaScript rect comparison, which is the version
that gets out of sync with the layout.

While the panel is open the grip is **frozen**: `place()` returns early. The
grip is both the panel's anchor and its target, and letting it wander is the
one way this could quietly act on the wrong block.

## Contents

Built per target; an item that would be a no-op is not rendered rather than
greyed out.

| Target | Type tiles | Move / insert | Duplicate | Cut / Copy | Delete |
| --- | --- | --- | --- | --- | --- |
| Paragraph, heading, list, quote | yes | up / down / insert above / below | yes | yes | no confirm |
| Picture, fence, table, HTML, rule | no | up / down / insert above / below | yes | yes | no confirm |
| Band (a column's caption) | yes | — | yes | yes | no confirm |
| Column | no | left / right | yes | yes | **confirm, with block count** |

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
