import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { BlockContext, BlockParser, Line, MarkdownConfig } from "@lezer/markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { foldableSyntaxFacet } from "@/lib/prosemark-core/main";
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

    this.columns.forEach((column, index) => {
      if (index > 0) {
        const handle = document.createElement("div");
        handle.className = "wr-resize";
        handle.dataset.wrResize = String(index);
        row.append(handle);
      }
      row.append(buildColumn(column, index, view));
    });

    const tools = document.createElement("div");
    tools.className = "wr-row-tools";
    const source = document.createElement("button");
    source.type = "button";
    source.className = "wr-tool";
    source.title = "编辑源码";
    source.textContent = "</>";
    source.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(row);
      view.dispatch({
        effects: revealSourceEffect.of(pos),
        selection: EditorSelection.cursor(pos),
      });
      view.focus();
    });
    tools.append(source);
    row.append(tools);

    return row;
  }

  ignoreEvent(): boolean {
    // Fully interactive widget: CodeMirror should not map our pointer events
    // onto document positions.
    return true;
  }
}

function buildColumn(column: Column, index: number, view: EditorView): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "wr-col";
  cell.dataset.wrIndex = String(index);
  cell.style.flex = `${fmtGrow(column.grow)} 1 0`;

  const grab = document.createElement("div");
  grab.className = "wr-grab";
  grab.dataset.wrHandle = "col";
  grab.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "wr-col-body";
  paintColumn(body, column.md);

  // Images decode asynchronously; without a remembered height the row's height
  // jumps once each image lands and the scroll anchor slips.
  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    attachStableImageHeight(img as HTMLImageElement, body, src, view);
  }

  cell.append(grab, body);
  return cell;
}

const EMPTY_PLACEHOLDER = "空栏 · 点这里写点什么";

function paintColumn(el: HTMLElement, markdown: string): void {
  const text = markdown.trim();
  el.classList.toggle("wr-col-empty", !text);
  el.innerHTML = text ? renderBlockMarkdown(text) : `<p>${EMPTY_PLACEHOLDER}</p>`;
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
  let node: SyntaxNode | null = tree.resolveInner(clamped, 1);
  while (node?.parent?.parent) node = node.parent;
  if (!node?.parent) return null; // blank line: resolves straight to the doc
  return { from: node.from, to: node.to, name: node.name };
}

/** Text of a block, ready to become a column. */
function blockMarkdown(view: EditorView, block: BlockRef): string {
  return view.state.doc.sliceString(block.from, block.to).trim();
}

/* ----------------------------------------------------------- column editing */

function beginColumnEdit(view: EditorView, cell: HTMLElement, body: HTMLElement): void {
  if (cell.querySelector("textarea.wr-col-edit")) return;
  const rowEl = cell.closest<HTMLElement>(".wr-row-widget");
  if (!rowEl) return;
  const ref = rowRefFromDOM(view, rowEl);
  if (!ref) return;
  const index = Number(cell.dataset.wrIndex ?? "0");
  const column = ref.columns[index];
  if (!column) return;

  const area = document.createElement("textarea");
  area.className = "wr-col-edit";
  area.value = column.md;
  area.spellcheck = false;
  const fit = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  body.replaceWith(area);
  fit();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);

  let closed = false;
  const finish = (commit: boolean) => {
    if (closed) return;
    closed = true;
    const next = area.value;
    paintColumn(body, commit ? next : column.md);
    area.replaceWith(body);
    if (!commit || next === column.md) return;
    const live = rowRefFromDOM(view, rowEl);
    if (!live || !live.columns[index]) return;
    const columns = live.columns.map((c, i) => (i === index ? { ...c, md: next } : c));
    view.dispatch({
      changes: { from: live.from, to: live.to, insert: serializeColumns(columns) },
      userEvent: "input.wr-column",
    });
  };

  area.addEventListener("input", fit);
  area.addEventListener("blur", () => finish(true), { once: true });
  area.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      view.focus();
    }
  });
}

/* -------------------------------------------------------------------- drag */

const HYSTERESIS = 16;
const ROW_KEEP = 10;
/** How much of a block's height counts as "above / below it" rather than
 *  "beside it". Capped so a tall code block still has a usable side zone. */
