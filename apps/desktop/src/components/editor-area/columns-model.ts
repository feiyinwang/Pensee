/**
 * The pure markdown model behind `<div class="wr-row">` columns: parsing a row
 * into cells, splitting a cell into bands, and serialising both back.
 *
 * Nothing here touches CodeMirror or the DOM — it is string in, string out —
 * because two callers need it and only one of them owns an editor view:
 * `columns-decorations.ts` renders rows, and `block-actions.ts` rewrites them
 * on behalf of the block handle menu. Keeping the model in its own module is
 * what keeps those two from importing each other in a cycle.
 */

export interface Column {
  /** Raw markdown for this cell. Anything a block can be. */
  md: string;
  grow: number;
}

export const ROW_OPEN = /^[ \t]*<div\b[^>]*\bclass\s*=\s*["'][^"']*\bwr-row\b/i;
/** `<div class="wr-col">` is what we write. `<figure>` is accepted for rows
 *  written by the first version of this feature. */
const CELL_RE =
  /<(?:div\b[^>]*\bclass\s*=\s*["'][^"']*\bwr-col\b[^>]*|figure\b[^>]*)>([\s\S]*?)<\/(?:div|figure)\s*>/gi;
const CELL_ATTRS_RE = /<(?:div\b([^>]*\bclass\s*=\s*["'][^"']*\bwr-col\b[^>]*)|figure\b([^>]*))>/i;
const GROW_RE = /flex\s*:\s*([0-9]*\.?[0-9]+)/i;

export function fmtGrow(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "1";
  return String(Math.round(n * 100) / 100);
}

/** Parse a `wr-row` block into its columns. Null when it isn't one. */
export function parseColumns(text: string): Column[] | null {
  if (!ROW_OPEN.test(text)) return null;
  const columns: Column[] = [];
  CELL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CELL_RE.exec(text))) {
    const attrs = CELL_ATTRS_RE.exec(match[0] ?? "");
    const growMatch = GROW_RE.exec((attrs?.[1] ?? attrs?.[2] ?? "") as string);
    columns.push({
      md: (match[1] ?? "").trim(),
      grow: growMatch ? Number(growMatch[1]) : 1,
    });
  }
  return columns.length ? columns : null;
}

/* -------------------------------------------------------------------- bands */

/**
 * A column's markdown split into the three rows ("bands") that a row aligns
 * across all of its columns: whatever sits above the anchor, the anchor itself,
 * whatever sits below it. The anchor is the column's first standalone image —
 * that is the thing a reader lines up — and in a text-only column it is simply
 * the first block, so a caption column still lines up with the pictures beside
 * it.
 *
 * Bands are **derived at render time and never written to the file.** Storing
 * them (a `data-band` attribute, say) would tie the format to this editor, and
 * `<div class="wr-row">` was chosen precisely so GitHub and Obsidian can read
 * it too. The cost is re-splitting a string on each render; the gain is that a
 * row hand-written anywhere else gets bands for free, with no migration.
 */
export interface Bands {
  above: string;
  anchor: string;
  below: string;
}

export type BandName = keyof Bands;

export const BAND_ORDER: readonly BandName[] = ["above", "anchor", "below"];

export const IMAGE_BLOCK = /^!\[[^\]]*\]\([^)\s]+\)$/;

/**
 * Split markdown into blocks at blank lines, keeping fenced code and `$$` math
 * whole — both may contain blank lines, and cutting them there would leave two
 * broken halves.
 */
export function splitBlocks(md: string): string[] {
  const lines = String(md ?? "").split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let fence: "```" | "$$" | null = null;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push(text);
    buf = [];
  };
  for (const line of lines) {
    if (fence) {
      buf.push(line);
      const closed = fence === "```" ? /^\s*```/.test(line) : /\$\$\s*$/.test(line);
      if (closed) {
        fence = null;
        flush();
      }
      continue;
    }
    const text = line.trim();
    if (text.startsWith("```")) {
      flush();
      buf.push(line);
      fence = "```";
      continue;
    }
    if (text.startsWith("$$") && !(text.length > 4 && text.endsWith("$$"))) {
      flush();
      buf.push(line);
      fence = "$$";
      continue;
    }
    if (!text) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

export function splitBands(md: string): Bands {
  const blocks = splitBlocks(md);
  if (!blocks.length) return { above: "", anchor: "", below: "" };
  let at = blocks.findIndex((b) => IMAGE_BLOCK.test(b));
  // A caption written on the line directly under a picture, with no blank line
  // between them, is ONE markdown block — blocks split on blank lines and
  // `IMAGE_BLOCK` is anchored to the whole string, so `![](x)\nioo` matches
  // nothing and the column ends up with the picture AND the words in a single
  // anchor band. Everything downstream then treats that band as a picture:
  // the grip wears the picture chip and parks at the top of the band, so
  // hovering the words shows the picture's handle and the caption has none of
  // its own; the band renders as one paragraph, so the picture no longer lines
  // up with the plain picture beside it.
  //
  // Two things to the reader is two bands. Split the block after its first
  // line when that line is a standalone image, and let the rest fall into
  // `below` — which is where the same text would have gone if the writer had
  // left a blank line. `joinBands` puts that blank line back on the next
  // commit, so the file ends up meaning what it looked like.
  let trailing = "";
  if (at < 0) {
    at = blocks.findIndex((b) => IMAGE_BLOCK.test(b.split("\n")[0] ?? ""));
    if (at >= 0) {
      const lines = blocks[at]!.split("\n");
      trailing = lines.slice(1).join("\n").trim();
      blocks[at] = lines[0]!;
    }
  }
  if (at < 0) at = 0;
  const below = blocks.slice(at + 1);
  if (trailing) below.unshift(trailing);
  return {
    above: blocks.slice(0, at).join("\n\n"),
    anchor: blocks[at] ?? "",
    below: below.join("\n\n"),
  };
}

export function joinBands(bands: Bands): string {
  return BAND_ORDER.map((name) => bands[name].trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Replace one band. An empty value removes it, leaving no blank lines behind. */
export function withBand(md: string, band: BandName, value: string): string {
  return joinBands({ ...splitBands(md), [band]: value.trim() });
}

/**
 * Drop something into a band. It lands next to the anchor: appending to `above`
 * puts it directly above the picture, appending to `below` puts it under
 * whatever caption is already there. A band never splits into a fourth band.
 */
export function appendToBand(md: string, band: BandName, incoming: string): string {
  const bands = splitBands(md);
  const add = incoming.trim();
  if (!add) return joinBands(bands);
  const existing = bands[band].trim();
  return joinBands({ ...bands, [band]: existing ? `${existing}\n\n${add}` : add });
}

export function serializeColumns(columns: Column[]): string {
  const cells = columns.map((c) =>
    [
      `<div class="wr-col" style="flex:${fmtGrow(c.grow)} 1 0;min-width:150px">`,
      "",
      c.md.trim(),
      "",
      "</div>",
    ].join("\n"),
  );
  return [
    `<div class="wr-row" style="display:flex;flex-wrap:wrap;gap:16px">`,
    ...cells,
    "</div>",
  ].join("\n");
}
