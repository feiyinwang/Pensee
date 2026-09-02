import { EditorSelection, type ChangeSpec, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  GFM,
  parser as markdownParser,
  type InlineContext,
  type MarkdownConfig,
} from "@lezer/markdown";
import * as emoji from "node-emoji";
import { foldableSyntaxFacet, prosemarkMarkdownSyntaxExtensions } from "@/lib/prosemark-core/main";
import { SETTINGS_SCHEMA } from "@/lib/settings-schema";
import { parseWikiLink } from "@/lib/wiki-links";
import {
  appendTableRowChange,
  enclosingTable,
  parseCells,
  tableCellChange,
  unescapeCellText,
} from "@/lib/table-cell-edit";

const fallbackMonospaceCodeFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const codeFontFamily = `var(--pm-code-font, ${fallbackMonospaceCodeFont})`;

const tableCellLineHeight = 1.4;
const tableCellVerticalPaddingEm = 1;
const tableWidgetVerticalPaddingEm = 0.5;
const tableBorderWidthPx = 1;
// Ceiling on how much width a single column may demand, at roughly half the
// editor measure. The auto table layout hands out width in proportion to each
// column's max-content, so without a ceiling one long-prose column takes
// nearly everything and its neighbours collapse toward their minimum. Capping
// the demand lets the other columns keep their natural width instead.
const tableCellMaxWidthCh = 48;

function numericSettingDefault(key: string, fallback: number): number {
  const def = SETTINGS_SCHEMA.find((entry) => entry.key === key);
  return typeof def?.default === "number" ? def.default : fallback;
}

const defaultEditorFontSizePx = numericSettingDefault("editor.font-size", 16);

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  alignments: (Alignment | undefined)[];
  rows: string[][];
}

export type TableCellInlineNode =
  | { type: "text"; text: string }
  | { type: "break" }
  | {
      type: "element";
      tag: "strong" | "em" | "code" | "s" | "span";
      className?: string;
      href?: string;
      wikiTarget?: string;
      children: TableCellInlineNode[];
    };

const tableCellWikiLinkMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91 /* [ */) return -1;

        for (let end = pos + 2; end < cx.end - 1; end++) {
          if (cx.char(end) === 92 /* \ */) {
            end++;
            continue;
          }
          if (cx.char(end) !== 93 /* ] */ || cx.char(end + 1) !== 93 /* ] */) continue;

          return cx.addElement(
            cx.elt("WikiLink", pos, end + 2, [
              cx.elt("WikiLinkMark", pos, pos + 2),
              cx.elt("WikiLinkMark", end, end + 2),
            ]),
          );
        }

        return -1;
      },
    },
  ],
};

const tableCellMarkdownParser = markdownParser.configure([
  GFM,
  prosemarkMarkdownSyntaxExtensions,
  tableCellWikiLinkMarkdownSyntaxExtension,
]);
const defaultHiddenMarkdownMarks = new Set([
  "CodeMark",
  "EmphasisMark",
  "EscapeMark",
  "LinkMark",
  "StrikethroughMark",
]);
const linkHiddenMarkdownNodes = new Set([
  ...defaultHiddenMarkdownMarks,
  "LinkLabel",
  "LinkTitle",
  "URL",
]);

