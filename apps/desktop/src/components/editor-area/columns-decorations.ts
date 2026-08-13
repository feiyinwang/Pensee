import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import {
  GFM,
  type BlockContext,
  type BlockParser,
  type Line,
  type MarkdownConfig,
} from "@lezer/markdown";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  codeBlockDecorationsExtension,
  defaultFoldableSyntaxExtensions,
  defaultHideExtensions,
  fixedTabWidthExtension,
  foldableSyntaxFacet,
  listExtension,
  platformDeleteKeymap,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownFormattingKeymap,
  prosemarkMarkdownSyntaxExtensions,
  revealBlockOnArrowExtension,
} from "@/lib/prosemark-core/main";
import { attachStableImageHeight } from "@/lib/prosemark-core/fold/image";
import { formatMarkdownDestination } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import { renderMath } from "./math-renderer";
import "./columns.css";

/**
 * Columns — `<div class="wr-row">` blocks holding N `<div class="wr-col">`
 * cells side by side. A cell holds *any* markdown: a paragraph, a list, a
 * heading, a code fence, an image, an image plus its caption.
 *
 * ## Why the source looks like this
 *
 * ```
 * <div class="wr-row" style="display:flex;flex-wrap:wrap;gap:16px">
 * <div class="wr-col" style="flex:1 1 0;min-width:150px">
 *
 * ![](assets/a.png)
 *
 * - caption bullets
 * - $O(n)$ math
 *
 * </div>
 * </div>
 * ```
 *
 * The blank line after the opening tag is load-bearing. CommonMark ends an
 * HTML block at a blank line, so in *other* renderers (GitHub, Obsidian)
 * everything after it is parsed as markdown again and the content keeps its
 * lists, headings and math. Our own parser deliberately swallows those blank
 * lines so a row stays a single node here, and the widget renders the inner
 * markdown itself.
 *
 * Invariant: **a row always has ≥ 2 columns.** Dropping a block into empty
 * space gives you a plain block, not a one-column row; pulling a column out of
 * a two-column row unwraps the survivor back into a plain block. Nothing in
 * the document is ever wrapped without earning it.
 *
 * ## Anti-jitter contract — do not "simplify" these
 *
 *  1. The drop slot's size is set once; only its opacity animates. Animating
 *     its width moves neighbours under layout *and* under FLIP at the same
 *     time — two fights, one visible shake.
 *  2. Hit-testing inside a row reads {@link LAYOUT}, a cache of rects measured
 *     with transforms zeroed. `getBoundingClientRect()` includes in-flight FLIP
 *     transforms, so reading it live makes centre lines sweep under a
 *     motionless cursor and the target flip-flops every frame. This one only
 *     shows up with three or more columns.
 *  3. Crossing a centre line needs {@link HYSTERESIS} px of overshoot and
 *     leaving a row needs {@link ROW_KEEP} px, so a resting hand never
 *     re-targets.
 *  4. Every image's pixel height is frozen for the duration of a drag. Slots
 *     opening changes neighbours' widths; with a free aspect ratio that would
 *     change row *heights* and every target below would drift vertically.
 *  5. Targets outside a row are drawn as a thin overlay bar, never as a
 *     full-height slot in the flow: a full-height slot shoves the document by
 *     ~200px and the block you were aiming at runs away from the cursor. (It
 *     also keeps us out of `contentDOM`, which CodeMirror's DOM observer would
 *     read as an edit.)
 */

/* ------------------------------------------------------------------- model */

export interface Column {
  /** Raw markdown for this cell. Anything a block can be. */
  md: string;
  grow: number;
}

