/**
 * Scene → SVG.
 *
 * Reconciles by element id instead of re-serializing the whole tree, so a drag
 * touches only the moved node's attributes. That is the difference between
 * "smooth at 300 elements" and "janky at 40".
 *
 * Colours are emitted as `var(--wr-board-*)` so the board follows the editor
 * theme; no hex value is ever stored in the document.
 */

import {
  type BoardEl,
  type BoardScene,
  type ColorToken,
  type DrawEl,
  type LinkerEl,
  type MindEl,
  type ShapeEl,
  STICKY_SIZE,
  isLinker,
  isShape,
} from "./board-model";
import { PIN_ICON_PATH, formatVideoTime, parseVideoLink } from "@/lib/video-pins";
import { parseWikiLink } from "@/lib/wiki-links";
import { smoothPath, strokeExtent } from "./board-draw";
import {
  type SceneLookup,
  branchColor,
  mindBranchPath,
  mindDepth,
  mindFontSize,
  mindParent,
  sceneLookup,
} from "./board-mind";
import {
  LINKER_LABEL_PAD,
  type Point,
  headAngle,
  pathD,
  polylineMidpoint,
  routeLinker,
  svgOutlinePath,
} from "./board-geometry";

const NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** CSS for a stored colour. Tokens (and their `-soft` tints) resolve against
 *  the theme. A custom `#rrggbb` is drawn as picked in light mode; in dark mode
 *  (`--wr-board-flip: 1`) its OKLCH lightness is mirrored into the dark range
 *  and its chroma eased, so a pale fill becomes a dark tint instead of glaring.
 *  See SPECs/board-color-palette-spec.md. */
export function colorVar(token: ColorToken): string {
  if (token === "none") return "none";
  if (token.startsWith("#")) {
    const f = "var(--wr-board-flip, 0)";
    return `oklch(from ${token} calc(l + ${f} * (clamp(0.25, 1.15 - l, 0.9) - l)) calc(c * (1 - 0.2 * ${f})) h)`;
  }
  return `var(--wr-board-${token})`;
}

function stickyVar(token: string): string {
  return `var(--wr-board-sticky-${token})`;
}

function dashArray(el: { d: string; w: number }): string | null {
  if (el.d === "dashed") return `${el.w * 4} ${el.w * 3}`;
  if (el.d === "dotted") return `${el.w * 0.1} ${el.w * 2.4}`;
  return null;
}

/* ------------------------------------------------------------ measurement */

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();

export const BOARD_FONT =
  'ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

/** Width of one line of label text as drawn: emphasis marks removed, bold
 *  and italic runs measured in their own face. */
export function measureText(text: string, size: number): number {
  return parseInline(text).reduce((w, r) => w + runWidth(r, size, 400), 0);
}

function measure(text: string, size: number, weight = 400, italic = false): number {
  const key = `${size}|${weight}|${italic ? "i" : ""}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  // No DOM (unit tests): the same estimate as a missing canvas context.
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * size * (weight >= 600 ? 0.6 : 0.55);
  measureCtx.font = `${italic ? "italic " : ""}${weight} ${size}px ${BOARD_FONT}`;
  const width = measureCtx.measureText(text).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

/* ------------------------------------------------------------ rich text */

/** A run of label text with its emphasis. Labels are stored as markdown, so a
 *  file opened anywhere still reads `**bold**` and `*italic*`. */
export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  /** `[[wiki link]]` inner text (target, `#fragment`, `|alias`); `text` is
   *  what it displays. Kept raw so a click resolves it like the editor does. */
  ln?: string;
}

/** A wrapped line: its runs, left to right. */
export type RichLine = Run[];

/* Markdown emphasis, CommonMark-ish: the mark must hug non-space text on both
   sides (so `2 * 3 * 4` stays literal), `_` only at word edges (so snake_case
   stays literal), and `***` is both. Alternation order matters: at one
   position the longer mark wins. Unclosed marks stay literal. */
const EMPHASIS =
  /\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*|\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)|(?<!\w)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/;

/** `[[Page]]`, `[[Page#Heading]]`, `[[Page|shown text]]` — the editor's wiki
 *  links. No nesting, no line breaks. */
const WIKI_LINK = /\[\[([^[\]\n]+?)\]\]/;

function sameStyle(a: Run, b: { b?: boolean; i?: boolean; ln?: string }): boolean {
  return Boolean(a.b) === Boolean(b.b) && Boolean(a.i) === Boolean(b.i) && a.ln === b.ln;
}