const EDGE_ZONE = 14;

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
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  lastX: number;
  lastT: number;
  tilt: number;
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
  for (const el of measured(view)) {
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
  slot.style.minHeight = `${Math.round(rect.height)}px`;

  const bar = document.createElement("div");
  bar.className = "wr-drop-bar";
  view.dom.append(bar);

  const liftWidth = Math.min(rect.width, 320);
  const scale = rect.width ? liftWidth / rect.width : 1;
  const lift = document.createElement("div");
  lift.className = "wr-lift";
  lift.style.width = `${liftWidth}px`;
  lift.style.maxHeight = `${Math.min(Math.round(rect.height * scale), 260)}px`;
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
    height: Math.round(rect.height),
    offsetX: (event.clientX - rect.left) * scale,
    offsetY: Math.min((event.clientY - rect.top) * scale, 60),
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastT: performance.now(),
    tilt: 0,
    target: null,
    raf: 0,
  };

  if (sourceEl && sourceEl.parentElement) {
    // The slot takes the source's place immediately, so nothing shifts on lift.
    sourceEl.classList.add("wr-dragging");
    sourceEl.parentElement.insertBefore(slot, sourceEl);
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
  drag.lift.style.transform =
    `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)` +
    ` scale(1.03) rotate(${drag.tilt.toFixed(2)}deg)`;
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return;
  const now = performance.now();
  const dt = Math.max(1, now - drag.lastT);
  const velocity = (event.clientX - drag.lastX) / dt;
  drag.tilt = Math.max(-4, Math.min(4, drag.tilt * 0.82 + velocity * 3.2));
  drag.lastX = event.clientX;
  drag.lastT = now;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.raf) drag.raf = requestAnimationFrame(onDragFrame);
}

function sameTarget(a: DragTarget | null, b: DragTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "col" && b.kind === "col") return a.rowEl === b.rowEl && a.before === b.before;
  if (a.kind === "block" && b.kind === "block")
    return a.block.from === b.block.from && a.side === b.side;
  if (a.kind === "gap" && b.kind === "gap") return a.pos === b.pos;
  return false;
}

function onDragFrame(): void {
  const state = drag;
  if (!state) return;
  state.raf = 0;
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
      next.rowEl.insertBefore(state.slot, next.before);
    };
    if (state.slot.isConnected) flip(state.view, apply);
    else {
      apply();
      cacheLayout(state.view);
    }
    requestAnimationFrame(() => state.slot.classList.add("wr-slot-on"));
    return;
  }

  // Outside a row: an overlay bar only. Never insert into contentDOM — CM's
  // DOM observer would read that as an edit — and never shove the document.
  const apply = () => {
    state.target = next;
    state.slot.remove();
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
  if (row) return { kind: "col", rowEl: row, before: slotBefore(view, row, x, y) };

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
  const edge = Math.min(EDGE_ZONE, Math.max(6, (bottom - top) / 4));

  // Vertical thirds: near the top/bottom edge means "between blocks"; the
  // middle band means "beside it, as a column".
  if (y < top + edge) {
    return { kind: "gap", pos: block.from, y: top };
  }
  if (y > bottom - edge) {
    const after = Math.min(block.to + 1, view.state.doc.length);
    return { kind: "gap", pos: after, y: bottom };
  }
  const centre = (content.left + content.right) / 2;
  const wasRight = current?.kind === "block" && current.side === "right";
  const threshold = wasRight ? centre - HYSTERESIS : centre + HYSTERESIS;
  return { kind: "block", block, side: x > threshold ? "right" : "left" };
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
  const landing = state.slot.isConnected ? state.slot.getBoundingClientRect() : null;
  if (landing) {
    state.lift.style.transition =
      "transform 200ms var(--wr-ease-out), opacity 200ms var(--wr-ease-out), width 200ms var(--wr-ease-out)";
    state.lift.style.width = `${landing.width}px`;
    state.lift.style.transform = `translate3d(${landing.left}px, ${landing.top}px, 0) scale(1) rotate(0deg)`;
  }
  state.lift.style.opacity = "0";
  window.setTimeout(() => state.lift.remove(), 220);

  state.slot.remove();
  state.bar.remove();
  state.sourceEl?.classList.remove("wr-dragging");
  document.body.classList.remove("wr-dragging-body");
  thawImageHeights(view);
  clearFlip(view);

  if (!cancel && state.target) commitDrop(view, state, state.target);
}

/* ------------------------------------------------------------------ commit */

interface ResolvedTarget {
  row?: { ref: RowRef; index: number };
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
  // The "beside a block" case needs that block's own text, which only the view
  // can supply — see `blockInsertion`.
  if (resolved.block) return null;
  if (resolved.gap !== undefined) {
    const md = incoming.map((c) => c.md.trim()).join("\n\n");
    return { from: resolved.gap, to: resolved.gap, insert: `${md}\n\n` };
  }
  return null;
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
  return resolved.block
    ? blockInsertion(view, resolved, incoming)
    : insertionChange(resolved, incoming);
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
  const leftEl = handle.previousElementSibling as HTMLElement | null;
  const rightEl = handle.nextElementSibling as HTMLElement | null;
  const left = ref.columns[index - 1];
  const right = ref.columns[index];
  if (!leftEl || !rightEl || !left || !right) return;

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
    const l = Math.max(40, startLeft + dx);
    const r = Math.max(40, startRight - dx);
    nextLeft = Math.round(((total * l) / (l + r)) * 100) / 100;
    nextRight = Math.round((total - nextLeft) * 100) / 100;
    leftEl.style.flex = `${nextLeft} 1 0`;
    rightEl.style.flex = `${nextRight} 1 0`;
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