function parseAlignment(cell: string): Alignment | undefined {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

function parseMarkdownTable(text: string): ParsedTable | undefined {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return undefined;

  const headers = parseCells(lines[0]);
  const delimiterCells = parseCells(lines[1]);

  const isDelimiter = delimiterCells.every((c) => /^:?-+:?$/.test(c));
  if (!isDelimiter) return undefined;

  const alignments = delimiterCells.map(parseAlignment);
  const rows = lines.slice(2).map(parseCells);

  return { headers, alignments, rows };
}

function estimateTableWidgetHeight(table: ParsedTable): number {
  const visualRows = 1 + table.rows.length;
  const rowHeight = defaultEditorFontSizePx * (tableCellLineHeight + tableCellVerticalPaddingEm);
  const wrapperPadding = defaultEditorFontSizePx * tableWidgetVerticalPaddingEm;
  const horizontalBorders = Math.max(0, visualRows + 1) * tableBorderWidthPx;

  return Math.ceil(wrapperPadding + visualRows * rowHeight + horizontalBorders);
}

function tableSourceLineClass(isFirst: boolean, isLast: boolean): string {
  let className = "cm-table-source-line";
  if (isFirst) className += " cm-table-source-line-first";
  if (isLast) className += " cm-table-source-line-last";
  return className;
}

function buildTableSourceLineDecorations(
  state: EditorState,
  node: { from: number; to: number },
): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const firstLine = state.doc.lineAt(node.from);

  for (let pos = firstLine.from; pos <= node.to; ) {
    const line = state.doc.lineAt(pos);
    const isFirst = line.from === firstLine.from;
    const isLast = line.to >= node.to;

    decorations.push(
      Decoration.line({ class: tableSourceLineClass(isFirst, isLast) }).range(line.from),
    );

    if (isLast) break;
    pos = line.to + 1;
  }

  return decorations;
}

function pushText(nodes: TableCellInlineNode[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.text += text;
    return;
  }
  nodes.push({ type: "text", text });
}

function pushNodes(nodes: TableCellInlineNode[], next: TableCellInlineNode[]) {
  for (const node of next) {
    if (node.type === "text") {
      pushText(nodes, node.text);
    } else {
      nodes.push(node);
    }
  }
}

function decodeMarkdownEntity(entity: string): string {
  const fromCodePoint = (codePoint: number): string =>
    Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;

  if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
    return fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
  }
  if (entity.startsWith("&#")) {
    return fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
  }

  switch (entity) {
    case "&amp;":
      return "&";
    case "&apos;":
      return "'";
    case "&gt;":
      return ">";
    case "&lt;":
      return "<";
    case "&nbsp;":
      return "\u00a0";
    case "&quot;":
      return '"';
    default:
      return entity;
  }
}

function renderMarkdownChildren(
  markdown: string,
  node: SyntaxNode,
  hiddenNames = defaultHiddenMarkdownMarks,
): TableCellInlineNode[] {
  const nodes: TableCellInlineNode[] = [];
  let pos = node.from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) {
      pushText(nodes, markdown.slice(pos, child.from));
    }
    if (!hiddenNames.has(child.name)) {
      pushNodes(nodes, renderMarkdownNode(markdown, child));
    }
    pos = child.to;
  }

  if (node.to > pos) {
    pushText(nodes, markdown.slice(pos, node.to));
  }

  return nodes;
}

function markdownElement(
  tag: Extract<TableCellInlineNode, { type: "element" }>["tag"],
  children: TableCellInlineNode[],
  options: { className?: string; href?: string; wikiTarget?: string } = {},
): TableCellInlineNode[] {
  return [{ type: "element", tag, children, ...options }];
}

function linkHref(markdown: string, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  if (!url) return undefined;
  return markdown.slice(url.from, url.to).trim();
}

function renderLink(markdown: string, node: SyntaxNode): TableCellInlineNode[] {
  const children = renderMarkdownChildren(markdown, node, linkHiddenMarkdownNodes);
  const href = linkHref(markdown, node);
  if (children.length === 0 && href) {
    pushText(children, href);
  }
  return markdownElement("span", children, { className: "cm-rendered-link", href });
}