/** One paragraph (no newlines) into styled runs, markers removed. */
export function parseInline(src: string, style: { b?: boolean; i?: boolean } = {}): Run[] {
  const out: Run[] = [];
  const push = (text: string, st: { b?: boolean; i?: boolean; ln?: string }): void => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && sameStyle(last, st)) {
      last.text += text;
      return;
    }
    const run: Run = { text };
    if (st.b) run.b = true;
    if (st.i) run.i = true;
    if (st.ln !== undefined) run.ln = st.ln;
    out.push(run);
  };
  let rest = src;
  while (rest) {
    const m = EMPHASIS.exec(rest);
    const link = WIKI_LINK.exec(rest);
    // A link that starts first (or inside the emphasis' opening) wins: its
    // target is a name, never markdown — `[[my_page]]` keeps its underscore.
    if (link && (!m || link.index <= m.index)) {
      push(rest.slice(0, link.index), style);
      const inner = link[1];
      push(parseWikiLink(inner).displayText || inner, { ...style, ln: inner });
      rest = rest.slice(link.index + link[0].length);
      continue;
    }
    if (!m) {
      push(rest, style);
      break;
    }
    push(rest.slice(0, m.index), style);
    const [, both, bold, bold2, it, it2] = m;
    const inner = both ?? bold ?? bold2 ?? it ?? it2 ?? "";
    const next = {
      b: style.b || both !== undefined || bold !== undefined || bold2 !== undefined,
      i: style.i || both !== undefined || it !== undefined || it2 !== undefined,
    };
    for (const r of parseInline(inner, next)) push(r.text, r);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const BOLD_WEIGHT = 700;

function runWidth(r: Run, size: number, weight: number): number {
  return measure(r.text, size, r.b ? Math.max(BOLD_WEIGHT, weight) : weight, r.i);
}

/** Greedy wrap over styled runs. Words are kept whole across style changes
 *  (`**bo**ld` is one word); a single word wider than the box is broken
 *  character by character so a pasted URL cannot blow it out. */
export function wrapRich(text: string, size: number, maxWidth: number, weight = 400): RichLine[] {
  const out: RichLine[] = [];
  for (const paragraph of text.split("\n")) {
    // Tokens: words and spaces, each a list of runs (a word may span styles).
    const tokens: { runs: Run[]; space: boolean }[] = [];
    for (const run of parseInline(paragraph)) {
      for (const piece of run.text.match(/\s+|[^\s]+/g) ?? []) {
        const space = /^\s/.test(piece);
        const part: Run = { ...run, text: piece };
        const last = tokens[tokens.length - 1];
        if (last && !space && !last.space) last.runs.push(part);
        else tokens.push({ runs: [part], space });
      }
    }
    const width = (runs: Run[]) => runs.reduce((w, r) => w + runWidth(r, size, weight), 0);
    let line: Run[] = [];
    let lineW = 0;
    const flush = (): void => {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
        lineW -= runWidth(line[line.length - 1], size, weight);
        line.pop();
      }
      out.push(line);
      line = [];
      lineW = 0;
    };
    for (const tok of tokens) {
      const w = width(tok.runs);
      if (lineW + w <= maxWidth) {
        line.push(...tok.runs);
        lineW += w;
        continue;
      }
      if (tok.space) {
        flush();
        continue;
      }
      if (line.length) flush();
      if (w <= maxWidth) {
        line.push(...tok.runs);
        lineW = w;
        continue;
      }
      // Hard-break an over-long word, keeping each character's style.
      for (const r of tok.runs) {
        for (const ch of r.text) {
          const cw = runWidth({ ...r, text: ch }, size, weight);
          if (lineW + cw > maxWidth && line.length) flush();
          line.push({ ...r, text: ch });
          lineW += cw;
        }
      }
    }
    flush();
  }
  return out.map(mergeRuns);
}

function mergeRuns(line: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of line) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) {
      last.text += r.text;
    } else out.push({ ...r });
  }
  return out;
}

/** Plain-string wrap, for callers that only need line breaks. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  return wrapRich(text, size, maxWidth).map((l) => l.map((r) => r.text).join(""));
}

/** Shrinks the font until the wrapped text fits, then stops at `min`.
 *  `fits` is false when even `min` overflows — the caller truncates. */