const ROW_OPEN = /^[ \t]*<div\b[^>]*\bclass\s*=\s*["'][^"']*\bwr-row\b/i;
/** `<div class="wr-col">` is what we write. `<figure>` is accepted for rows
 *  written by the first version of this feature. */
const CELL_RE =
  /<(?:div\b[^>]*\bclass\s*=\s*["'][^"']*\bwr-col\b[^>]*|figure\b[^>]*)>([\s\S]*?)<\/(?:div|figure)\s*>/gi;
const CELL_ATTRS_RE = /<(?:div\b([^>]*\bclass\s*=\s*["'][^"']*\bwr-col\b[^>]*)|figure\b([^>]*))>/i;
const GROW_RE = /flex\s*:\s*([0-9]*\.?[0-9]+)/i;

function fmtGrow(n: number): string {
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

const IMAGE_BLOCK = /^!\[[^\]]*\]\([^)\s]+\)$/;

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
  const found = blocks.findIndex((b) => IMAGE_BLOCK.test(b));
  const at = found < 0 ? 0 : found;
  return {
    above: blocks.slice(0, at).join("\n\n"),
    anchor: blocks[at] ?? "",
    below: blocks.slice(at + 1).join("\n\n"),
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

/* ---------------------------------------------------------- markdown → HTML */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

function math(src: string, display: boolean): string {
  const res = renderMath(src, display);
  if (res.html) return res.html;
  return `<span class="wr-math-error">${escapeHtml(display ? `$$${src}$$` : `$${src}$`)}</span>`;
}

function inlineMarkdown(text: string): string {
  // Pull inline math out first, so a `*` inside a formula is never read as
  // emphasis.
  const plain = (t: string) =>
    escapeHtml(t)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

  let out = "";
  let last = 0;
  const rx = /\$([^$\n]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    out += plain(text.slice(last, m.index));
    out += math(m[1] ?? "", false);
    last = rx.lastIndex;
  }
  return out + plain(text.slice(last));
}

const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|>|```|\$\$|#{1,6}\s|---+\s*$|!\[)/;

/**
 * The block subset a column can hold: headings, paragraphs, bullet and ordered
 * lists, quotes, fences, `$$` math, standalone images, thematic breaks. Tables
 * are out — inside a 200px column they are unreadable anyway, and they render
 * as their raw pipes so nothing is lost.
 */
export function renderBlockMarkdown(src: string): string {
  const lines = String(src ?? "").split("\n");
  let out = "";
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out += `</${list}>`;
      list = null;
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }
    // thematic break
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out += "<hr>";
      i++;
      continue;
    }
    // heading
    let m = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      closeList();
      const level = (m[1] ?? "#").length;
      out += `<h${level}>${inlineMarkdown(m[2] ?? "")}</h${level}>`;
      i++;
      continue;
    }
    // standalone image on its own line
    m = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (m) {
      closeList();
      out += `<p class="wr-img"><img alt="${escapeHtml(m[1] ?? "")}" src="${escapeHtml(
        m[2] ?? "",
      )}"></p>`;
      i++;
      continue;
    }
    // display math
    if (/^\s*\$\$/.test(line)) {
      closeList();
      const trimmed = line.trim();
      if (trimmed.length > 4 && trimmed.endsWith("$$")) {
        out += math(trimmed.slice(2, -2), true);
        i++;
        continue;
      }
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/\$\$/.test(lines[i] ?? "")) buf.push(lines[i++] ?? "");
      i++;
      out += math(buf.join("\n"), true);
      continue;
    }
    // fenced code
    if (/^\s*```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) buf.push(lines[i++] ?? "");
      i++;
      out += `<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`;
      continue;
    }
    // quote
    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      out += `<blockquote>${renderBlockMarkdown(buf.join("\n"))}</blockquote>`;
      continue;
    }
    // lists
    m = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (m) {
      if (list !== "ul") {
        closeList();
        out += "<ul>";
        list = "ul";
      }
      out += `<li>${inlineMarkdown(m[1] ?? "")}</li>`;
      i++;
      continue;
    }
    m = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (m) {
      if (list !== "ol") {
        closeList();
        out += "<ol>";
        list = "ol";
      }
      out += `<li>${inlineMarkdown(m[1] ?? "")}</li>`;
      i++;
      continue;
    }
    // paragraph
    closeList();
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !BLOCK_START.test(lines[i] ?? "")) {
      buf.push(lines[i] ?? "");
      i++;
    }
    out += `<p>${inlineMarkdown(buf.join("\n"))}</p>`;
  }
  closeList();
  return out;
}

/* ------------------------------------------------------------------ parser */

/** Consumes `<div class="wr-row"> … </div>` including the blank lines inside,
 *  counting nested `<div>`s. The default Type-6 HTML block stops at the first
 *  blank line, which would split every row in half. */
const columnRowBlockParser: BlockParser = {
  name: "ColumnRowBlock",
  before: "HTMLBlock",
  parse(cx: BlockContext, line: Line) {
    if (!ROW_OPEN.test(line.text)) return false;
    const from = cx.lineStart + line.pos;
    let depth = 0;
    const count = (text: string) => {
      depth += (text.match(/<div\b/gi) ?? []).length;
      depth -= (text.match(/<\/div\s*>/gi) ?? []).length;
    };
    count(line.text);
    while (depth > 0 && cx.nextLine()) count(line.text);
    cx.nextLine();
    cx.addElement(cx.elt("ColumnRow", from, cx.prevLineEnd()));
    return true;
  },
};

export const columnsParserExtension: MarkdownConfig = {
  defineNodes: ["ColumnRow"],
  parseBlock: [columnRowBlockParser],
};

/* ------------------------------------------------- "show me the source" gate */

const revealSourceEffect = StateEffect.define<number | null>();

const revealedRowField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(revealSourceEffect)) return e.value;
    if (tr.docChanged) return null;
    return value;
  },
});

/**
 * Unfold the row under the cursor back into its raw `<div class="wr-row">` text.
 * The only thing a band editor cannot reach is the wrapper itself — the grow
 * ratios and the tag — so this stays as the escape hatch for that.
 *
 * It has no UI entry point on purpose. The button this replaced floated over
 * the corner of every row, all the time, to serve a case that comes up once a
 * month; where it belongs instead (command palette, context menu, keybinding)
 * is an open product decision.
 */
export function revealColumnSource(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const ref = rowRefAt(view, pos);
  if (!ref) return false;
  view.dispatch({
    effects: revealSourceEffect.of(ref.from),
    selection: EditorSelection.cursor(ref.from),
  });
  view.focus();
  return true;
}

/* ------------------------------------------------------------------ widget */

class ColumnRowWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly columns: Column[],
  ) {
    super();
  }

  eq(other: ColumnRowWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const row = document.createElement("div");
    row.className = "wr-row-widget";
    row.contentEditable = "false";

    // Which bands this row shows. A band nobody filled in is not rendered at
    // all — an always-present empty caption row would add height to every plain
    // two-picture row for nothing.
    const bands = this.columns.map((c) => splitBands(c.md));
    const shown = BAND_ORDER.filter(
      (name) => name === "anchor" || bands.some((b) => !!b[name].trim()),
    );
    row.dataset.wrBands = shown.join(",");
    row.style.gridTemplateRows = `repeat(${shown.length}, auto)`;

    this.columns.forEach((column, index) => {
      row.append(buildColumn(column, bands[index]!, shown, index, view));
    });
    layoutRowTracks(row);

    // No tool chrome in the corner. The `</>` button existed because a band was
    // a raw textarea you could not read while typing; bands are live markdown
    // now, so the source is already on screen. Reveal-source lives on as
    // {@link revealColumnSource}.
    return row;
  }

  ignoreEvent(): boolean {
    // MUST be false. CodeMirror's `runHandlers` walks up from the event target
    // and bails out entirely when a widget says it ignores the event — which
    // would also skip our own `EditorView.domEventHandlers`, leaving the grab
    // handle, the resize handle and the click-to-edit all inert. We stop
    // propagation ourselves in the handlers instead.
    return false;
  }
}

/**
 * One grid track per visible cell, in DOM order. Called on build, whenever the
 * drop slot appears or leaves (it is a track of its own while it is there) and
 * on resize. Tracks are `minmax(0, Gfr)`: `G` keeps exactly the meaning it has
 * in the file's `flex:G 1 0`, and a 0 minimum means a narrow editor squeezes
 * the columns instead of overflowing sideways. The 150px floor lives in
 * {@link MIN_COLUMN} — below that the row stacks instead.
 */
function layoutRowTracks(row: HTMLElement): void {
  const cells = [...row.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      (el.classList.contains("wr-col") || el.classList.contains("wr-slot")) &&
      !el.classList.contains("wr-dragging"),
  );
  const tracks: string[] = [];
  cells.forEach((el, i) => {
    el.style.gridColumn = String(i + 1);
    tracks.push(`minmax(0, ${fmtGrow(Number(el.dataset.wrGrow ?? "1"))}fr)`);
  });
  row.style.gridTemplateColumns = tracks.join(" ");
  row.dataset.wrCols = String(cells.length);
}

function buildColumn(
  column: Column,
  bands: Bands,
  shown: readonly BandName[],
  index: number,
  view: EditorView,
): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "wr-col";
  cell.dataset.wrIndex = String(index);
  cell.dataset.wrGrow = fmtGrow(column.grow);

  const grab = document.createElement("div");
  grab.className = "wr-grab";
  grab.dataset.wrHandle = "col";
  grab.setAttribute("aria-hidden", "true");
  cell.append(grab);

  if (index > 0) {
    // Lives inside the column, absolutely positioned over the gap on its left.
    // It used to be a sibling of the columns, which a grid would count as a
    // track of its own.
    const handle = document.createElement("div");
    handle.className = "wr-resize";
    handle.dataset.wrResize = String(index);
    cell.append(handle);
  }

  shown.forEach((name, i) => {
    const band = document.createElement("div");
    band.className = "wr-band";
    band.dataset.wrBand = name;
    band.style.gridRow = String(i + 1);
    paintBand(band, bands[name], name);

    // Images decode asynchronously; without a remembered height the row's
    // height jumps once each image lands and the scroll anchor slips.
    for (const img of band.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      attachStableImageHeight(img as HTMLImageElement, band, src, view);
    }
    cell.append(band);
  });

  return cell;
}

/** UI copy. The app is in English; nothing user-facing here is localised. */
const PLACEHOLDER: Record<BandName, string> = {
  anchor: "Empty column · click to write",
  above: "Write a note…",
  below: "Write a caption…",
};

function paintBand(el: HTMLElement, markdown: string, band: BandName): void {
  const text = String(markdown ?? "").trim();
  el.classList.toggle("wr-band-empty", !text);
  if (text) {
    el.innerHTML = renderBlockMarkdown(text);
    return;
  }
  // An empty anchor means the whole column is empty; an empty outer band means
  // a neighbour wrote a caption and this column has the aligned slot for one.
  el.innerHTML = `<p>${PLACEHOLDER[band]}</p>`;
}

/* -------------------------------------------------------- doc-range helpers */

interface RowRef {
  from: number;
  to: number;
  columns: Column[];
}

function rowRefAt(view: EditorView, pos: number): RowRef | null {
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(Math.min(Math.max(pos, 0), doc.length), 1);
  while (node && node.name !== "ColumnRow") node = node.parent;
  if (!node) return null;
  const columns = parseColumns(doc.sliceString(node.from, node.to));
  return columns ? { from: node.from, to: node.to, columns } : null;
}

function rowRefFromDOM(view: EditorView, rowEl: HTMLElement): RowRef | null {
  let pos: number;
  try {
    pos = view.posAtDOM(rowEl);
  } catch {
    return null;
  }
  return rowRefAt(view, pos) ?? rowRefAt(view, pos + 1);
}

/** Top-level block containing `pos` — the unit the gutter handle drags. */
export interface BlockRef {
  from: number;
  to: number;
  name: string;
}

function topBlockAt(state: EditorState, pos: number): BlockRef | null {
  const clamped = Math.min(Math.max(pos, 0), state.doc.length);
  const tree = syntaxTree(state);
  // Both sides matter. At a block's *end* boundary `resolveInner(pos, 1)` looks
  // forward and lands on the Document — so pointing past the end of a short
  // line (very easy to do: the line box spans the whole text column) would
  // report "no block here" and the drop would silently fall back to a gap.
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(clamped, side);
    while (node?.parent?.parent) node = node.parent;
    if (node?.parent) return { from: node.from, to: node.to, name: node.name };
  }
  return null; // genuinely a blank line
}

/** Text of a block, ready to become a column. */
function blockMarkdown(view: EditorView, block: BlockRef): string {
  return view.state.doc.sliceString(block.from, block.to).trim();
}

/* ----------------------------------------------------------- column editing */

/**
 * Every key pressed in here has to stay in here. The widget lives inside
 * `contentDOM` and CodeMirror's keymap listens there, so Backspace was read as
 * "delete a character of the document", Enter as "split the block" and the arrow
 * keys as "move the document cursor" — the inner editor never saw them, while
 * plain letters went through natively. That is exactly the half-working box this
 * looked like. `ignoreEvent()` cannot fix it (it has to stay `false`, or the
 * grab handle, the resize handle and click-to-edit all go inert), so the events
 * are stopped on the way out, at the host element.
 *
 * Order matters and it works out for free: the inner editor's own handlers sit
 * on its `contentDOM`, which is *inside* the host, so they have already run by
 * the time the event reaches this listener on the way up.
 */
const EDITOR_SWALLOWED_EVENTS = [
  "keydown",
  "keypress",
  "keyup",
  "beforeinput",
  "input",
  "paste",
  "cut",
  "copy",
  "dragstart",
  "drop",
  "pointerdown",
  "mousedown",
  "dblclick",
] as const;

/**
 * What a band edits with. This used to be a `<textarea>`, and that was the one
 * spot in Writer where markdown stopped being live: you typed `- `, got a
 * literal hyphen, and only saw a bullet after clicking away — which then read as
 * "the app dropped my list". A band is a piece of the document, so it gets the
 * document's editor.
 *
 * Deliberately *not* `prosemarkBasicSetup()`. That bundle is built for a
 * full-page editor and drags in a fold gutter, search, autocomplete and bracket
 * matching — a gutter alone would put a column of empty space inside a 200px
 * caption. What is kept is exactly the live-markdown layer (hide/fold, lists,
 * code fences, tab width) plus history and the formatting keymap.
 */
function bandEditorExtensions(placeholderText: string): Extension[] {
  return [
    markdown({
      codeLanguages: languages,
      extensions: [GFM, prosemarkMarkdownSyntaxExtensions],
    }),
    defaultHideExtensions,
    defaultFoldableSyntaxExtensions,
    revealBlockOnArrowExtension,
    listExtension,
    fixedTabWidthExtension,
    codeBlockDecorationsExtension,
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    placeholder(placeholderText),
    // Word- and line-wise delete. A band is a slice of body text, so every key
    // the document has, it has — and it takes them from the same shared module
    // the page editor does rather than re-listing them here.
    platformDeleteKeymap,
    keymap.of([...prosemarkMarkdownFormattingKeymap, ...defaultKeymap, ...historyKeymap]),
    prosemarkBaseThemeSetup(),
  ];
}

/**
 * Edit one band in place. Deliberately *one band*, not the whole column: a
 * column-wide editor turns the rendered picture back into `![](…)` every time
 * you fix a word in the caption. An empty band opens focused and ready to type,
 * so writing a caption is one click and no ceremony.
 */
function beginBandEdit(view: EditorView, cell: HTMLElement, bandEl: HTMLElement): void {
  if (cell.querySelector(".wr-col-edit")) return;
  const rowEl = cell.closest<HTMLElement>(".wr-row-widget");
  if (!rowEl) return;
  const ref = rowRefFromDOM(view, rowEl);
  if (!ref) return;
  const index = Number(cell.dataset.wrIndex ?? "0");
  const column = ref.columns[index];
  if (!column) return;
  const band = (bandEl.dataset.wrBand ?? "anchor") as BandName;
  const before = splitBands(column.md)[band];

  const host = document.createElement("div");
  host.className = "wr-col-edit";
  // The app draws an accent focus ring on every `:focus-visible` and opts
  // surfaces out one selector at a time. An inline editor inside body text must
  // never wear one, so it opts out by attribute — see App.css.
  host.dataset.noFocusRing = "";
  // Opts this editor out of everything `prosemark-theme.css` writes for the
  // *page* editor — text-column max width, auto margins, the 4rem side inset
  // and 40vh of bottom padding. Those rules match any nested `.cm-content`,
  // and the old override lived at the same specificity, so which one won was
  // decided by CSS import order (measured: 288px of phantom space when it
  // lost). The attribute makes the opt-out explicit and gives it the extra
  // specificity to win outright. Any future in-place editor just sets it.
  host.dataset.inlineEditor = "";
  // Keep the band's grid row, or the editor would be auto-placed into a new
  // implicit row and the whole row would jump the moment you click in.
  host.style.gridRow = bandEl.style.gridRow;
  for (const type of EDITOR_SWALLOWED_EVENTS) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
  bandEl.replaceWith(host);

  let inner: EditorView | null = null;
  let closed = false;
  const finish = (commit: boolean) => {
    if (closed) return;
    closed = true;
    const next = inner?.state.doc.toString() ?? before;
    inner?.destroy();
    inner = null;
    paintBand(bandEl, commit ? next : before, band);
    host.replaceWith(bandEl);
    if (!commit || next.trim() === before.trim()) return;
    const live = rowRefFromDOM(view, rowEl);
    if (!live || !live.columns[index]) return;
    const columns = live.columns.map((c, i) =>
      i === index ? { ...c, md: withBand(c.md, band, next) } : c,
    );
    view.dispatch({
      changes: { from: live.from, to: live.to, insert: serializeColumns(columns) },
      userEvent: "input.wr-column",
    });
  };
  // Tearing the editor down from inside one of its own key handlers means
  // `destroy()` runs while CodeMirror is still walking that event. Hand the
  // teardown to a microtask so the handler returns into a live view first.
  const close = (commit: boolean) => {
    queueMicrotask(() => {
      finish(commit);
      view.focus();
    });
    return true;
  };

  inner = new EditorView({
    parent: host,
    doc: before,
    extensions: [
      // Ahead of `defaultKeymap`, which binds Escape to "simplify selection".
      Prec.highest(
        keymap.of([
          { key: "Escape", run: () => close(false) },
          // Enter makes a new line, like any text box. Cmd/Ctrl+Enter is the way
          // out without reaching for the mouse.
          { key: "Mod-Enter", run: () => close(true) },
        ]),
      ),
      ...bandEditorExtensions(PLACEHOLDER[band]),
      // Clicking anywhere else commits, same as before. `finish` is idempotent,
      // so the blur that `destroy()` itself causes is harmless.
      EditorView.domEventHandlers({
        blur: () => {
          finish(true);
          return false;
        },
      }),
    ],
  });
  inner.focus();
  inner.dispatch({ selection: EditorSelection.cursor(inner.state.doc.length) });
}

/* -------------------------------------------------------------------- drag */

const HYSTERESIS = 16;
const ROW_KEEP = 10;
/** Fraction of the text column, on each side, that means "drop beside this
 *  block" rather than "drop above/below it". Splitting by *height* instead —
 *  the obvious first idea — gives a one-line paragraph a 7px tall target, which
 *  is unhittable; splitting by width gives ~180px on each side at any block
 *  height. */
const SIDE_FRACTION = 0.25;
const SIDE_MAX = 220;
/** Extra travel needed to flip a target that is already chosen. */
const GAP_HYSTERESIS = 8;
/** Same split, applied inside a column: the outer quarter (at most 64px, since
 *  a column is narrower than the text col) still means "a new column beside
 *  this one"; the middle means "into this column, as a band". */
const COL_SIDE_FRACTION = 0.25;
const COL_SIDE_MAX = 64;
/** Narrower than this and a column stops being worth reading side by side, so
 *  the row stacks instead. Replaces the old `min-width` + `flex-wrap` pair. */
const MIN_COLUMN = 150;
/** The paper: at most this wide on screen, at most this tall before it fades. */
const LIFT_MAX_WIDTH = 320;
const LIFT_MAX_HEIGHT = 260;
/** The "picked up off the page" nudge, on top of the shrink. */
const LIFT_LIFT = 1.03;
/** Diameter of the crumpled ball, on screen. */
const CRUMPLE_SIZE = 72;

interface LayoutRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centre: number;
  scroll: number;
}

type DragTarget =
  | { kind: "col"; rowEl: HTMLElement; before: Element | null }
  | {
      kind: "band";
      rowEl: HTMLElement;
      index: number;
      band: BandName;
      y: number;
      left: number;
      width: number;
    }
  | { kind: "block"; block: BlockRef; side: "left" | "right" }
  | { kind: "gap"; pos: number; y: number };

type DragSource =
  | { kind: "col"; rowEl: HTMLElement; index: number; md: string }
  | { kind: "block"; block: BlockRef; md: string }
  | { kind: "external"; count: number };

interface DragState {
  view: EditorView;
  source: DragSource;
  sourceEl: HTMLElement | null;
  slot: HTMLElement;
  bar: HTMLElement;
  lift: HTMLElement;
  /** Unscaled width of the lift; the paper is shrunk with a transform. */
  liftWidth: number;
  liftScale: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  lastX: number;
  lastT: number;
  tilt: number;
  /** True while the pointer is outside the editor: the sheet is crumpled into a
   *  ball and releasing there discards the block. */
  crumpled: boolean;
  /** Where the sheet was grabbed, remembered while it is a ball. */
  grip: { x: number; y: number } | null;
  target: DragTarget | null;
  raf: number;
}

let drag: DragState | null = null;
const LAYOUT = new WeakMap<Element, LayoutRect>();

const MEASURED = ".wr-col, .wr-slot";

function measured(view: EditorView): HTMLElement[] {
  return [...view.dom.querySelectorAll<HTMLElement>(MEASURED)].filter(
    (el) => !el.classList.contains("wr-dragging"),
  );
}

function cacheLayout(view: EditorView): void {
  const scroll = view.scrollDOM.scrollTop;
  // Bands are cached too — aiming inside a column needs the anchor's midline —
  // but they are deliberately *not* in MEASURED: `flip()` transforms everything
  // it measures, and a band moving on its own inside a column that is already
  // moving is the two-motions-at-once shake all over again.
  const elements = [...measured(view), ...view.dom.querySelectorAll<HTMLElement>(".wr-band")];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    LAYOUT.set(el, {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      centre: r.left + r.width / 2,
      scroll,
    });
  }
}

/** Settled layout rect, corrected for scrolling since it was cached. Never
 *  includes an in-flight FLIP transform. */
function layoutOf(view: EditorView, el: Element): LayoutRect | null {
  const c = LAYOUT.get(el);
  if (!c) return null;
  const d = c.scroll - view.scrollDOM.scrollTop;
  return { ...c, top: c.top + d, bottom: c.bottom + d };
}

/** FLIP: measure, mutate, invert, play — transforms only, never layout. */
function flip(view: EditorView, mutate: () => void): void {
  const before = measured(view);
  const first = new Map(before.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  const after = measured(view);
  for (const el of after) {
    el.style.transition = "none";
    el.style.transform = "none";
  }
  const last = new Map(after.map((el) => [el, el.getBoundingClientRect()]));
  cacheLayout(view);
  for (const el of after) {
    const f = first.get(el);
    const l = last.get(el);
    if (!f || !l) continue;
    const dx = f.left - l.left;
    const dy = f.top - l.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    el.style.willChange = "transform";
    requestAnimationFrame(() => {
      el.style.transition = "transform var(--wr-dur-move) var(--wr-ease-out)";
      el.style.transform = "translate3d(0, 0, 0)";
    });
  }
}

function clearFlip(view: EditorView): void {
  for (const el of view.dom.querySelectorAll<HTMLElement>(".wr-col")) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.willChange = "";
  }
}

function freezeImageHeights(view: EditorView): void {
  for (const img of view.dom.querySelectorAll<HTMLImageElement>("img")) {
    const h = Math.round(img.getBoundingClientRect().height);
    if (!h) continue;
    img.dataset.wrFrozen = String(h);
    img.style.height = `${h}px`;
    img.style.objectFit = "cover";
  }
}

function thawImageHeights(view: EditorView): void {
  for (const img of view.dom.querySelectorAll<HTMLImageElement>("img[data-wr-frozen]")) {
    img.style.height = "";
    img.style.objectFit = "";
    delete img.dataset.wrFrozen;
  }
}

function nextColumn(el: Element): Element | null {
  let n = el.nextElementSibling;
  while (n && !n.classList.contains("wr-col")) n = n.nextElementSibling;
  return n;
}

/* ------------------------------------------------------------- drag: start */

function startColumnDrag(view: EditorView, handle: HTMLElement, event: PointerEvent): void {
  const cell = handle.closest<HTMLElement>(".wr-col");
  const rowEl = cell?.closest<HTMLElement>(".wr-row-widget");
  if (!cell || !rowEl) return;
  const ref = rowRefFromDOM(view, rowEl);
  if (!ref) return;
  const index = Number(cell.dataset.wrIndex ?? "0");
  const column = ref.columns[index];
  if (!column) return;

  beginDrag(view, {
    source: { kind: "col", rowEl, index, md: column.md },
    sourceEl: cell,
    rect: cell.getBoundingClientRect(),
    preview: cell,
    event,
  });
}

function startBlockDrag(view: EditorView, block: BlockRef, event: PointerEvent): void {
  const from = view.coordsAtPos(block.from);
  const to = view.coordsAtPos(block.to);
  const content = view.contentDOM.getBoundingClientRect();
  if (!from || !to) return;
  const rect = new DOMRect(content.left, from.top, content.width, to.bottom - from.top);
  beginDrag(view, {
    source: { kind: "block", block, md: blockMarkdown(view, block) },
    sourceEl: null,
    rect,
    preview: null,
    event,
  });
}

function beginDrag(
  view: EditorView,
  init: {
    source: DragSource;
    sourceEl: HTMLElement | null;
    rect: DOMRect;
    preview: HTMLElement | null;
    event: PointerEvent;
  },
): void {
  const { source, sourceEl, rect, preview, event } = init;

  freezeImageHeights(view);

  const slot = document.createElement("div");
  slot.className = "wr-slot";
  slot.dataset.wrGrow = "1";
  slot.style.minHeight = `${Math.round(rect.height)}px`;

  const bar = document.createElement("div");
  bar.className = "wr-drop-bar";
  view.dom.append(bar);

  // A sheet of paper picked up off the page: keep the source's own width and
  // shrink the whole thing with a transform. Re-flowing the content into a
  // narrower box instead — which is what this used to do — makes it *taller*,
  // while the old height cap was computed as `originalHeight × widthRatio`,
  // i.e. shorter. With `overflow: hidden` on top, the text was sliced through
  // the middle of the glyphs. Never derive a height from a width ratio.
  const baseWidth = Math.max(1, rect.width);
  const scale = Math.min(1, LIFT_MAX_WIDTH / baseWidth);
  const lift = document.createElement("div");
  lift.className = "wr-lift";
  lift.style.width = `${Math.round(baseWidth)}px`;
  // Unscaled units, so the cap lands at LIFT_MAX_HEIGHT on screen. Past it the
  // paper fades out (CSS mask) rather than cutting a line in half.
  lift.style.maxHeight = `${Math.round(LIFT_MAX_HEIGHT / scale)}px`;
  if (preview) {
    lift.innerHTML = preview.innerHTML;
  } else if (source.kind === "block") {
    lift.innerHTML = renderBlockMarkdown(source.md);
  }
  document.body.append(lift);

  drag = {
    view,
    source,
    sourceEl,
    slot,
    bar,
    lift,
    liftWidth: baseWidth,
    liftScale: scale,
    height: Math.round(rect.height),
    // Grab offset survives the shrink: the spot you grabbed stays under the
    // cursor, scaled the same way the paper is.
    offsetX: (event.clientX - rect.left) * scale,
    offsetY: Math.min((event.clientY - rect.top) * scale, 60),
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastT: performance.now(),
    tilt: 0,
    crumpled: false,
    grip: null,
    target: null,
    raf: 0,
  };

  if (sourceEl && sourceEl.parentElement) {
    // The slot takes the source's place immediately, so nothing shifts on lift.
    sourceEl.classList.add("wr-dragging");
    sourceEl.parentElement.insertBefore(slot, sourceEl);
    layoutRowTracks(sourceEl.parentElement);
    cacheLayout(view);
    drag.target = {
      kind: "col",
      rowEl: sourceEl.closest<HTMLElement>(".wr-row-widget")!,
      before: nextColumn(sourceEl),
    };
    requestAnimationFrame(() => slot.classList.add("wr-slot-on"));
  } else {
    cacheLayout(view);
  }

  document.body.classList.add("wr-dragging-body");
  paintLift();
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
  window.addEventListener("keydown", onDragKey, true);
}

function paintLift(): void {
  if (!drag) return;
  // A ball is already at its final size; only a flat sheet is scaled down.
  const scale = drag.crumpled ? 1 : drag.liftScale * LIFT_LIFT;
  drag.lift.style.transform =
    `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)` +
    ` scale(${scale.toFixed(4)}) rotate(${drag.tilt.toFixed(2)}deg)`;
}

/**
 * Carry the paper out of the editor and it crumples into a ball: releasing there
 * throws the block away. Bring it back in and it flattens out again. Esc is
 * still a plain cancel and a discard is a single undo step, so this is not a
 * one-way door.
 */
function setCrumpled(state: DragState, on: boolean): void {
  if (state.crumpled === on || state.source.kind === "external") return;
  state.crumpled = on;
  const lift = state.lift;
  lift.classList.toggle("wr-lift-crumple", on);
  // The sheet's size is inline (it mirrors the source block), so the ball's is
  // too — no `!important` fight with the stylesheet. It is `position: fixed`, so
  // animating its box cannot disturb the document.
  if (on) {
    lift.style.width = `${CRUMPLE_SIZE}px`;
    lift.style.height = `${CRUMPLE_SIZE}px`;
    lift.style.maxHeight = "none";
  } else {
    lift.style.width = `${Math.round(state.liftWidth)}px`;
    lift.style.height = "";
    lift.style.maxHeight = `${Math.round(LIFT_MAX_HEIGHT / state.liftScale)}px`;
  }
  if (on) {
    // Hold the ball where the cursor is, not where the sheet happened to be
    // grabbed — a corner grip on a 72px ball looks like a bug.
    state.grip = { x: state.offsetX, y: state.offsetY };
    state.offsetX = CRUMPLE_SIZE / 2;
    state.offsetY = CRUMPLE_SIZE / 2;
  } else if (state.grip) {
    state.offsetX = state.grip.x;
    state.offsetY = state.grip.y;
  }
  paintLift();
}

function insideEditor(view: EditorView, x: number, y: number): boolean {
  const r = view.dom.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return;
  const now = performance.now();
  const dt = Math.max(1, now - drag.lastT);
  const velocity = (event.clientX - drag.lastX) / dt;
  // A sheet leans with the drag (Emil caps this at a few degrees); a ball is
  // allowed to actually tumble.
  const limit = drag.crumpled ? 14 : 4;
  drag.tilt = Math.max(-limit, Math.min(limit, drag.tilt * 0.82 + velocity * 3.2));
  drag.lastX = event.clientX;
  drag.lastT = now;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.raf) drag.raf = requestAnimationFrame(onDragFrame);
}

function sameTarget(a: DragTarget | null, b: DragTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "col" && b.kind === "col") return a.rowEl === b.rowEl && a.before === b.before;
  if (a.kind === "band" && b.kind === "band")
    return a.rowEl === b.rowEl && a.index === b.index && a.band === b.band;
  if (a.kind === "block" && b.kind === "block")
    return a.block.from === b.block.from && a.side === b.side;
  if (a.kind === "gap" && b.kind === "gap") return a.pos === b.pos;
  return false;
}

function onDragFrame(): void {
  const state = drag;
  if (!state) return;
  state.raf = 0;

  // Outside the editor there is nothing to aim at: crumple the sheet, drop every
  // hint, and let go of the target so releasing there means "discard" rather
  // than "put it back where it was".
  const out = state.source.kind !== "external" && !insideEditor(state.view, state.x, state.y);
  setCrumpled(state, out);
  if (out) {
    paintLift();
    if (state.target) {
      const parent = state.slot.parentElement;
      state.target = null;
      state.slot.remove();
      if (parent) layoutRowTracks(parent);
      cacheLayout(state.view);
    }
    state.bar.classList.remove("wr-drop-bar-on");
    return;
  }

  paintLift();
  const next = hitTest(state.view, state.x, state.y);
  if (!next || sameTarget(state.target, next)) return;

  if (next.kind === "col") {
    if (state.source.kind === "external" || state.source.kind === "block") {
      const sibling = next.rowEl.querySelector<HTMLElement>(":scope > .wr-col");
      state.height = sibling ? Math.round(sibling.getBoundingClientRect().height) : state.height;
      state.slot.style.minHeight = `${state.height}px`;
    }
    const apply = () => {
      state.target = next;
      state.bar.classList.remove("wr-drop-bar-on");
      const left = state.slot.parentElement;
      next.rowEl.insertBefore(state.slot, next.before);
      // The slot is a grid track while it is here, so both rows it touches have
      // to be re-tracked — inside `apply` so FLIP measures before and after.
      if (left && left !== next.rowEl) layoutRowTracks(left);
      layoutRowTracks(next.rowEl);
    };
    if (state.slot.isConnected) flip(state.view, apply);
    else {
      apply();
      cacheLayout(state.view);
    }
    requestAnimationFrame(() => state.slot.classList.add("wr-slot-on"));
    return;
  }

  // Outside a row, or inside a column rather than beside it: an overlay bar
  // only. Never insert into contentDOM — CM's DOM observer would read that as an
  // edit — and never shove the document.
  const apply = () => {
    state.target = next;
    const left = state.slot.parentElement;
    state.slot.remove();
    if (left) layoutRowTracks(left);
  };
  if (state.slot.isConnected) flip(state.view, apply);
  else apply();
  paintDropBar(state, next);
}

function paintDropBar(state: DragState, target: DragTarget): void {
  const view = state.view;
  const host = view.dom.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const bar = state.bar;

  if (target.kind === "block") {
    const from = view.coordsAtPos(target.block.from);
    const to = view.coordsAtPos(target.block.to);
    if (!from || !to) return;
    const x = target.side === "left" ? content.left : content.right;
    bar.classList.add("wr-drop-bar-vertical");
    bar.style.left = `${x - host.left - 2}px`;
    bar.style.top = `${from.top - host.top}px`;
    bar.style.width = "";
    bar.style.height = `${Math.max(12, to.bottom - from.top)}px`;
  } else if (target.kind === "gap") {
    bar.classList.remove("wr-drop-bar-vertical");
    bar.style.left = `${content.left - host.left}px`;
    bar.style.width = `${content.width}px`;
    bar.style.top = `${target.y - host.top - 3}px`;
    bar.style.height = "";
  } else if (target.kind === "band") {
    // Same thin bar, but only as wide as the column: that width difference is
    // the whole visual distinction between "into this column" and "between
    // blocks", so no fifth kind of indicator is needed.
    bar.classList.remove("wr-drop-bar-vertical");
    bar.style.left = `${target.left - host.left}px`;
    bar.style.width = `${target.width}px`;
    bar.style.top = `${target.y - host.top - 3}px`;
    bar.style.height = "";
  }
  bar.classList.add("wr-drop-bar-on");
}

/* -------------------------------------------------------------- drag: aim */

function hitTest(view: EditorView, x: number, y: number): DragTarget | null {
  const rows = [...view.dom.querySelectorAll<HTMLElement>(".wr-row-widget")];
  const current = drag?.target;

  // Sticky: stay in the row we're already in until the pointer leaves it by
  // ROW_KEEP. Only real rows may stick — never a container whose rect covers
  // the whole document.
  let row: HTMLElement | null = null;
  if (current?.kind === "col" && current.rowEl.isConnected) {
    const r = current.rowEl.getBoundingClientRect();
    if (y >= r.top - ROW_KEEP && y <= r.bottom + ROW_KEEP) row = current.rowEl;
  }
  if (!row) {
    row =
      rows.find((el) => {
        const r = el.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      }) ?? null;
  }
  if (row) {
    // Inside a row, the middle of a column means "into this column" — the
    // caption case — and only its outer quarters mean "a new column here".
    const into = bandTarget(view, row, x, y);
    if (into) return into;
    return { kind: "col", rowEl: row, before: slotBefore(view, row, x, y) };
  }

  // Anywhere else in the writing area: work off document positions, not DOM
  // elements — a paragraph can be several `.cm-line`s and a soft-wrapped one is
  // a single line, so element geometry lies.
  const content = view.contentDOM.getBoundingClientRect();
  const probeX = Math.min(Math.max(x, content.left + 2), content.right - 2);
  const pos = view.posAtCoords({ x: probeX, y }) ?? view.posAtCoords({ x: probeX, y }, false);
  if (pos == null) return null;
  const block = topBlockAt(view.state, pos);
  if (!block) {
    // A blank line: treat it as a gap at that line.
    const line = view.state.doc.lineAt(pos);
    const coords = view.coordsAtPos(line.from);
    return { kind: "gap", pos: line.from, y: coords ? coords.top : y };
  }
  if (drag?.source.kind === "block" && block.from === drag.source.block.from) {
    // Hovering the block being dragged — keep whatever we had.
    return current ?? null;
  }

  const from = view.coordsAtPos(block.from);
  const to = view.coordsAtPos(block.to);
  if (!from || !to) return null;
  const top = from.top;
  const bottom = to.bottom;

  // Horizontal first. The outer quarter of the text column on either side means
  // "beside this block, as a column"; the middle means "between blocks", and
  // then the block's own midline picks above vs below.
  const style = getComputedStyle(view.contentDOM);
  const textLeft = content.left + (parseFloat(style.paddingLeft) || 0);
  const textRight = content.right - (parseFloat(style.paddingRight) || 0);
  const side = Math.min(SIDE_FRACTION * Math.max(1, textRight - textLeft), SIDE_MAX);
  const wasLeft = current?.kind === "block" && current.side === "left";
  const wasRight = current?.kind === "block" && current.side === "right";
  if (x <= textLeft + side + (wasLeft ? HYSTERESIS : 0)) {
    return { kind: "block", block, side: "left" };
  }
  if (x >= textRight - side - (wasRight ? HYSTERESIS : 0)) {
    return { kind: "block", block, side: "right" };
  }
  const mid = (top + bottom) / 2;
  const wasAfter = current?.kind === "gap" && current.pos > block.from;
  const grip = Math.min(GAP_HYSTERESIS, (bottom - top) / 4);
  const bias = wasAfter ? -grip : grip;
  if (y < mid + bias) return { kind: "gap", pos: block.from, y: top };
  return { kind: "gap", pos: Math.min(block.to + 1, view.state.doc.length), y: bottom };
}

/**
 * Aim inside one column. Returns null when the pointer is in the outer quarters
 * (the caller then treats it as "a new column beside this one").
 *
 * The above/below line is the **anchor's** midline, not the column's: once a
 * column carries a long caption, its own midline sits inside that caption and
 * "drop it above the picture" would need an implausible reach upwards.
 */
function bandTarget(view: EditorView, row: HTMLElement, x: number, y: number): DragTarget | null {
  const current = drag?.target;
  const cells = [...row.querySelectorAll<HTMLElement>(":scope > .wr-col")].filter(
    (c) => c !== drag?.sourceEl,
  );
  const cell = cells.find((c) => {
    const r = layoutOf(view, c);
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (!cell) return null;
  const rect = layoutOf(view, cell);
  if (!rect) return null;
  const index = Number(cell.dataset.wrIndex ?? "0");

  // Sticky middle zone: once we are aiming into this column, leaving it needs
  // HYSTERESIS px of overshoot, exactly like every other boundary here.
  const inside =
    current?.kind === "band" && current.rowEl === row && current.index === index ? current : null;
  const side = Math.min(COL_SIDE_FRACTION * (rect.right - rect.left), COL_SIDE_MAX);
  const slack = inside ? HYSTERESIS : 0;
  if (x < rect.left + side - slack || x > rect.right - side + slack) return null;

  const anchorEl = cell.querySelector<HTMLElement>('.wr-band[data-wr-band="anchor"]');
  const anchor = (anchorEl && layoutOf(view, anchorEl)) || rect;
  const mid = (anchor.top + anchor.bottom) / 2;
  const grip = Math.min(GAP_HYSTERESIS, (anchor.bottom - anchor.top) / 4);
  const bias = inside?.band === "below" ? -grip : grip;
  const band: BandName = y < mid + bias ? "above" : "below";

  // Draw the bar at the outer edge of the band being targeted, so it reads as
  // "the text goes here", not "the text goes through the picture".
  const edge = cell.querySelector<HTMLElement>(`.wr-band[data-wr-band="${band}"]`);
  const edgeRect = edge ? layoutOf(view, edge) : null;
  const line =
    band === "above" ? (edgeRect?.top ?? anchor.top) : (edgeRect?.bottom ?? anchor.bottom);
  return {
    kind: "band",
    rowEl: row,
    index,
    band,
    y: line,
    left: rect.left,
    width: rect.right - rect.left,
  };
}

function slotBefore(view: EditorView, row: HTMLElement, x: number, y: number): Element | null {
  const cells = [...row.querySelectorAll<HTMLElement>(":scope > .wr-col")].filter(
    (c) => c !== drag?.sourceEl && layoutOf(view, c),
  );
  if (!cells.length) return null;
  const online = cells.filter((c) => {
    const r = layoutOf(view, c)!;
    return y >= r.top - 6 && y <= r.bottom + 6;
  });
  const pool = (online.length ? online : cells).sort(
    (a, b) => layoutOf(view, a)!.left - layoutOf(view, b)!.left,
  );
  const kids = [...row.children];
  const slotIndex = drag ? kids.indexOf(drag.slot) : -1;
  let before: Element | null = pool[0] ?? null;
  for (const c of pool) {
    const centre = layoutOf(view, c)!.centre;
    const slotIsAfter = slotIndex > kids.indexOf(c);
    // Already to its right → coming back needs `centre − HYSTERESIS`;
    // otherwise going past needs `centre + HYSTERESIS`.
    const threshold = slotIsAfter ? centre - HYSTERESIS : centre + HYSTERESIS;
    if (x > threshold) before = nextColumn(c);
  }
  return before;
}

/* --------------------------------------------------------------- drag: end */

function onDragKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    endDrag(true);
  }
}

function onPointerUp(): void {
  endDrag(false);
}

function endDrag(cancel: boolean): void {
  const state = drag;
  if (!state) return;
  drag = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("keydown", onDragKey, true);
  if (state.raf) cancelAnimationFrame(state.raf);

  const view = state.view;
  const discard = !cancel && state.crumpled;
  const landing = state.slot.isConnected ? state.slot.getBoundingClientRect() : null;
  if (discard) {
    // Tossed away: the ball drops out of sight. Nothing to fly back to.
    state.lift.style.transition =
      "transform 260ms var(--wr-ease-out), opacity 260ms var(--wr-ease-out)";
    state.lift.style.transform =
      `translate3d(${state.x - CRUMPLE_SIZE / 2}px, ${state.y + 90}px, 0)` +
      ` scale(0.55) rotate(${(state.tilt * 3).toFixed(2)}deg)`;
  } else if (landing) {
    // Animate the transform only — width is layout, and animating layout is what
    // the anti-jitter contract forbids. Settling means: fly to the slot, unshrink
    // to the slot's width, tilt back to 0°. No landing bounce (Emil).
    state.lift.style.transition =
      "transform 200ms var(--wr-ease-out), opacity 200ms var(--wr-ease-out)";
    const settle = landing.width / state.liftWidth;
    state.lift.style.transform =
      `translate3d(${landing.left}px, ${landing.top}px, 0)` +
      ` scale(${settle.toFixed(4)}) rotate(0deg)`;
  }
  state.lift.style.opacity = "0";
  window.setTimeout(() => state.lift.remove(), discard ? 280 : 220);

  const slotRow = state.slot.parentElement;
  state.slot.remove();
  state.bar.remove();
  state.sourceEl?.classList.remove("wr-dragging");
  // Cancelling leaves the DOM as it was found, so the tracks have to come back
  // with it — the widget is only rebuilt when a drop actually changes the text.
  const sourceRowEl = state.sourceEl?.closest<HTMLElement>(".wr-row-widget") ?? null;
  if (slotRow) layoutRowTracks(slotRow);
  if (sourceRowEl && sourceRowEl !== slotRow) layoutRowTracks(sourceRowEl);
  document.body.classList.remove("wr-dragging-body");
  thawImageHeights(view);
  clearFlip(view);

  if (discard) discardSource(view, state.source);
  else if (!cancel && state.target) commitDrop(view, state, state.target);
}

/** Released outside the editor: take the block out of the document. One
 *  dispatch, so `Cmd+Z` brings it back in one step. */
function discardSource(view: EditorView, source: DragSource): void {
  if (source.kind === "col") {
    const row = rowRefFromDOM(view, source.rowEl);
    if (!row || !row.columns[source.index]) return;
    view.dispatch({
      changes: rowAfterRemoval(row, source.index),
      userEvent: "delete.wr-column",
    });
    return;
  }
  if (source.kind === "block") {
    const live = topBlockAt(view.state, source.block.from);
    if (!live || live.from !== source.block.from) return;
    view.dispatch({
      changes: { from: live.from, to: eatNewline(view, live.to), insert: "" },
      userEvent: "delete.wr-block",
    });
  }
}

/* ------------------------------------------------------------------ commit */

interface ResolvedTarget {
  row?: { ref: RowRef; index: number };
  band?: { ref: RowRef; index: number; band: BandName };
  block?: { ref: BlockRef; side: "left" | "right" };
  gap?: number;
}

function resolveTarget(
  view: EditorView,
  target: DragTarget,
  exclude: HTMLElement | null,
): ResolvedTarget | null {
  if (target.kind === "col") {
    const ref = rowRefFromDOM(view, target.rowEl);
    if (!ref) return null;
    const cells = [...target.rowEl.querySelectorAll<HTMLElement>(":scope > .wr-col")].filter(
      (c) => c !== exclude,
    );
    const idx = target.before ? cells.indexOf(target.before as HTMLElement) : -1;
    return { row: { ref, index: idx < 0 ? cells.length : idx } };
  }
  if (target.kind === "band") {
    const ref = rowRefFromDOM(view, target.rowEl);
    if (!ref || !ref.columns[target.index]) return null;
    return { band: { ref, index: target.index, band: target.band } };
  }
  if (target.kind === "block") {
    // Re-resolve from the document so a stale rect can never write at the
    // wrong offset.
    const live = topBlockAt(view.state, target.block.from);
    if (!live || live.from !== target.block.from) return null;
    return { block: { ref: live, side: target.side } };
  }
  return { gap: Math.min(Math.max(target.pos, 0), view.state.doc.length) };
}

/** Build the insert for an already-resolved target. Shared by every drop path
 *  so they can never disagree about what "here" means. */
function insertionChange(
  resolved: ResolvedTarget,
  incoming: Column[],
): { from: number; to: number; insert: string } | null {
  if (!incoming.length) return null;
  if (resolved.row) {
    const next = resolved.row.ref.columns.slice();
    next.splice(Math.max(0, Math.min(resolved.row.index, next.length)), 0, ...incoming);
    return { from: resolved.row.ref.from, to: resolved.row.ref.to, insert: serializeColumns(next) };
  }
  if (resolved.band) {
    const { ref, index, band } = resolved.band;
    const md = incoming
      .map((c) => c.md.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!md) return null;
    const next = ref.columns.map((c, i) =>
      i === index ? { ...c, md: appendToBand(c.md, band, md) } : c,
    );
    return { from: ref.from, to: ref.to, insert: serializeColumns(next) };
  }
  // The "beside a block" case needs that block's own text, which only the view
  // can supply — see `blockInsertion`.
  if (resolved.block) return null;
  // The gap case needs the document to decide how many newlines to add — see
  // `gapInsertion`.
  return null;
}

/** Insert at a blank-line boundary. Both gap positions we produce are line
 *  starts, so the text after us is fine with a trailing blank line; the text
 *  *before* us is only separated by a single newline, and gluing two paragraphs
 *  with one newline makes markdown read them as one block. */
function gapInsertion(
  view: EditorView,
  pos: number,
  incoming: Column[],
): { from: number; to: number; insert: string } {
  const doc = view.state.doc;
  const md = incoming.map((c) => c.md.trim()).join("\n\n");
  const prevLineHasText = pos > 0 && doc.lineAt(Math.max(0, pos - 1)).text.trim() !== "";
  return { from: pos, to: pos, insert: `${prevLineHasText ? "\n" : ""}${md}\n\n` };
}

/** The block case needs the block's own markdown, which only the view can
 *  supply — kept separate so `insertionChange` stays pure. */
function blockInsertion(
  view: EditorView,
  resolved: ResolvedTarget,
  incoming: Column[],
): { from: number; to: number; insert: string } | null {
  if (!resolved.block || !incoming.length) return null;
  const own: Column = { md: blockMarkdown(view, resolved.block.ref), grow: 1 };
  const columns = resolved.block.side === "left" ? [...incoming, own] : [own, ...incoming];
  return {
    from: resolved.block.ref.from,
    to: resolved.block.ref.to,
    insert: serializeColumns(columns),
  };
}

function targetInsertion(
  view: EditorView,
  resolved: ResolvedTarget,
  incoming: Column[],
): { from: number; to: number; insert: string } | null {
  if (resolved.block) return blockInsertion(view, resolved, incoming);
  if (resolved.gap !== undefined) return gapInsertion(view, resolved.gap, incoming);
  return insertionChange(resolved, incoming);
}

function eatNewline(view: EditorView, to: number): number {
  const doc = view.state.doc;
  let end = to;
  while (end < doc.length && doc.sliceString(end, end + 1) === "\n") end++;
  return end;
}

/** Removing a column may leave a single survivor. A one-column row is not a
 *  row — unwrap it back into a plain block. */
function rowAfterRemoval(ref: RowRef, index: number): { from: number; to: number; insert: string } {
  const rest = ref.columns.filter((_, i) => i !== index);
  if (rest.length >= 2) {
    return { from: ref.from, to: ref.to, insert: serializeColumns(rest) };
  }
  return { from: ref.from, to: ref.to, insert: (rest[0]?.md ?? "").trim() };
}

function commitDrop(view: EditorView, state: DragState, target: DragTarget): void {
  const source = state.source;
  if (source.kind === "external") return; // the file-drop controller owns that

  const incoming: Column[] = [{ md: source.md, grow: 1 }];
  const sourceRow = source.kind === "col" ? rowRefFromDOM(view, source.rowEl) : null;
  if (source.kind === "col" && !sourceRow) return;

  const resolved = resolveTarget(view, target, state.sourceEl);
  if (!resolved) return;

  // --- a column dropped into a band of its own row: merge, then drop the empty
  // column. Two columns merging into one leaves a single survivor, and a
  // one-column row is not a row — unwrap it, same invariant as everywhere else.
  if (source.kind === "col" && sourceRow && resolved.band?.ref.from === sourceRow.from) {
    const { index, band } = resolved.band;
    if (index === source.index) return; // into itself
    const columns = sourceRow.columns.slice();
    const into = columns[index];
    if (!into) return;
    columns[index] = { ...into, md: appendToBand(into.md, band, source.md) };
    columns.splice(source.index, 1);
    view.dispatch({
      changes: {
        from: sourceRow.from,
        to: sourceRow.to,
        insert: columns.length >= 2 ? serializeColumns(columns) : (columns[0]?.md ?? "").trim(),
      },
      userEvent: "move.wr-column",
    });
    return;
  }

  // --- same row: one rewrite covers removal and insertion
  if (source.kind === "col" && sourceRow && resolved.row?.ref.from === sourceRow.from) {
    const columns = sourceRow.columns.slice();
    const [moved] = columns.splice(source.index, 1);
    if (!moved) return;
    const index = Math.max(0, Math.min(resolved.row.index, columns.length));
    columns.splice(index, 0, moved);
    if (columns.every((c, i) => c === sourceRow.columns[i])) return;
    view.dispatch({
      changes: { from: sourceRow.from, to: sourceRow.to, insert: serializeColumns(columns) },
      userEvent: "move.wr-column",
    });
    return;
  }

  const changes: { from: number; to: number; insert: string }[] = [];

  // --- remove the source
  if (source.kind === "col" && sourceRow) {
    changes.push(rowAfterRemoval(sourceRow, source.index));
  } else if (source.kind === "block") {
    const live = topBlockAt(view.state, source.block.from);
    if (!live || live.from !== source.block.from) return;
    changes.push({ from: live.from, to: eatNewline(view, live.to), insert: "" });
  }

  // --- insert at the target
  const gapPos = resolved.gap;
  if (gapPos !== undefined && source.kind === "block") {
    const b = source.block;
    if (gapPos >= b.from && gapPos <= b.to + 1) return; // dropped onto itself
  }
  const insertion = targetInsertion(view, resolved, incoming);
  if (!insertion) return;
  changes.push(insertion);

  changes.sort((a, b) => a.from - b.from);
  for (let i = 1; i < changes.length; i++) {
    // Overlapping ranges would corrupt the document — bail out instead.
    if ((changes[i]?.from ?? 0) < (changes[i - 1]?.to ?? 0)) return;
  }
  view.dispatch({ changes, userEvent: "move.wr-column" });
}

/* ------------------------------------------------------------------ resize */

function startResize(view: EditorView, handle: HTMLElement, event: PointerEvent): void {
  const rowEl = handle.closest<HTMLElement>(".wr-row-widget");
  if (!rowEl) return;
  const ref = rowRefFromDOM(view, rowEl);
  if (!ref) return;
  const index = Number(handle.dataset.wrResize ?? "0");
  // The handle sits inside the column on its right; the pair being resized is
  // that column and its previous sibling.
  const rightEl = handle.closest<HTMLElement>(".wr-col");
  const leftEl = rightEl?.previousElementSibling as HTMLElement | null;
  const left = ref.columns[index - 1];
  const right = ref.columns[index];
  if (!leftEl?.classList.contains("wr-col") || !rightEl || !left || !right) return;

  const startLeft = leftEl.getBoundingClientRect().width;
  const startRight = rightEl.getBoundingClientRect().width;
  const total = left.grow + right.grow;
  const startX = event.clientX;
  handle.classList.add("wr-resize-active");
  document.body.classList.add("wr-resizing-body");

  let nextLeft = left.grow;
  let nextRight = right.grow;

  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    // The floor used to come from CSS `min-width`; grid tracks are `minmax(0,
    // …)` so it is enforced here instead.
    const l = Math.max(MIN_COLUMN, startLeft + dx);
    const r = Math.max(MIN_COLUMN, startRight - dx);
    nextLeft = Math.round(((total * l) / (l + r)) * 100) / 100;
    nextRight = Math.round((total - nextLeft) * 100) / 100;
    leftEl.dataset.wrGrow = fmtGrow(nextLeft);
    rightEl.dataset.wrGrow = fmtGrow(nextRight);
    layoutRowTracks(rowEl);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    handle.classList.remove("wr-resize-active");
    document.body.classList.remove("wr-resizing-body");
    const live = rowRefFromDOM(view, rowEl);
    if (!live || !live.columns[index]) return;
    const columns = live.columns.map((c, i) =>
      i === index - 1 ? { ...c, grow: nextLeft } : i === index ? { ...c, grow: nextRight } : c,
    );
    view.dispatch({
      changes: { from: live.from, to: live.to, insert: serializeColumns(columns) },
      userEvent: "input.wr-resize",
    });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/* ------------------------------------------------------------ gutter handle */

/** A Notion-style handle that follows the pointer down the left margin. It
 *  lives outside `contentDOM` (CodeMirror would treat DOM there as an edit)
 *  and is positioned from document coordinates, so it works for a block that
 *  spans several lines as well as a soft-wrapped one that spans none. */
const gutterHandlePlugin = ViewPlugin.fromClass(
  class {
    readonly handle: HTMLElement;
    block: BlockRef | null = null;
    private readonly onMove: (e: MouseEvent) => void;
    private readonly onLeave: () => void;
    private readonly onDown: (e: PointerEvent) => void;

    constructor(readonly view: EditorView) {
      this.handle = document.createElement("div");
      this.handle.className = "wr-gutter-grab";
      this.handle.dataset.wrHandle = "block";
      this.handle.setAttribute("aria-hidden", "true");
      view.dom.append(this.handle);

      this.onMove = (e: MouseEvent) => this.place(e);
      this.onLeave = () => this.hide();
      // The handle lives in `view.dom`, outside `contentDOM` — and
      // `EditorView.domEventHandlers` only ever sees `contentDOM`. So this one
      // listener has to be wired by hand or the handle is inert.
      this.onDown = (e: PointerEvent) => {
        if (e.button !== 0 || !this.block) return;
        e.preventDefault();
        e.stopPropagation();
        startBlockDrag(view, this.block, e);
      };
      view.dom.addEventListener("mousemove", this.onMove);
      view.dom.addEventListener("mouseleave", this.onLeave);
      this.handle.addEventListener("pointerdown", this.onDown);
    }

    private hide() {
      this.handle.classList.remove("wr-gutter-on");
      this.block = null;
    }

    private place(event: MouseEvent) {
      if (drag) return;
      const view = this.view;
      const content = view.contentDOM.getBoundingClientRect();
      if (event.clientY < content.top - 4) return this.hide();
      const probeX = Math.min(Math.max(event.clientX, content.left + 2), content.right - 2);
      const pos = view.posAtCoords({ x: probeX, y: event.clientY });
      if (pos == null) return this.hide();
      const block = topBlockAt(view.state, pos);
      // Rows have their own per-column handles; a row is never dragged whole.
      if (!block || block.name === "ColumnRow") return this.hide();
      const coords = view.coordsAtPos(block.from);
      if (!coords) return this.hide();
      const host = view.dom.getBoundingClientRect();
      // Sit in the left margin, measured from where the TEXT starts —
      // `contentDOM`'s rect is the padding box, so it would put the handle on
      // top of the first word. `--writer-editor-side-padding` can be as little
      // as 24px (clamp(1.5rem, 4vw, 4rem)), so fall back to flush-against-text
      // rather than overlapping.
      // Text-column left edge = contentDOM's padding box + its own padding.
      // `coords.left` is the caret rect, which sits a few px into the first
      // glyph; `content.left` is the padding box. Neither is the text edge.
      const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
      const room = content.left + padLeft - host.left;
      const left = room >= 26 ? room - 26 : Math.max(0, room - 24);
      this.handle.style.top = `${coords.top - host.top}px`;
      this.handle.style.left = `${left}px`;
      this.handle.classList.add("wr-gutter-on");
      this.block = block;
    }

    destroy() {
      this.view.dom.removeEventListener("mousemove", this.onMove);
      this.view.dom.removeEventListener("mouseleave", this.onLeave);
      this.handle.removeEventListener("pointerdown", this.onDown);
      this.handle.remove();
    }
  },
);

/* ------------------------------------------------------- narrow: stack, not wrap */

/**
 * Grid gives us band alignment for free but has a fixed number of tracks, so it
 * cannot do what `flex-wrap` did when the editor got narrow. Stacking reads
 * better than wrapping anyway (three columns folding into 2 + 1 were never
 * aligned), and this is the one measurement in the file: a width comparison on
 * resize, never a height, and never while a drag is in flight.
 */
const stackNarrowRows = ViewPlugin.fromClass(
  class {
    private readonly observer: ResizeObserver | null;

    constructor(readonly view: EditorView) {
      this.observer =
        typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.apply());
      this.observer?.observe(view.contentDOM);
      this.apply();
    }

    update() {
      this.apply();
    }

    private apply() {
      if (drag) return; // never re-layout under the cursor mid-drag
      for (const row of this.view.dom.querySelectorAll<HTMLElement>(".wr-row-widget")) {
        const count = Math.max(1, Number(row.dataset.wrCols ?? "1"));
        const width = row.getBoundingClientRect().width;
        const needed = count * MIN_COLUMN + (count - 1) * 16;
        row.classList.toggle("wr-row-stack", width > 0 && width < needed);
      }
    }

    destroy() {
      this.observer?.disconnect();
    }
  },
);

/* --------------------------------------------- dropping image files onto it */

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "heic",
  "heif",
]);

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** Copy a dropped file next to the note and hand back a column holding it.
 *  The copy happens in Rust (`import_image_file`): the webview cannot `fetch()`
 *  an `asset://` URL because the CSP has no `connect-src` and so falls back to
 *  `default-src 'self'`. */
