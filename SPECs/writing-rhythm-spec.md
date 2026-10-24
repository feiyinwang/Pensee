# Writing rhythm

Status: implemented

The editor's vertical spacing and measure follow Ulysses: looser lines, a full
blank line between paragraphs, and a slightly narrower column. Font family,
font size, heading sizes and colours are unchanged.

## Reference

Measured from a Ulysses Mac screenshot (SF Pro, `## A Bridge over the Mercy`
and one paragraph) and the iPad screenshot on ulysses.app (several
paragraphs). Ulysses doesn't publish its defaults, so every value is a ratio to
the body font size, read off the pixels. The body size comes from SF Pro's cap
height (0.705em) and x-height, which give 35.5–36.6px in the Mac shot.

| Measure                               | Ulysses               | Pensée before | Pensée now |
| ------------------------------------- | --------------------- | ------------- | ---------- |
| Line pitch                            | 1.88em                | 1.7em         | 1.9em      |
| Paragraph → next paragraph, baselines | ≈3.93em (2.1 pitches) | 2.7em         | 3.9em      |
| Heading → first body line, baselines  | 4.07em                | 2.91em        | 4.13em     |
| Column width                          | 36–37.7em             | 37.8em        | 36.7em     |
| Space above the first line            | ≈4.9em                | ≈5.8em        | unchanged  |

The paragraph figure is measured twice and the two agree: on the iPad, where
paragraphs follow each other (2.04 and 2.15 pitches), and on the Mac, from the
last line to the caret on the next paragraph. The heading line was not changed;
the larger blank line alone brings it to Ulysses' gap. The space above the
first line stays, since Pensée sets a page title there that Ulysses doesn't
have, and 96px above it is already close.

## What changed

- `editor.line-height` defaults to 1.9 (was 1.7); `editor.content-width` to
  660px (was 680px, about 66 characters of SF Pro at 18px). Configs that store
  their own values keep them.
- A blank line between blocks is `line-height: 2` (was 1) in
  `prosemark-theme.css`. It is a fixed 2em, not tied to the line-height
  setting, the way Ulysses keeps paragraph spacing a setting apart from line
  height. Inline editors (caption bands, columns, embeds) keep their own 0.5
  blank line, which matches `--wr-block-gap`.
- Fallbacks follow: `App.css`, `prosemark-theme.css`, `columns.css`,
  `book-reader.css`, `columns-decorations.ts`.

## Not copied

- Ulysses' grey `##` markup hanging in the margin: Pensée shows an H1–H6 label
  there instead (`heading-level-labels.ts`).
- Ulysses' caret (blue, about 2px, the full line tall): the caret is drawn in
  the foreground, as is everything in Ink (`SPECs/ink-only-colour-spec.md`).
- Heading size and weight (Ulysses: bold SF at 2×): headings are Bodoni Moda
  (`SPECs/didone-display-type-spec.md`).