export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  max: number,
  min: number,
): { size: number; lines: RichLine[]; fits: boolean } {
  for (let size = max; size >= min; size -= 1) {
    const lines = wrapRich(text, size, boxW);
    if (lines.length * size * LINE_HEIGHT <= boxH) return { size, lines, fits: true };
  }
  return { size: min, lines: wrapRich(text, min, boxW), fits: false };
}

/** The first `max` lines, the last one ending in an ellipsis that fits. */
export function truncateLines(
  lines: RichLine[],
  max: number,
  size: number,
  boxW: number,
  weight = 400,
): RichLine[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, Math.max(1, max)).map((l) => l.map((r) => ({ ...r })));
  const last = kept[kept.length - 1];
  const ell = "\u2026";
  const total = () => last.reduce((w, r) => w + runWidth(r, size, weight), 0);
  const ellW = measure(ell, size, weight);
  while (last.length && total() + ellW > boxW) {
    const r = last[last.length - 1];
    r.text = r.text.slice(0, -1);
    if (!r.text) last.pop();
  }
  const tail = last[last.length - 1];
  if (tail) tail.text = tail.text.trimEnd() + ell;
  else last.push({ text: ell });
  return kept;
}

export const LINE_HEIGHT = 1.35;
const STICKY_LINK_FILL =
  "color-mix(in oklch, var(--wr-board-accent) 45%, var(--wr-board-sticky-ink))";
export const STICKY_FONT_MAX = 22;
export const STICKY_FONT_MIN = 11;

/** Font ascent and descent as fractions of the size, measured once. */
let fontMetrics: { ascent: number; descent: number } | null = null;

function metrics(): { ascent: number; descent: number } {
  if (fontMetrics) return fontMetrics;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const m = measureCtx
    ? ((measureCtx.font = `400 100px ${BOARD_FONT}`), measureCtx.measureText("Hg"))
    : null;
  fontMetrics =
    m && m.fontBoundingBoxAscent > 0
      ? { ascent: m.fontBoundingBoxAscent / 100, descent: m.fontBoundingBoxDescent / 100 }
      : { ascent: 0.8, descent: 0.2 };
  return fontMetrics;
}

/** Alphabetic baseline of a line whose box starts at `lineTop`, placed the
 *  way CSS places it (half-leading above the ascent). Matching CSS is the
 *  point: the in-place editor is a textarea, so drawn and edited text now sit
 *  on the same pixel. SVG's `central` baseline put glyphs ~8px higher. */
export function baselineIn(lineTop: number, size: number): number {
  const { ascent, descent } = metrics();
  return lineTop + (size * LINE_HEIGHT - size * (ascent + descent)) / 2 + size * ascent;
}

/**
 * `y` is the top of the first line box; lines are `size × LINE_HEIGHT` apart,
 * the in-place editor's line height.
 */
function appendLines(
  parent: SVGElement,
  lines: RichLine[],
  opts: {
    x: number;
    y: number;
    size: number;
    align: "l" | "c" | "r";
    fill: string;
    weight?: number;
    /** `[[link]]` colour; the accent unless the background needs another. */
    linkFill?: string;
  },
): SVGTextElement {
  const anchor = opts.align === "c" ? "middle" : opts.align === "r" ? "end" : "start";
  const lineH = opts.size * LINE_HEIGHT;
  const text = svgEl("text", {
    x: opts.x,
    y: baselineIn(opts.y, opts.size),
    "font-size": opts.size,
    "font-family": BOARD_FONT,
    "font-weight": opts.weight ?? 400,
    fill: opts.fill,
    "text-anchor": anchor,
    "xml:space": "preserve",
  });
  const base = opts.weight ?? 400;
  lines.forEach((line, i) => {
    // One absolutely placed tspan per line (a text chunk, so text-anchor
    // aligns the whole line), holding one tspan per styled run.
    const tspan = svgEl("tspan", { x: opts.x, dy: i === 0 ? 0 : lineH });
    if (!line.length) tspan.textContent = " ";
    for (const run of line) {
      if (!run.b && !run.i && run.ln === undefined) {
        tspan.append(run.text);
        continue;
      }
      const styled = svgEl("tspan");
      if (run.b) styled.setAttribute("font-weight", String(Math.max(BOLD_WEIGHT, base)));
      if (run.i) styled.setAttribute("font-style", "italic");
      if (run.ln !== undefined) {
        // Styled by attribute, not board.css, so the saved `.board.svg` shows
        // links too. `data-wiki` is what a click reads back (`linkAt`).
        styled.setAttribute("class", "wr-board-wiki");
        styled.setAttribute("fill", opts.linkFill ?? "var(--wr-board-accent)");
        styled.setAttribute("text-decoration", "underline");
        styled.setAttribute("data-wiki", run.ln);
      }
      styled.textContent = run.text;
      tspan.append(styled);
    }
    text.append(tspan);
  });
  parent.append(text);
  return text;
}

