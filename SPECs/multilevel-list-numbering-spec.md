# Multilevel numbering for nested ordered lists

## Problem

A numbered item nested under a numbered item drew only its own source digits, so a list read

```
1. jiojoi
2. joijojio
   1. joijo
```

with the nested item showing `1.` (or whatever digits happened to be in the
source). Readers expect the multilevel numbering a word processor gives:
`2.1.`, `2.2.`, and `2.2.1.` one level further down.

## Behaviour

- A nested ordered item renders its ordered ancestors' numbers in front of its
  own marker, outermost first, each followed by `.`: `2.` above `1.` reads
  `2.1.`; `2.` above `2.` above `1.` reads `2.2.1.`.
- The chain stops at the first bullet ancestor. A numbered list under `- foo`
  counts from its own `1.`; a numbered list under that keeps only the numbers
  from the bullet down.
- Every number is the item's source digits, the same digits a top-level item
  already draws. Together with Tab / Shift+Tab renumbering (`renumberOrderedLevels`)
  and Enter continuation, tabbing `3.` under `2.` shows `2.1.`, and the next
  Enter shows `2.2.`.
- The source stays plain CommonMark. Nothing is written into the file; the
  ancestor chain is generated content.

## Implementation

`apps/desktop/src/lib/prosemark-core/list/index.ts`, ordered branch of
`buildListDecorations`:

- `orderedAncestorChain(node, doc)` walks `ListMark → ListItem → List →
ListItem …` and reads each ancestor `ListItem`'s first-child `ListMark`.
  Ordered marks contribute their digits; a bullet mark ends the walk.
- `orderedMarkerDecoration(chain, markerCh)` adds
  `cm-list-ordered-marker-nested` and `--cm-list-ordered-prefix: "2.1."` when
  the chain is non-empty. `syntaxHighlighting.ts` draws it with
  `::before { content: var(--cm-list-ordered-prefix) }` in the muted marker
  colour, and zeroes the list-mark highlight's 1ch inset on the inner span so
  the chain and the digits touch.
- `markerLabelCh(chain, markText)` estimates the label width in `ch`: a digit
  is 1ch, `.` / `)` count 0.5ch, and a plain (un-chained) marker adds the
  highlight's 1ch inset. The estimate feeds both the marker's `min-width` and
  the line's hanging indent (`orderedLineDecoration(depth, markerCh)`), so the
  first line's body and the wrapped continuation share a column. In the
  editor's proportional face a `2.1.` label fits the 3ch unit exactly, so a
  nested numbered item's body sits in the same column as a nested bullet's;
  longer labels (`100.`, `2.2.1.`) widen slot and indent together.
- Over-estimating is safe (the slot pads out and stays aligned); the estimate
  is tuned for proportional faces and will under-shoot by roughly half a `ch`
  per `.` in a monospace editor font, where the first line's body drifts right
  of its continuation by that much.

## Verification

- `apps/desktop/tests/list-extension.test.ts`: chain per marker, chain stops
  at a bullet, wide labels widen slot and indent together, `markerLabelCh`.
- Browser check of the extension in isolation (`prosemarkBasicSetup` +
  markdown language) at the app's font: every marker measured exactly its
  `min-width`, and each body column matched its line's padding within the
  width of the marker's trailing space.