async function importDroppedImage(notePath: string, path: string): Promise<Column | null> {
  try {
    const saved = await tauri.importImageFile(notePath, path);
    return { md: `![](${formatMarkdownDestination(saved.relative_path)})`, grow: 1 };
  } catch {
    return null;
  }
}

function startExternalDrag(view: EditorView, x: number, y: number, count: number): void {
  freezeImageHeights(view);

  const slot = document.createElement("div");
  slot.className = "wr-slot";
  slot.dataset.wrGrow = "1";
  slot.style.minHeight = "180px";

  const bar = document.createElement("div");
  bar.className = "wr-drop-bar";
  view.dom.append(bar);

  drag = {
    view,
    source: { kind: "external", count },
    sourceEl: null,
    slot,
    bar,
    // Never attached: during an OS drag the system draws the drag image.
    lift: document.createElement("div"),
    liftWidth: 1,
    liftScale: 1,
    height: 180,
    offsetX: 0,
    offsetY: 0,
    x,
    y,
    lastX: x,
    lastT: performance.now(),
    tilt: 0,
    crumpled: false,
    grip: null,
    target: null,
    raf: 0,
  };
  cacheLayout(view);
  document.body.classList.add("wr-dragging-body");
}

/** The document can move while files are being written to disk, so re-check
 *  the target still says what it said before dispatching. */