/** Top of a block of `lines` centred vertically in `h`, never above `pad`. */
export function centredTop(h: number, lines: number, size: number, pad: number): number {
  return Math.max((h - lines * size * LINE_HEIGHT) / 2, pad);
}

/* ---------------------------------------------------------------- element */

export interface RenderContext {
  /** Turns a document-relative image path into something the webview can load. */
  resolveSrc: (src: string) => string;
  scene: BoardScene;
  /** Set by `SceneRenderer` for its pass; one-off renders scan instead. */
  look?: SceneLookup;
}

function renderShape(g: SVGGElement, el: ShapeEl): void {
  const fill = colorVar(el.st.f);
  const stroke = colorVar(el.st.s);
  let node: SVGElement;
  if (el.t === "ellipse") {
    node = svgEl("ellipse", {
      cx: el.w / 2,
      cy: el.h / 2,
      rx: Math.max(el.w / 2, 0),
      ry: Math.max(el.h / 2, 0),
    });
  } else if (el.t === "rect" || el.t === "roundRect") {
    node = svgEl("rect", {
      x: 0,
      y: 0,
      width: Math.max(el.w, 0),
      height: Math.max(el.h, 0),
      rx: el.t === "roundRect" ? Math.min(el.st.r, el.w / 2, el.h / 2) : 0,
    });
  } else {
    node = svgEl("path", { d: svgOutlinePath(el), "stroke-linejoin": "round" });
  }
  node.setAttribute("fill", fill);
  node.setAttribute("stroke", stroke);
  node.setAttribute("stroke-width", String(el.st.w));
  const dash = dashArray(el.st);
  if (dash) node.setAttribute("stroke-dasharray", dash);
  g.append(node);

  const label = shapeLabel(el);
  if (label && el.lb) {
    const fill = colorVar(el.lb.c ?? "ink");
    appendLines(g, label.lines, {
      x: el.lb.al === "c" ? el.w / 2 : el.lb.al === "r" ? el.w - SHAPE_PAD : SHAPE_PAD,
      y: label.top,
      size: label.size,
      align: el.lb.al,
      fill,
      // A whole-label link (`ln`) keeps the label's colour: the underline
      // alone marks it, where an all-accent label would shout.
      linkFill: el.ln ? fill : undefined,
    });
    if (label.caret) g.append(caretNode(el, label.caret));
  }
  if (el.ln) appendPinBadge(g, el.w, el.ln);
}

/** A video pin's badge on the element's top-right corner: the pin, with the
 *  moment as its tooltip; a click plays it (`data-wiki`, read by `linkAt`).
 *  Styled by attribute so the saved `.board.svg` shows it too. */
