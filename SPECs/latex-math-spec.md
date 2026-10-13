# LaTeX Math Rendering

## Problem

Pensée already parses TeX-style math delimiters — `$...$` (inline) and `$$...$$` (display) — into `Math` / `MathMark` / `MathFormula` syntax nodes (`apps/desktop/src/lib/prosemark-core/markdown/mathMarkdown.ts`), but nothing consumes them: formulas show as raw source with no highlighting and no rendering. Obsidian-vault users expect math to render.

## Goal

Render math with KaTeX in the editor using the existing fold pattern: rendered widget when the selection is outside the node, editable raw source when the selection touches it.

## Design

### Parser hardening (mathMarkdown.ts)

The current single-`$` parser accepts any `$...$` span, so prose like "I paid $5 and $10 more" turns into math. Adopt Pandoc's guards for inline math:

- content must be non-empty and must not start or end with whitespace
- the closing `$` must not be immediately followed by a digit

Display `$$...$$` stays lenient (matches Pandoc), but blank content renders nothing.

### Rendering (`math-renderer.ts`, editor-area)

Mirror `mermaid-renderer.ts`: synchronous, LRU-cached (`limit 200`, key = mode + formula) wrapper around `katex.renderToString` returning `{ html } | { error }`. KaTeX options: `displayMode` per delimiter kind, `throwOnError: false` (soft errors render the source in error color), `trust: false` (default — no raw HTML/URL injection from documents), `output: "html"` (skip MathML duplication). Hard parse errors are caught and surfaced as `{ error }`.

### Decorations (`math-decorations.ts`, editor-area)

`foldableSyntaxFacet.of({ nodePath: "Math", buildDecorations })`:

- selection touches node → no decoration (fold core default): raw source, editable.
- otherwise → `Decoration.replace` over the node with an inline `MathWidget` that paints synchronously in `toDOM` (cache-backed, per docs/editor.md).
- widget classes: `cm-math-widget`, plus `cm-math-display` for `$$`. KaTeX's own `katex-display` CSS provides block centering for display math.
- render error → widget shows the raw source styled as an error with the message in `title`, instead of silently showing nothing.
- clicking a widget range-selects the node via `selectAllDecorationsOnSelectExtension("cm-math-widget")`, flipping it into source mode (same as images).

### Source highlighting

Style `mathDelimiterTag` (muted, like other marks) and `mathFormulaTag` (code font) in `prosemark-core/syntaxHighlighting.ts` so unfolded source reads as math source.

### Styling

`katex/dist/katex.min.css` imported from `math-decorations.ts` (Vite bundles the fonts). Small `math-widget.css` for widget-frame styling (error state, display-math margins).

## Non-goals

- Multi-line block math grammar (`$$` fences spanning paragraphs). The inline parser already spans soft line breaks within one paragraph; a dedicated block parser can come later.
- `\(...\)` / `\[...\]` delimiters.
- mhchem/extension packages.

## Validation

- Unit tests (`tests/math.test.ts`): parser guards (currency false-positives, escaped `\$`, empty content), renderer cache + error path, decoration fold/unfold against `foldExtension` (mermaid.test.ts pattern).
- `vp check`, `vp test`.
