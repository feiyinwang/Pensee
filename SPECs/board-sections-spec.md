# Board sections: rename, colour, carry

Asked 2026-10-16: "I should be able to edit the section title, change the
colour of sections, and move the section, which moves everything inside along
with it."

## Before

- Double-click a section opened `window.prompt`, which the Tauri webview does
  not show, so a section could not be renamed.
- Sections had one look: 3% ink fill, 14% ink edge, grey name.
- Dragging a section carried only elements whose `fr` named it, and `fr` was
  set only when an element was placed or dropped inside a section. Cards made
  first and then wrapped in a section had no `fr` and stayed behind.

## Now

**Rename in place.** Double-clicking a section (its name strip or edge) opens
the board's text field on the name strip, in the name's colour and size. Enter,
Escape or a click away keeps the name; an empty name falls back to "Section".
The name is the section's text (`textOf` / `setTextOf`), so find & replace and
the editor share one path. Bold / italic (⌘B / ⌘I) skip sections: their name is
plain text.

**Colour.** A selected section shows **Section colour** in the selection bar,
the same palette as a shape's fill (one control: with a shape selected too, it
is that shape's **Fill**). Stored as `c` on the frame (a `ColorToken`, absent =
plain grey, "No fill" clears it). Drawn from the swatch's full hue: fill 8%
over the canvas so the dot grid shows through, edge 45%, name in the hue.

**Carry what is inside.** A section owns every element whose centre is inside
it and in no smaller section (`frameAt`). `adoptInto(frame)` re-files the
elements it covers or claimed, and runs when a section is drawn, resized, and
pressed to drag; the drag then carries all of them. A new section is put behind
every card and above existing sections, so it never tints what it was drawn
around.

## Not done

- A section inside a section is not carried with the outer one (its own
  contents are, through `frameAt`'s smallest-section rule, only by the inner).
- Existing boards keep their element order: a section drawn over cards before
  this change still sits above them.

Journeys BRD-09, BRD-10, BRD-11 (docs/qa/user-journeys.md).