function renderMarkdownNode(markdown: string, node: SyntaxNode): TableCellInlineNode[] {
  switch (node.name) {
    case "Document":
    case "Paragraph":
      return renderMarkdownChildren(markdown, node);
    case "StrongEmphasis":
      return markdownElement("strong", renderMarkdownChildren(markdown, node));
    case "Emphasis":
      return markdownElement("em", renderMarkdownChildren(markdown, node));
    case "Strikethrough":
      return markdownElement("s", renderMarkdownChildren(markdown, node));
    case "InlineCode":
      return markdownElement("code", renderMarkdownChildren(markdown, node), {
        className: "cm-inline-code",
      });
    case "Link":
    case "Autolink":
      return renderLink(markdown, node);
    case "WikiLink": {
      const rawTarget = markdown.slice(node.from + 2, node.to - 2);
      return markdownElement(
        "span",
        [{ type: "text", text: parseWikiLink(rawTarget).displayText }],
        {
          className: "cm-wiki-link",
          wikiTarget: rawTarget,
        },
      );
    }
    case "URL":
      return markdownElement("span", [{ type: "text", text: markdown.slice(node.from, node.to) }], {
        className: "cm-rendered-link",
        href: markdown.slice(node.from, node.to),
      });
    case "Image": {
      const alt = renderMarkdownChildren(markdown, node, linkHiddenMarkdownNodes);
      return alt.length > 0 ? alt : [{ type: "text", text: markdown.slice(node.from, node.to) }];
    }
    case "Escape":
      return [{ type: "text", text: markdown.slice(node.from + 1, node.to) }];
    case "Entity":
      return [{ type: "text", text: decodeMarkdownEntity(markdown.slice(node.from, node.to)) }];
    case "HardBreak":
      return [{ type: "break" }];
    case "HTMLTag": {
      // `<br>` is the only line break a GFM cell can express (a hard break
      // needs a newline, which a cell cannot hold). Other tags stay as text.
      const tag = markdown.slice(node.from, node.to);
      if (/^<br\s*\/?>$/i.test(tag)) return [{ type: "break" }];
      return [{ type: "text", text: tag }];
    }
    case "Dash": {
      const dashCount = node.to - node.from;
      if (dashCount === 2) return [{ type: "text", text: "\u2013" }];
      if (dashCount === 3) return [{ type: "text", text: "\u2014" }];
      return [{ type: "text", text: markdown.slice(node.from, node.to) }];
    }
    case "Emoji": {
      const emojiName = markdown.slice(node.from + 1, node.to - 1);
      return [{ type: "text", text: emoji.get(emojiName) || markdown.slice(node.from, node.to) }];
    }
    default:
      if (node.firstChild) return renderMarkdownChildren(markdown, node);
      return [{ type: "text", text: markdown.slice(node.from, node.to) }];
  }
}

export function parseTableCellInlineMarkdown(markdown: string): TableCellInlineNode[] {
  return renderMarkdownNode(markdown, tableCellMarkdownParser.parse(markdown).topNode);
}

function appendInlineMarkdownNodes(parent: HTMLElement, nodes: TableCellInlineNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.appendChild(document.createTextNode(node.text));
      continue;
    }
    if (node.type === "break") {
      parent.appendChild(document.createElement("br"));
      continue;
    }

    const child = document.createElement(node.tag);
    if (node.className) child.className = node.className;
    if (node.href) child.dataset.href = node.href;
    if (node.wikiTarget) child.dataset.wikiTarget = node.wikiTarget;
    appendInlineMarkdownNodes(child, node.children);
    parent.appendChild(child);
  }
}

function setCellMarkdownContent(cell: HTMLElement, markdown: string) {
  // The raw markdown rides on the cell so the in-place editor can open with
  // it long after the widget instance that rendered it has been replaced.
  cell.dataset.raw = markdown;
  cell.replaceChildren();
  appendInlineMarkdownNodes(cell, parseTableCellInlineMarkdown(markdown));
}

// --- In-place cell editing ---
//
// A click on a rendered cell opens a zero-chrome textarea inside that cell
// holding the cell's raw inline markdown. Commit writes only that cell's span
// back to the document; the fold never leaves its rendered form because the
// editor's selection never enters the table range. Source mode remains
// reachable through the code toggle (which range-selects the table, the one
// signal `selectionTouchesRange` listens to) and through keyboard entry.
// See SPECs/table-in-place-cell-editing-spec.md.