function targetStillValid(view: EditorView, resolved: ResolvedTarget): boolean {
  const doc = view.state.doc;
  const row = resolved.row?.ref ?? resolved.band?.ref;
  if (row) {
    const { from, to, columns } = row;
    if (to > doc.length) return false;
    const live = parseColumns(doc.sliceString(from, to));
    return !!live && live.length === columns.length;
  }
  if (resolved.block) {
    const live = topBlockAt(view.state, resolved.block.ref.from);
    return !!live && live.from === resolved.block.ref.from && live.to === resolved.block.ref.to;
  }
  return resolved.gap !== undefined && resolved.gap <= doc.length;
}

/**
 * `localStorage.setItem("writer.dropDebug", "1")` turns on one line of console
 * output per drag-drop event, per channel. It exists because the two channels
 * (the webview's `onDragDropEvent` and Rust's `WindowEvent::DragDrop`) may not
 * agree on units or origin, and the only way to know is to read what each one
 * actually sends — focused and unfocused, Retina and 1x. Cheap enough to leave
 * in: one `localStorage` read per event, nothing when it is off.
 */
function dropDebugEnabled(): boolean {
  try {
    return localStorage.getItem("writer.dropDebug") === "1";
  } catch {
    return false;
  }
}

function fileDropPlugin(getFilePath: () => string) {
  return ViewPlugin.fromClass(
    class {
      private unlistenWebview: (() => void) | null = null;
      private unlistenBackend: (() => void) | null = null;
      private disposed = false;
      private paths: string[] = [];
      /** Both channels can report the same drop. Second one within this window
       *  is ignored so nothing is inserted twice. */
      private lastDropAt = 0;

      constructor(readonly view: EditorView) {
        // Channel A — the webview's own drag-drop events. Gives hover feedback
        // (enter/over) as well as the drop.
        void getCurrentWebview()
          .onDragDropEvent((event) => this.handleWebview(event.payload))
          .then((unlisten) => {
            if (this.disposed) unlisten();
            else this.unlistenWebview = unlisten;
          })
          .catch(() => {});

        // Channel B — the Rust window handler, which forwards anything that
        // isn't "open this file". This is the one we know fires, so a drop
        // lands even if channel A is silent on this platform.
        void listen<{ paths?: string[]; x?: number; y?: number }>("editor:file-drop", (event) => {
          const { paths = [], x = 0, y = 0 } = event.payload ?? {};
          const images = paths.filter(isImagePath);
          if (!images.length) return;
          this.trace("backend", "drop", { x, y });
          const point = this.point({ x, y });
          if (!this.inside(point.x, point.y)) return;
          void this.commit(images, point.x, point.y);
        })
          .then((unlisten) => {
            if (this.disposed) unlisten();
            else this.unlistenBackend = unlisten;
          })
          .catch(() => {});
      }

      private owns(): boolean {
        return drag?.view === this.view && drag.source.kind === "external";
      }

      /**
       * Physical window coordinates to CSS viewport coordinates.
       *
       * Both drop channels feed this one converter, which quietly assumes they
       * report in the same unit and from the same origin — an assumption that
       * has never been checked, and the prime suspect for "the picture does not
       * land where I let go when the window was not focused" (the webview
       * channel sends no hover events until macOS activates the window, so an
       * unfocused drop is the one case that relies purely on the Rust channel).
       *
       * Deliberately unchanged until there is data: guessing an offset or
       * dropping the divide would be exactly the hardcode this project keeps
       * banning. `wrDropDebug()` below prints what each channel actually sends;
       * one drag with it on settles it.
       */
      private point(position: { x: number; y: number }) {
        const ratio = window.devicePixelRatio || 1;
        return { x: position.x / ratio, y: position.y / ratio };
      }

      /** Raw numbers for one drop, per channel. Off unless asked for. */
      private trace(channel: "webview" | "backend", type: string, raw: { x: number; y: number }) {
        if (!dropDebugEnabled()) return;
        const converted = this.point(raw);
        const rect = this.view.dom.getBoundingClientRect();
        // eslint-disable-next-line no-console
        console.log("[writer drop]", channel, type, {
          raw,
          converted,
          devicePixelRatio: window.devicePixelRatio,
          editorRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          inside: this.inside(converted.x, converted.y),
          focused: document.hasFocus(),
        });
      }

      private inside(x: number, y: number): boolean {
        const r = this.view.dom.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }

      private handleWebview(payload: {
        type: "enter" | "over" | "drop" | "leave";
        paths?: string[];
        position?: { x: number; y: number };
      }): void {
        if (payload.type === "leave") {
          if (this.owns()) endDrag(true);
          this.paths = [];
          return;
        }
        if (!payload.position) return;
        this.trace("webview", payload.type, payload.position);
        const { x, y } = this.point(payload.position);

        if (payload.type === "enter" || payload.type === "drop") {
          const seen = (payload.paths ?? []).filter(isImagePath);
          if (seen.length) this.paths = seen;
        }
        if (!this.paths.length) return;

        if (!this.inside(x, y)) {
          if (this.owns()) endDrag(true);
          if (payload.type === "drop") this.paths = [];
          return;
        }

        if (payload.type === "drop") {
          const paths = this.paths;
          this.paths = [];
          void this.commit(paths, x, y);
          return;
        }

        // hover: show the same landing indicator the internal drag uses
        if (!this.owns()) startExternalDrag(this.view, x, y, this.paths.length);
        if (!drag) return;
        drag.x = x;
        drag.y = y;
        if (!drag.raf) drag.raf = requestAnimationFrame(onDragFrame);
      }

      private async commit(paths: string[], x: number, y: number): Promise<void> {
        const now = performance.now();
        if (now - this.lastDropAt < 500) return; // the other channel got here first
        this.lastDropAt = now;

        const view = this.view;
        // The hover events may never have fired (or arrived without paths), so
        // the drop cannot rely on a target having been computed already —
        // resolve one straight from the drop coordinates.
        let target = this.owns() ? (drag?.target ?? null) : null;
        if (!target) {
          if (!this.owns()) startExternalDrag(view, x, y, paths.length);
          cacheLayout(view);
          target = hitTest(view, x, y);
        }
        const resolved = target ? resolveTarget(view, target, null) : null;
        if (this.owns()) endDrag(true);
        if (!resolved) return;

        const notePath = getFilePath();
        if (!notePath) return;
        const columns: Column[] = [];
        for (const path of paths) {
          const column = await importDroppedImage(notePath, path);
          if (column) columns.push(column);
        }
        if (this.disposed || !columns.length || !view.dom.isConnected) return;
        if (!targetStillValid(view, resolved)) return;
        const change = targetInsertion(view, resolved, columns);
        if (!change) return;
        view.dispatch({ changes: change, userEvent: "input.wr-drop" });
      }

      destroy() {
        this.disposed = true;
        if (this.owns()) endDrag(true);
        this.unlistenWebview?.();
        this.unlistenBackend?.();
        this.unlistenWebview = null;
        this.unlistenBackend = null;
      }
    },
  );
}

