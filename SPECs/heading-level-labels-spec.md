# Heading level labels

## Ask

Show the level of every heading as an H1–H6 label in the left margin, always visible, in the place where the gutter grip's type chip sits. Never show the `#` marks in front of headings, whether or not the caret is on the line.

## Behaviour

- Every heading line (ATX H1–H6, setext H1–H2) gets a 24px label box reading `H1`…`H6` in the left margin, muted, with a hairline border.
- It sits in exactly the grip's type-chip box: `GRIP_WIDTH + 4` px left of the text column, centred on the measured first line box (`firstLineBox` + `gripTop` in `columns-decorations.ts`).
- Hovering a heading shows the grip as usual, but the grip's own chip is hidden for headings (`data-kind="heading"`), so the label stays put and the grip only adds its dots beside it. Dragging from the label area works, because the grip's hit area covers the slot.
- The hanging `#` marks are always `opacity: 0`. They stay in the DOM and keep their size, because vertical caret motion measures them (see `heading-hash-margin-spec.md`).

## Implementation

`apps/desktop/src/components/editor-area/heading-level-labels.ts` is a view plugin that keeps one absolutely positioned span per visible heading in a container on `view.dom`, beside the grip. It re-measures on doc, viewport, geometry and parse changes through `requestMeasure`, so reads and writes stay in CodeMirror's measure cycle.

## Limits

- The level can no longer be read or edited from the `#` marks. Use the label to read it and the block handle menu's block type to change it.
- Headings inside column rows get no label; they have no editor line to stand beside.