const SVG_NS = "http://www.w3.org/2000/svg";
const CODE_ICON_PATHS = ["m16 18 6-6-6-6", "m8 6-6 6 6 6", "m13 4-2 16"] as const;
const LINK_SELECTOR = ".cm-rendered-link, .cm-wiki-link";

type CellElement = HTMLTableCellElement;
type CellMove = "next" | "prev" | "down";

interface OpenCellEditor {
  cell: CellElement;
  area: HTMLTextAreaElement;
  /** The cell's markdown when the editor opened, so a no-op commit writes nothing. */
  original: string;
}

// Keyed by the widget wrapper rather than the widget instance: every document
// change yields a new TableWidget whose updateDOM must still know which cell is
// live so it does not wipe the textarea out from under the user.
const openEditors = new WeakMap<HTMLElement, OpenCellEditor>();

function tableNodeFor(view: EditorView, element: HTMLElement): SyntaxNode | null {
  // Resolved live at use time — never cached on the widget (docs/editor.md).
  const pos = view.posAtDOM(element);
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    const table = enclosingTable(tree.resolveInner(pos, side));
    if (table) return table;
  }
  return null;
}

function cellCoordinates(cell: CellElement): { rowIdx: number; colIdx: number } {
  const row = cell.parentElement as HTMLTableRowElement;
  const isHeader = row.parentElement?.tagName === "THEAD";
  return { rowIdx: isHeader ? -1 : row.sectionRowIndex, colIdx: cell.cellIndex };
}

function tableWidth(cell: CellElement): number {
  return cell.closest("table")?.tHead?.rows[0]?.cells.length ?? 0;
}

/** The cell a commit should move into, `"append"` past the last cell, or null. */
function neighbourCell(cell: CellElement, move: CellMove): CellElement | "append" | null {
  const { rowIdx, colIdx } = cellCoordinates(cell);
  const table = cell.closest("table");
  if (!table) return null;
  const headerCells = table.tHead?.rows[0]?.cells;
  const bodyRows = table.tBodies[0]?.rows;
  const width = headerCells?.length ?? 0;
  const rowCount = bodyRows?.length ?? 0;
  const at = (r: number, c: number): CellElement | null =>
    r < 0 ? (headerCells?.[c] ?? null) : (bodyRows?.[r]?.cells[c] ?? null);

  switch (move) {
    case "down":
      return at(rowIdx + 1, colIdx);
    case "next":
      if (colIdx + 1 < width) return at(rowIdx, colIdx + 1);
      if (rowIdx + 1 < rowCount) return at(rowIdx + 1, 0);
      return "append";
    case "prev":
      if (colIdx > 0) return at(rowIdx, colIdx - 1);
      if (rowIdx >= 0) return at(rowIdx - 1, width - 1);
      return null;
  }
}

function lastRowFirstCell(wrapper: HTMLElement): CellElement | null {
  const rows = wrapper.querySelector("tbody")?.rows;
  return rows && rows.length > 0 ? (rows[rows.length - 1].cells[0] ?? null) : null;
}

function restoreCell(entry: OpenCellEditor, markdown: string): void {
  const { cell } = entry;
  cell.classList.remove("is-editing");
  cell.style.width = "";
  cell.style.boxSizing = "";
  setCellMarkdownContent(cell, markdown);
}

function cancelCellEditor(wrapper: HTMLElement, entry: OpenCellEditor): void {
  openEditors.delete(wrapper);
  restoreCell(entry, entry.original);
}