function appendPinBadge(g: SVGGElement, width: number, ln: string): void {
  const link = parseVideoLink(ln);
  if (!link) return;
  const badge = svgEl("g", {
    class: "wr-board-pin",
    "data-wiki": ln,
    transform: `translate(${width} 0)`,
  });
  const title = svgEl("title");
  title.textContent = `Play from ${formatVideoTime(link.seconds)}`;
  badge.append(
    title,
    svgEl("circle", {
      r: 10,
      fill: "var(--wr-board-surface)",
      stroke: "var(--wr-board-accent)",
      "stroke-width": 1.25,
    }),
    svgEl("path", {
      d: PIN_ICON_PATH,
      transform: "translate(-6 -6) scale(0.5)",
      fill: "none",
      stroke: "var(--wr-board-accent)",
      "stroke-width": 2.25,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  g.append(badge);
}

/* ------------------------------------------------- shape label truncation */

const SHAPE_PAD = 10;
/** Smallest a shape's label shrinks to before it is cut off instead. */
export const SHAPE_FONT_MIN = 11;
/** Room kept at the bottom of the box for the caret. */
const CARET_ROOM = 16;
const CARET_R = 8;

export interface ShapeLabelLayout {
  size: number;
  lines: RichLine[];
  /** Top of the first line box. */
  top: number;
  /** "expand" when the text is cut off, "collapse" when the shape was grown
   *  to fit it (`ex`), otherwise null. */
  caret: "expand" | "collapse" | null;
}

/** How a shape's label is laid out: shrunk to fit, and when even the minimum
 *  size overflows, cut to the lines that fit with an ellipsis and a caret.
 *  The renderer draws this and the canvas hit-tests the same caret. */
export function shapeLabel(el: ShapeEl): ShapeLabelLayout | null {
  const layout = shapeLabelLayout(el);
  // A linked shape (`ln`) is a link all over: every run carries it, so it
  // draws and clicks like a `[[link]]` in the text.
  // A video pin is the corner badge's, not the label's: the text stays text.
  if (layout && el.ln && !parseVideoLink(el.ln)) {
    const ln = el.ln;
    layout.lines = layout.lines.map((line) => line.map((run) => ({ ...run, ln })));
  }
  return layout;
}

function shapeLabelLayout(el: ShapeEl): ShapeLabelLayout | null {
  if (!el.lb?.tx) return null;
  const boxW = Math.max(el.w - SHAPE_PAD * 2, 20);
  const room = el.ex ? CARET_ROOM : 0;
  const boxH = Math.max(el.h - SHAPE_PAD * 2 - room, 16);
  const fit = fitFontSize(el.lb.tx, boxW, boxH, el.lb.sz, Math.min(SHAPE_FONT_MIN, el.lb.sz));
  if (fit.fits) {
    return {
      size: fit.size,
      lines: fit.lines,
      top: centredTop(el.h - room, fit.lines.length, fit.size, SHAPE_PAD),
      caret: el.ex ? "collapse" : null,
    };
  }
  const lineH = fit.size * LINE_HEIGHT;
  const max = Math.max(1, Math.floor((el.h - SHAPE_PAD * 2 - CARET_ROOM) / lineH));
  const lines = truncateLines(fit.lines, max, fit.size, boxW);
  return {
    size: fit.size,
    lines,
    top: centredTop(el.h - CARET_ROOM, lines.length, fit.size, SHAPE_PAD),
    caret: "expand",
  };
}

/** Height that shows the whole label at its own size, with the caret row. */
export function shapeFitHeight(el: ShapeEl): number {
  if (!el.lb?.tx) return el.h;
  const lines = wrapRich(el.lb.tx, el.lb.sz, Math.max(el.w - SHAPE_PAD * 2, 20));
  return Math.ceil(lines.length * el.lb.sz * LINE_HEIGHT + SHAPE_PAD * 2 + CARET_ROOM);
}

/** Caret centre in the shape's own (unrotated) frame. */
function caretCentre(el: ShapeEl): Point {
  return { x: el.w / 2, y: el.h - CARET_ROOM / 2 - 2 };
}

/** Whether scene point `p` is on the shape's caret. */
export function hitShapeCaret(el: ShapeEl, p: Point, slop = 0): boolean {
  const label = shapeLabel(el);
  if (!label?.caret) return false;
  // Into the shape's frame: undo the rotation about its centre.
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const cos = Math.cos(-el.a);
  const sin = Math.sin(-el.a);
  const lx = (p.x - cx) * cos - (p.y - cy) * sin + el.w / 2;
  const ly = (p.x - cx) * sin + (p.y - cy) * cos + el.h / 2;
  const c = caretCentre(el);
  return Math.hypot(lx - c.x, ly - c.y) <= CARET_R + 2 + slop;
}

function caretNode(el: ShapeEl, kind: "expand" | "collapse"): SVGGElement {
  const c = caretCentre(el);
  const g = svgEl("g", { class: "wr-board-expand", transform: `translate(${c.x} ${c.y})` });
  g.append(
    svgEl("circle", {
      r: CARET_R,
      fill: "var(--wr-board-surface)",
      stroke: "var(--wr-board-muted)",
      "stroke-opacity": 0.35,
      "stroke-width": 1,
    }),
    svgEl("path", {
      d: kind === "expand" ? "M-3.5 -1.5 L0 2 L3.5 -1.5" : "M-3.5 1.5 L0 -2 L3.5 1.5",
      fill: "none",
      stroke: "var(--wr-board-muted)",
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return g;
}

function renderMind(g: SVGGElement, el: MindEl, ctx: RenderContext): void {
  const depth = mindDepth(ctx.scene, el, ctx.look);
  const parent = mindParent(ctx.scene, el, ctx.look);
  const branch = colorVar(branchColor(ctx.scene, el, ctx.look));
  if (parent) {
    // The group is translated to the topic; the branch is drawn in its frame.
    const local = (b: BoardEl) => ({ ...b, x: b.x - el.x, y: b.y - el.y });
    g.append(
      svgEl("path", {
        d: mindBranchPath(local(parent), local(el)),
        fill: "none",
        stroke: branch,
        "stroke-width": depth === 1 ? 2.5 : 1.75,
        "stroke-linecap": "round",
      }),
    );
  }
  g.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: Math.max(el.w, 0),
      height: Math.max(el.h, 0),
      rx: depth === 0 ? 12 : depth === 1 ? 9 : 7,
      fill: depth === 0 ? colorVar("ink") : "var(--wr-board-surface)",
      stroke: depth === 0 ? "none" : branch,
      "stroke-width": depth === 1 ? 2 : 1.25,
    }),
  );
  const size = mindFontSize(depth);
  const lines = (el.tx || " ").split("\n").map((p) => parseInline(p));
  appendLines(g, lines, {
    x: el.w / 2,
    y: centredTop(el.h, lines.length, size, 0),
    size,
    align: "c",
    fill: depth === 0 ? "var(--wr-board-surface)" : colorVar("ink"),
    weight: depth === 0 ? 600 : depth === 1 ? 500 : 400,
  });
  if (el.ln) appendPinBadge(g, el.w, el.ln);
}

function renderDraw(g: SVGGElement, el: DrawEl): void {
  const ext = strokeExtent(el.pts);
  const path = svgEl("path", {
    d: smoothPath(el.pts),
    fill: "none",
    stroke: colorVar(el.st.s),
    "stroke-width": el.st.w,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    // Resizing scales the path, never the pen width.
    "vector-effect": "non-scaling-stroke",
  });
  const sx = ext.w > 0 ? el.w / ext.w : 1;
  const sy = ext.h > 0 ? el.h / ext.h : 1;
  if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) {
    path.setAttribute("transform", `scale(${sx} ${sy})`);
  }
  const dash = dashArray(el.st);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  g.append(path);
}

function renderSticky(g: SVGGElement, el: BoardEl & { c: string; tx: string }): void {
  g.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: STICKY_SIZE,
      height: STICKY_SIZE,
      rx: 2,
      fill: stickyVar(el.c),
      stroke: "var(--wr-board-sticky-edge)",
      "stroke-width": 1,
    }),
  );
  if (el.tx) {
    const pad = 16;
    // Lark-style: centred both ways, as large as fits — a two-word note reads
    // from across the room, a paragraph shrinks to fit.
    const box = STICKY_SIZE - pad * 2;
    const fit = fitFontSize(el.tx, box, box, STICKY_FONT_MAX, STICKY_FONT_MIN);
    const { size } = fit;
    // A note has a fixed size, so text that overflows even the smallest size
    // is cut off with an ellipsis (no caret: the note cannot grow).
    const lines = fit.fits
      ? fit.lines
      : truncateLines(fit.lines, Math.floor(box / (size * LINE_HEIGHT)), size, box);
    appendLines(g, lines, {
      x: STICKY_SIZE / 2,
      y: centredTop(STICKY_SIZE, lines.length, size, pad),
      size,
      align: "c",
      fill: "var(--wr-board-sticky-ink)",
      // Notes stay pastel in dark mode too, where the accent turns light.
      linkFill: STICKY_LINK_FILL,
    });
  }
}

