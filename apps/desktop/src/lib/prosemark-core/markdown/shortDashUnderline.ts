import type { Line, MarkdownConfig } from "@lezer/markdown";

const DASH = 45; /* - */

// Same whitespace set lezer's own `isSetextUnderline` tolerates after the
// underline characters, so every line it would have claimed as a one- or
// two-dash underline is a line this rule sees first.
const isSpace = (ch: number): boolean =>
  ch === 32 /* space */ || ch === 9 /* tab */ || ch === 10 /* \n */ || ch === 13; /* \r */

/** `-` or `--` at the line's content start, followed by nothing but whitespace. */
const isShortDashRun = (line: Line): boolean => {
  if (line.next !== DASH) return false;
  let pos = line.pos + 1;
  while (pos < line.text.length && line.text.charCodeAt(pos) === DASH) pos++;
  if (pos - line.pos >= 3) return false;
  for (; pos < line.text.length; pos++) {
    if (!isSpace(line.text.charCodeAt(pos))) return false;
  }
  return true;
};

/**
 * Stop a lone `-` (or `--`) under a paragraph from turning it into a heading.
 *
 * CommonMark reads any run of `-` on the line after a paragraph as a setext
 * H2 underline, and an empty list item cannot interrupt a paragraph, so the
 * instant `-` is typed on the line below some prose that prose jumps to
 * heading size, and stays there through `- ` until the first character of the
 * item arrives and the list finally wins. Nobody writes a setext heading with
 * fewer than three dashes, so a one- or two-dash line ends the paragraph
 * instead: `-` and `- ` then parse as the empty bullet they are about to
 * become, and `--` as its own paragraph. Three or more dashes are untouched
 * and still underline the line above, exactly as the spec says.
 *
 * This is an `endLeaf` rule rather than a replacement setext parser because
 * lezer's horizontal-rule check defers to the *default* setext parser by
 * identity; swapping that parser out would let `---` end the paragraph as a
 * rule before any replacement got to see it.
 */
export const shortDashUnderlineMarkdownSyntaxExtension: MarkdownConfig = {
  parseBlock: [{ name: "ShortDashUnderline", endLeaf: (_cx, line) => isShortDashRun(line) }],
};