function commitCellEditor(
  view: EditorView,
  wrapper: HTMLElement,
  entry: OpenCellEditor,
  move?: CellMove,
): void {
  openEditors.delete(wrapper);
  const { cell, area, original } = entry;
  const text = area.value.trim();
  const changed = text !== unescapeCellText(original);
  // Put the rendered cell back as it was; the dispatch below refills it from
  // the document through updateDOM, which is the one rendering path.
  restoreCell(entry, original);

  // The widget was rebuilt under the editor (an external change, a reload):
  // the cell no longer maps to anything, so the edit is dropped, not guessed.
  if (!cell.isConnected) return;

  const target = move ? neighbourCell(cell, move) : null;
  const appendRow = target === "append";

  if (changed || appendRow) {
    const table = tableNodeFor(view, cell);
    if (!table) {
      console.warn("[table] could not resolve the table for a cell edit; edit dropped");
      return;
    }
    const changes: ChangeSpec[] = [];
    if (changed) {
      const { rowIdx, colIdx } = cellCoordinates(cell);
      const change = tableCellChange(view.state, table, rowIdx, colIdx, text);
      if (change) changes.push(change);
    }
    if (appendRow) changes.push(appendTableRowChange(table, tableWidth(cell)));
    view.dispatch({ changes, userEvent: "input", effects: view.scrollSnapshot() });
  }

  if (target && wrapper.isConnected) {
    const next = target === "append" ? lastRowFirstCell(wrapper) : target;
    if (next) {
      openCellEditor(view, wrapper, next);
      return;
    }
  }
  // A keyboard commit with nowhere to go hands focus back so Cmd+Z reaches
  // the editor's history. A blur commit leaves focus where the user put it.
  if (move) view.focus();
}

function openCellEditor(view: EditorView, wrapper: HTMLElement, cell: CellElement): void {
  const current = openEditors.get(wrapper);
  if (current?.cell === cell) return;
  if (current) commitCellEditor(view, wrapper, current);

  const original = cell.dataset.raw ?? "";
  const area = document.createElement("textarea");
  area.className = "cm-table-cell-editor";
  area.value = unescapeCellText(original);
  area.rows = 1;

  // Freeze the column at its rendered width so the table does not reflow
  // around the textarea's different intrinsic size.
  cell.style.width = `${cell.getBoundingClientRect().width}px`;
  cell.style.boxSizing = "border-box";
  cell.classList.add("is-editing");
  cell.replaceChildren(area);

  const entry: OpenCellEditor = { cell, area, original };
  openEditors.set(wrapper, entry);

  const autosize = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  area.addEventListener("input", autosize);
  area.addEventListener("keydown", (event) => {
    // The editor's keymaps must not see keys typed into a cell.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelCellEditor(wrapper, entry);
      view.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      commitCellEditor(view, wrapper, entry, event.shiftKey ? "prev" : "next");
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitCellEditor(view, wrapper, entry, "down");
    }
  });
  area.addEventListener("blur", () => {
    if (openEditors.get(wrapper) === entry) commitCellEditor(view, wrapper, entry);
  });

  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
  autosize();
}

function attachCellEditing(view: EditorView, wrapper: HTMLElement, cell: CellElement): void {
  cell.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    // Links keep their own behaviour: the editor-level click handlers read
    // their data attributes and navigate (table-cell-link-regressions-spec).
    if (event.target instanceof Element && event.target.closest(LINK_SELECTOR)) return;
    // A click inside the cell's own open textarea just moves its caret.
    if (openEditors.get(wrapper)?.cell === cell) return;
    event.preventDefault();
    event.stopPropagation();
    openCellEditor(view, wrapper, cell);
  });
}

function buildSourceToggle(view: EditorView, wrapper: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-table-source-toggle";
  button.title = "Edit table source";
  button.setAttribute("aria-label", "Edit table source");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of CODE_ICON_PATHS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.append(svg);

  button.addEventListener("mousedown", (event) => {
    event.preventDefault(); // keep focus where it is (docs/editor.md)
    event.stopPropagation();
  });
  button.addEventListener("click", () => {
    const open = openEditors.get(wrapper);
    if (open) commitCellEditor(view, wrapper, open);
    const table = tableNodeFor(view, wrapper);
    if (!table) return;
    // Range-select the whole table: the canonical way to flip
    // `selectionTouchesRange` and unfold to source.
    view.dispatch({
      selection: EditorSelection.single(table.to, table.from),
      effects: view.scrollSnapshot(),
    });
    view.focus();
  });
  return button;
}