/* ------------------------------------------------------------- event wiring */

const columnEvents = EditorView.domEventHandlers({
  pointerdown(event, view) {
    if (event.button !== 0) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;

    const handle = target.closest<HTMLElement>("[data-wr-handle]");
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      if (handle.dataset.wrHandle === "col") startColumnDrag(view, handle, event);
      return true;
    }
    const resize = target.closest<HTMLElement>("[data-wr-resize]");
    if (resize) {
      event.preventDefault();
      event.stopPropagation();
      startResize(view, resize, event);
      return true;
    }
    const band = target.closest<HTMLElement>(".wr-band");
    const cell = band?.closest<HTMLElement>(".wr-col");
    if (band && cell) {
      event.preventDefault();
      event.stopPropagation();
      beginBandEdit(view, cell, band);
      return true;
    }
    return false;
  },
});

/* -------------------------------------------------------------- decorations */

const columnRowFold = foldableSyntaxFacet.of({
  nodePath: "ColumnRow",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node): Range<Decoration> | undefined => {
    if (state.field(revealedRowField, false) === node.from) return undefined;
    const text = state.doc.sliceString(node.from, node.to);
    const columns = parseColumns(text);
    if (!columns) return undefined;
    return Decoration.replace({
      widget: new ColumnRowWidget(text, columns),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

export function columnsDecorations(getFilePath: () => string) {
  return [
    revealedRowField,
    columnRowFold,
    columnEvents,
    gutterHandlePlugin,
    stackNarrowRows,
    fileDropPlugin(getFilePath),
  ];
}

export const __testColumns = {
  parseColumns,
  serializeColumns,
  renderBlockMarkdown,
  splitBlocks,
  splitBands,
  joinBands,
  withBand,
  appendToBand,
};