function renderText(
  g: SVGGElement,
  el: BoardEl & { tx: string; sz: number; al: "l" | "c" | "r"; c: ColorToken },
): void {
  const lines = wrapRich(el.tx || "", el.sz, Math.max(el.w, 20));
  appendLines(g, lines, {
    x: el.al === "c" ? el.w / 2 : el.al === "r" ? el.w : 0,
    y: 0,
    size: el.sz,
    align: el.al,
    fill: colorVar(el.c),
  });
}

function renderImage(
  g: SVGGElement,
  el: BoardEl & { src: string; alt?: string },
  ctx: RenderContext,
): void {
  const img = svgEl("image", {
    x: 0,
    y: 0,
    width: Math.max(el.w, 0),
    height: Math.max(el.h, 0),
    preserveAspectRatio: "xMidYMid slice",
  });
  img.setAttribute("href", ctx.resolveSrc(el.src));
  if (el.alt) {
    const title = svgEl("title");
    title.textContent = el.alt;
    img.append(title);
  }
  g.append(img);
}

function renderFrame(g: SVGGElement, el: BoardEl & { name: string }): void {
  g.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: Math.max(el.w, 0),
      height: Math.max(el.h, 0),
      fill: "var(--wr-board-frame-bg)",
      stroke: "var(--wr-board-frame-edge)",
      "stroke-width": 1,
    }),
  );
  const label = svgEl("text", {
    x: 0,
    y: -6,
    "font-size": 14,
    "font-family": BOARD_FONT,
    fill: "var(--wr-board-muted)",
    "dominant-baseline": "auto",
  });
  label.textContent = el.name;
  label.setAttribute("data-frame-title", "1");
  g.append(label);
}