// --- Widget ---

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    readonly rawText: string,
    private readonly heightEstimate: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }

  ignoreEvent(event: Event): boolean {
    // The widget owns its pointer and keyboard events so CodeMirror never
    // moves its selection into the table range on a click. Links are the
    // exception: their clicks must reach the editor's navigation handlers.
    return !(event.target instanceof Element && event.target.closest(LINK_SELECTOR));
  }

  get estimatedHeight(): number {
    return this.heightEstimate;
  }

  private fillCell(cell: CellElement, markdown: string, alignment: Alignment | undefined) {
    setCellMarkdownContent(cell, markdown);
    cell.style.textAlign = alignment ?? "";
  }

  private appendBodyRow(
    view: EditorView,
    wrapper: HTMLElement,
    tbody: HTMLTableSectionElement,
    cells: string[],
  ) {
    const { headers, alignments } = this.table;
    const tr = tbody.appendChild(document.createElement("tr"));
    for (let c = 0; c < headers.length; c++) {
      const td = tr.appendChild(document.createElement("td"));
      this.fillCell(td, cells[c] ?? "", alignments[c]);
      attachCellEditing(view, wrapper, td);
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const { headers, alignments, rows } = this.table;

    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    wrapper.contentEditable = "false";

    const inner = wrapper.appendChild(document.createElement("div"));
    inner.className = "cm-table-inner";
    const tableEl = inner.appendChild(document.createElement("table"));

    const thead = tableEl.appendChild(document.createElement("thead"));
    const headerRow = thead.appendChild(document.createElement("tr"));
    for (let i = 0; i < headers.length; i++) {
      const th = headerRow.appendChild(document.createElement("th"));
      this.fillCell(th, headers[i], alignments[i]);
      attachCellEditing(view, wrapper, th);
    }

    const tbody = tableEl.appendChild(document.createElement("tbody"));
    for (const row of rows) this.appendBodyRow(view, wrapper, tbody, row);

    inner.appendChild(buildSourceToggle(view, wrapper));
    return wrapper;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const { headers, alignments, rows } = this.table;

    const existingThs = dom.querySelectorAll<CellElement>("thead th");
    const tbody = dom.querySelector<HTMLTableSectionElement>("tbody");
    if (existingThs.length !== headers.length || !tbody) return false;

    const live = openEditors.get(dom)?.cell;

    existingThs.forEach((th, i) => {
      if (th !== live) this.fillCell(th, headers[i], alignments[i]);
    });

    // Row count changes are absorbed in place so an open editor, and the DOM
    // the next Tab target is looked up in, survive an appended row.
    while (tbody.rows.length > rows.length) tbody.lastElementChild?.remove();
    for (let r = tbody.rows.length; r < rows.length; r++) {
      this.appendBodyRow(view, dom, tbody, rows[r]);
    }
    for (let r = 0; r < rows.length; r++) {
      const tr = tbody.rows[r];
      for (let c = 0; c < headers.length; c++) {
        const td = tr.cells[c];
        if (td && td !== live) this.fillCell(td, rows[r][c] ?? "", alignments[c]);
      }
    }

    return true;
  }
}

