# Heading tree

## Ask

Every document shows its headings as a Reddit-style thread tree. Typing `#`, `##`, … on a line makes that line a node; nesting comes from the heading level. Thread lines run down from a parent and curve into each child. All headings render at one size, so the tree, not the type size, shows the level. Sections can be collapsed and expanded from the tree, and the whole feature can be turned off.

## Behaviour

- **Setting**: Preferences → Editor → Heading Tree (`editor.heading-tree`, default on). Off restores the stock heading sizes and indentation and reopens any collapsed sections, since the chevrons are the only control that reopens them.
- **Spacing**: headings sit close to their own body and further from the section above (proximity). With the tree on, the heading top padding drops from 1rem to 0.25rem and heading leading from 1.8 to 1.5, leaving ~30px of air above a heading and ~10px below it, against ~45px / ~13px before.
- **Motion**: only the chevron's quarter turn (`--motion-fast`, `--ease-out`, a transform) and its hover fill. Collapse and expand themselves are instant: the fold changes layout height, which is not animated. All of it is off under `prefers-reduced-motion`.
- **Indentation**: every line in a section is indented one 24px step per nesting depth, plus one step for the toggle column. The heading and its body share the same left edge, like a comment's username and body. Text before the first heading is not indented.
- **Depth**: nesting, not the raw `#` count. Skipped levels collapse to one step (`#` then `###` is one level deeper), matching the section rail. Only top-level headings count; a `#` inside a list item, blockquote or code fence is not a node.
- **Toggles**: each heading has a small disclosure chevron (a ~6px glyph in a 16px hit area) in the step left of its text. ▾ means open and collapses the section on click; ▸ means collapsed and expands it. The chevron turns between the two on `--motion-fast`. A heading with nothing under it gets a plain dot instead.
- **No `#` marks**: the hanging `#` marks never show with the tree on, not even with the caret on the heading line; the chevron stays put. The marks are still in the text, only invisible; turn the tree off to see them.
- **Threads**: a parent's line starts under its chevron and ends at the curve into its last visible child. Collapsed children drop out of the tree.
- **Collapse**: a CodeMirror fold over the section range the markdown language's `headerIndent` fold service reports, so search, copy and the caret treat it like any other fold. Collapsing with the caret inside the section moves the caret to the end of the heading line. The fold placeholder is a muted `…` pill after the heading; clicking it also expands.

## Implementation

`apps/desktop/src/components/editor-area/heading-tree.ts`, with the outline maths in `heading-tree-model.ts` and styles in `heading-tree.css`.

- The outline is a state field rebuilt when the document or the committed syntax tree changes; it is empty while the setting is off, which switches every other part off.
- Indentation is a `margin-left` line decoration over the visible ranges. Margin, not padding, because list and blockquote lines already own their padding.
- Threads and toggles live on a CodeMirror layer: one SVG path for every thread (faded as a group so overlapping segments do not double the alpha) and one chevron button per heading in the viewport. Heading y positions come from `coordsAtPos` for rendered headings and from the height map for the off-screen end of a long thread.

## Limits

- Block widgets (tables, mermaid, columns, images rendered as blocks) are not indented; the thread still passes beside them.
- The chevrons are mouse targets only. There is no keyboard binding for collapse, because CodeMirror's fold keys (`Mod-Shift-[` / `]`) are already the indent keys in this app.
- Collapsed state is per open editor and is not saved with the file.