    constructor(readonly view: EditorView) {
      this.handle = document.createElement("div");
      this.handle.className = "wr-gutter-grab";
      this.handle.dataset.wrHandle = "block";
      this.handle.setAttribute("aria-hidden", "true");
      view.dom.append(this.handle);

      this.onMove = (e: MouseEvent) => this.place(e);
      this.onLeave = () => this.hide();
      view.dom.addEventListener("mousemove", this.onMove);
      view.dom.addEventListener("mouseleave", this.onLeave);
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
      this.handle.style.top = `${coords.top - host.top}px`;
      this.handle.style.left = `${Math.max(2, content.left - host.left - 26)}px`;
      this.handle.classList.add("wr-gutter-on");
      this.block = block;
    }

    destroy() {
      this.view.dom.removeEventListener("mousemove", this.onMove);
      this.view.dom.removeEventListener("mouseleave", this.onLeave);
      this.handle.remove();
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
const MAX_DROPPED_IMAGE_BYTES = 5 * 1024 * 1024;

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** Copy a dropped file next to the note and hand back a column holding it.
 *  Reads through the asset protocol rather than a filesystem plugin, so this
 *  needs no new Rust command — `save_clipboard_image` already knows where a
 *  note's images live. */
async function importDroppedImage(notePath: string, path: string): Promise<Column | null> {
  try {
    const response = await fetch(convertFileSrc(path));
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_DROPPED_IMAGE_BYTES) return null;
    const saved = await tauri.saveClipboardImage(
      notePath,
      Array.from(new Uint8Array(buffer)),
      extensionOf(path) || "png",
    );
    return { md: `![](${formatMarkdownDestination(saved.relative_path)})`, grow: 1 };
  } catch {
    return null;
  }
}

function startExternalDrag(view: EditorView, x: number, y: number, count: number): void {
  freezeImageHeights(view);

  const slot = document.createElement("div");
  slot.className = "wr-slot";
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
    height: 180,
    offsetX: 0,
    offsetY: 0,
    x,
    y,
    lastX: x,
    lastT: performance.now(),
    tilt: 0,
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
  if (resolved.row) {
    const { from, to, columns } = resolved.row.ref;
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

function fileDropPlugin(getFilePath: () => string) {
  return ViewPlugin.fromClass(
    class {
      private unlisten: (() => void) | null = null;
      private disposed = false;
      private paths: string[] = [];

      constructor(readonly view: EditorView) {
        void getCurrentWebview()
          .onDragDropEvent((event) => this.handle(event.payload))
          .then((unlisten) => {
            if (this.disposed) unlisten();
            else this.unlisten = unlisten;
          })
          .catch(() => {
            // Not running under Tauri (tests) — file drop is unavailable, every
            // other interaction still works.
          });
      }

      private owns(): boolean {
        return drag?.view === this.view && drag.source.kind === "external";
      }

      private point(position: { x: number; y: number }) {
        const ratio = window.devicePixelRatio || 1;
        return { x: position.x / ratio, y: position.y / ratio };
      }

      private inside(x: number, y: number): boolean {
        const r = this.view.dom.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }

      private handle(payload: {
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
        const { x, y } = this.point(payload.position);

        if (payload.type === "enter") {
          this.paths = (payload.paths ?? []).filter(isImagePath);
        }
        if (payload.type === "drop") {
          const dropped = (payload.paths ?? []).filter(isImagePath);
          if (dropped.length) this.paths = dropped;
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
          if (!this.owns()) startExternalDrag(this.view, x, y, paths.length);
          void this.drop(paths);
          return;
        }

        if (!this.owns()) startExternalDrag(this.view, x, y, this.paths.length);
        if (!drag) return;
        drag.x = x;
        drag.y = y;
        if (!drag.raf) drag.raf = requestAnimationFrame(onDragFrame);
      }

      private async drop(paths: string[]): Promise<void> {
        const view = this.view;
        const target = drag?.target ?? null;
        const resolved = target ? resolveTarget(view, target, null) : null;
        endDrag(true); // clears the indicator; the insert is ours to make
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
        this.unlisten?.();
        this.unlisten = null;
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
      if (handle.dataset.wrHandle === "col") {
        startColumnDrag(view, handle, event);
      } else {
        const plugin = view.plugin(gutterHandlePlugin);
        const block = plugin?.block;
        if (block) startBlockDrag(view, block, event);
      }
      return true;
    }
    const resize = target.closest<HTMLElement>("[data-wr-resize]");
    if (resize) {
      event.preventDefault();
      event.stopPropagation();
      startResize(view, resize, event);
      return true;
    }
    const body = target.closest<HTMLElement>(".wr-col-body");
    const cell = body?.closest<HTMLElement>(".wr-col");
    if (body && cell) {
      event.preventDefault();
      event.stopPropagation();
      beginColumnEdit(view, cell, body);
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
    fileDropPlugin(getFilePath),
  ];
}

export const __testColumns = {
  parseColumns,
  serializeColumns,
  renderBlockMarkdown,
};