// --- Extensions ---

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const text = state.doc.sliceString(node.from, node.to);
    const parsed = parseMarkdownTable(text);
    if (!parsed) return undefined;

    if (selectionTouchesRange) {
      return buildTableSourceLineDecorations(state, node);
    }

    return Decoration.replace({
      widget: new TableWidget(parsed, text, estimateTableWidgetHeight(parsed)),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const tableTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: `${tableWidgetVerticalPaddingEm / 2}em 0`,
  },
  ".cm-table-inner": {
    display: "inline-block",
    position: "relative",
  },
  ".cm-table-widget th.is-editing, .cm-table-widget td.is-editing": {
    boxShadow: "inset 0 0 0 2px var(--accent)",
  },
  ".cm-table-cell-editor": {
    // Zero chrome: it must read as the cell's own text, not a form control.
    display: "block",
    width: "100%",
    margin: "0",
    padding: "0",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    lineHeight: "inherit",
    textAlign: "inherit",
    resize: "none",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
  },
  ".cm-table-source-toggle": {
    position: "absolute",
    top: "4px",
    right: "4px",
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    border: `${tableBorderWidthPx}px solid var(--border-color)`,
    borderRadius: "6px",
    backgroundColor: "var(--surface-card)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    opacity: "0",
    transition:
      "opacity var(--motion-fast) var(--ease-out), background-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)",
  },
  ".cm-table-source-toggle svg": {
    width: "14px",
    height: "14px",
    strokeWidth: "2",
  },
  ".cm-table-inner:hover .cm-table-source-toggle, .cm-table-inner:focus-within .cm-table-source-toggle":
    {
      opacity: "1",
    },
  ".cm-table-source-toggle:hover": {
    backgroundColor: "var(--surface-subtle)",
    color: "var(--text-primary)",
  },
  ".cm-table-widget table": {
    borderCollapse: "separate",
    borderSpacing: "0",
    border: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
    borderRadius: "8px",
    overflow: "hidden",
    fontFamily: "inherit",
    fontSize: "inherit",
    width: "auto",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    padding: `${tableCellVerticalPaddingEm / 2}em 0.8em`,
    maxWidth: `${tableCellMaxWidthCh}ch`,
    // `EditorView.lineWrapping` applies `overflow-wrap: anywhere` (plus
    // Safari's `word-break: break-word`) to `.cm-content`, and these cells
    // inherit it. Unlike `break-word`, `anywhere` contributes its break
    // opportunities to min-content sizing, so every column's minimum collapses
    // to a single character and the auto table layout is free to squeeze a
    // column until ordinary words shred mid-word. Resetting to `break-word`
    // puts the column minimum back at "longest word": an overlong token still
    // breaks, but only once it cannot fit on a line at all.
    overflowWrap: "break-word",
    wordBreak: "normal",
    // Short cells sit against the first line of a tall wrapped row rather than
    // floating in the middle of it.
    verticalAlign: "top",
    fontSize: "inherit",
    lineHeight: `${tableCellLineHeight}`,
    borderBottom: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
    borderRight: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
  },
  ".cm-table-widget th:last-child, .cm-table-widget td:last-child": {
    borderRight: "none",
  },
  ".cm-table-widget tbody tr:last-child td": {
    borderBottom: "none",
  },
  ".cm-table-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--surface-subtle, var(--code-bg, #2d2d2d))",
    // Headers match their left-aligned bodies instead of taking the browser's
    // centered `th` default. An alignment parsed from the delimiter row is set
    // as an inline style on the cell, so `:---:` / `---:` still win here.
    textAlign: "left",
  },
  ".cm-table-source-line": {
    display: "block",
    marginLeft: "0",
    paddingLeft: "12px",
    paddingRight: "12px",
    backgroundColor: "var(--pm-code-background-color)",
    fontFamily: codeFontFamily,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
  },
  ".cm-activeLine.cm-table-source-line": {
    backgroundColor: "var(--pm-code-background-color)",
  },
  ".cm-table-source-line-first": {
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
  },
  ".cm-table-source-line-last": {
    borderBottomLeftRadius: "0.4rem",
    borderBottomRightRadius: "0.4rem",
  },
});

const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function tableDecorations() {
  return [tableFoldExtension, tableTheme, foldTreeSync];
}