function renderLinker(g: SVGGElement, el: LinkerEl, ctx: RenderContext): void {
  const pts = routeLinker(ctx.scene, el);
  const stroke = colorVar(el.st.s);
  const path = svgEl("path", {
    d: pathD(pts, el.sh),
    fill: "none",
    stroke,
    "stroke-width": el.st.w,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  const dash = dashArray(el.st);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  g.append(path);

  for (const which of ["s", "e"] as const) {
    const kind = el.hd[which];
    if (kind === "none") continue;
    const at = which === "s" ? pts[0] : pts[pts.length - 1];
    const angle = headAngle(pts, which);
    g.append(arrowHead(kind, at, angle, stroke, el.st.w));
  }

  if (el.lb?.tx) {
    // On a knock-out of the board colour, so the line does not run through it.
    const m = polylineMidpoint(pts);
    const lines = el.lb.tx.split("\n").map((p) => parseInline(p));
    const size = el.lb.sz;
    const w =
      Math.max(...lines.map((l) => l.reduce((n, r) => n + runWidth(r, size, 400), 0))) +
      LINKER_LABEL_PAD * 2;
    const h = lines.length * size * LINE_HEIGHT;
    g.append(
      svgEl("rect", {
        x: m.x - w / 2,
        y: m.y - h / 2,
        width: w,
        height: h,
        rx: 4,
        fill: "var(--wr-board-surface)",
      }),
    );
    appendLines(g, lines, { x: m.x, y: m.y - h / 2, size, align: "c", fill: colorVar("ink") });
  }
}

function arrowHead(
  kind: string,
  at: Point,
  angle: number,
  color: string,
  width: number,
): SVGElement {
  const size = Math.max(9, width * 5);
  const group = svgEl("g", {
    transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(${((angle * 180) / Math.PI).toFixed(1)})`,
  });
  if (kind === "dot") {
    group.append(svgEl("circle", { cx: 0, cy: 0, r: size * 0.32, fill: color }));
  } else if (kind === "line") {
    group.append(
      svgEl("path", {
        d: `M${-size} ${-size * 0.55} L0 0 L${-size} ${size * 0.55}`,
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  } else {
    group.append(
      svgEl("path", {
        d: `M0 0 L${-size} ${-size * 0.42} L${-size * 0.72} 0 L${-size} ${size * 0.42} Z`,
        fill: color,
        stroke: "none",
      }),
    );
  }
  return group;
}

function transformFor(el: BoardEl): string {
  const t = `translate(${el.x.toFixed(1)} ${el.y.toFixed(1)})`;
  if (!el.a) return t;
  const deg = ((el.a * 180) / Math.PI).toFixed(2);
  return `${t} rotate(${deg} ${(el.w / 2).toFixed(1)} ${(el.h / 2).toFixed(1)})`;
}

/** Linkers are already routed in absolute scene coordinates. */
function needsTransform(el: BoardEl): boolean {
  return !isLinker(el);
}

/** Elements whose drawing does not depend on their own position, so a move
 *  is just a new transform. Not linkers: their routes are absolute. (Mind
 *  topics qualify because their stamp is relative to the parent.) */
function movesByTransform(el: BoardEl): boolean {
  return needsTransform(el);
}

export function renderElement(el: BoardEl, ctx: RenderContext): SVGGElement {
  const g = svgEl("g", { "data-el": el.id, "data-type": el.t });
  if (needsTransform(el)) g.setAttribute("transform", transformFor(el));
  if (el.op !== 1) g.setAttribute("opacity", String(el.op));

  if (isLinker(el)) renderLinker(g, el, ctx);
  else if (el.t === "sticky") renderSticky(g, el as never);
  else if (el.t === "text") renderText(g, el as never);
  else if (el.t === "image") renderImage(g, el as never, ctx);
  else if (el.t === "frame") renderFrame(g, el as never);
  else if (el.t === "mind") renderMind(g, el, ctx);
  else if (el.t === "draw") renderDraw(g, el);
  else if (isShape(el)) renderShape(g, el);
  return g;
}

/* ------------------------------------------------------------ reconciler */

export class SceneRenderer {
  private nodes = new Map<string, SVGGElement>();
  private stamps = new Map<string, string>();
  /** Last x/y per element, for the move-only fast path. */
  private places = new Map<string, string>();

  constructor(private readonly layer: SVGGElement) {}

  /**
   * Updates only `els` — the elements a gesture can change. No culling or
   * reordering pass, and no stamping of the rest of the board, so per-frame
   * cost follows what moves, not board size. Returns false when an element has
   * no node yet (e.g. dragged in from off-screen); the caller then renders all.
   */
  renderSome(scene: BoardScene, ctx: RenderContext, els: BoardEl[]): boolean {
    const pass = { ...ctx, look: sceneLookup(scene) };
    for (const el of els) {
      if (!this.nodes.has(el.id)) return false;
      this.update(el, scene, pass);
    }
    return true;
  }

  /** Re-renders or re-positions one existing-or-new node; returns it. */
  private update(
    el: BoardEl,
    scene: BoardScene,
    ctx: RenderContext & { look: SceneLookup },
  ): SVGGElement {
    // Position is kept out of the stamp where it can be: dragging a shape
    // then only rewrites its group's transform instead of rebuilding it
    // (Excalidraw's "moving never re-renders the element" rule).
    const movable = movesByTransform(el);
    const stamp = stampOf(el, scene, movable, ctx.look);
    const place = `${el.x},${el.y}`;
    const existing = this.nodes.get(el.id);
    if (!existing || this.stamps.get(el.id) !== stamp) {
      const node = renderElement(el, ctx);
      this.stamps.set(el.id, stamp);
      this.places.set(el.id, place);
      if (existing) existing.replaceWith(node);
      this.nodes.set(el.id, node);
      return node;
    }
    if (movable && this.places.get(el.id) !== place) {
      existing.setAttribute("transform", transformFor(el));
      this.places.set(el.id, place);
    }
    return existing;
  }

  /** `visible` is the culled subset; everything else is removed from the DOM. */
  render(scene: BoardScene, ctx: RenderContext, visible: BoardEl[]): void {
    const seen = new Set<string>();
    let prev: SVGGElement | null = null;
    const pass = { ...ctx, look: sceneLookup(scene) };

    for (const el of visible) {
      seen.add(el.id);
      const node = this.update(el, scene, pass);
      // Keep DOM order equal to z-order without rebuilding the layer.
      // Both locals are annotated: left to inference, `prev` and `shouldFollow`
      // resolve through each other across loop iterations and the checker gives
      // up with an implicit `any` (TS7022).
      const shouldFollow: ChildNode | null = prev ? prev.nextSibling : this.layer.firstChild;
      if (node !== shouldFollow) {
        this.layer.insertBefore(node, shouldFollow ?? null);
      }
      prev = node;
    }

    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
      this.stamps.delete(id);
      this.places.delete(id);
    }
  }

  nodeFor(id: string): SVGGElement | undefined {
    return this.nodes.get(id);
  }

  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.stamps.clear();
  }
}

/**
 * Cheap change key. A linker also depends on whatever it is bound to, so its
 * stamp folds in the bound elements' geometry — otherwise moving a shape would
 * leave its arrows stale.
 */
/** What an element's drawing depends on. With `movable`, its own position is
 *  left out (a move is then just a transform), so anything positional must be
 *  relative: a topic's branch depends on where its parent is *from it*. That
 *  is what lets a whole mind map be dragged without re-rendering a topic. */
function stampOf(el: BoardEl, scene: BoardScene, movable: boolean, look: SceneLookup): string {
  let base = JSON.stringify(movable ? { ...el, x: 0, y: 0 } : el);
  if (el.t === "mind" && el.pa) {
    // Its branch is drawn from the parent, in an inherited colour.
    const parent = look.el(el.pa);
    if (parent) {
      base += `|${parent.x - el.x},${parent.y - el.y},${parent.w},${parent.h}|${branchColor(scene, el, look)}`;
    }
  }
  if (isLinker(el)) {
    for (const b of [el.b1, el.b2]) {
      if (!b) continue;
      const target = look.el(b.el);
      if (target) base += `|${target.x},${target.y},${target.w},${target.h},${target.a}`;
    }
  }
  return base;
}
