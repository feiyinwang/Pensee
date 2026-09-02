// Editing one cell of a GFM pipe table in place.
//
// The rendered table widget lets the user type into a cell without leaving
// the rendered view. This module owns the text side of that: how a row line
// splits into cells, where one cell's characters sit inside its line, and how
// a cell's display text maps to and from its markdown. Everything here is
// pure or works on an `EditorState` plus a syntax node, so it is testable
// without a DOM.
//
// See SPECs/table-in-place-cell-editing-spec.md.

import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** A cell's markdown as the user edits it: pipes unescaped, `<br>` as newlines. */
export function unescapeCellText(markdown: string): string {
  return markdown.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

/** The inverse of `unescapeCellText`: the only two things a cell cannot hold. */
export function escapeCellText(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** True when the character at `index` is preceded by an odd run of backslashes. */
export function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

interface CellRegion {
  /** Offsets of the raw span between this cell's delimiting pipes, line-relative. */
  from: number;
  to: number;
}

/**
 * Split a row line into the regions between its pipes, honouring `\|` and the
 * optional leading and trailing pipe. Offsets are relative to `line`.
 */
function cellRegions(line: string): CellRegion[] {
  const lead = line.length - line.trimStart().length;
  const trimmed = line.trim();
  const start = trimmed.startsWith("|") ? 1 : 0;
  const end =
    trimmed.endsWith("|") && !isEscapedAt(trimmed, trimmed.length - 1)
      ? trimmed.length - 1
      : trimmed.length;

  const regions: CellRegion[] = [];
  let regionStart = start;
  for (let i = start; i < end; i++) {
    if (trimmed[i] === "|" && !isEscapedAt(trimmed, i)) {
      regions.push({ from: lead + regionStart, to: lead + i });
      regionStart = i + 1;
    }
  }
  regions.push({ from: lead + regionStart, to: lead + end });
  return regions;
}

/** The trimmed cell texts of a row line, `\|` left escaped. */
export function parseCells(line: string): string[] {
  return cellRegions(line).map((r) => line.slice(r.from, r.to).trim());
}

/**
 * The change that sets cell `colIdx` of a row line to `markdown`, touching
 * nothing outside that cell's own characters so hand-aligned padding in the
 * neighbouring cells survives. Returns `undefined` when the row has no such
 * column, in which case the caller pads the row instead.
 */
export function replaceCellInRowLine(
  line: string,
  colIdx: number,
  markdown: string,
): { from: number; to: number; insert: string } | undefined {
  const region = cellRegions(line)[colIdx];
  if (!region) return undefined;

  const raw = line.slice(region.from, region.to);
  const content = raw.trim();
  if (content === "") {
    // Nothing to anchor on: rewrite the whole gap as a padded cell.
    return { from: region.from, to: region.to, insert: ` ${markdown} ` };
  }
  const from = region.from + raw.indexOf(content);
  return { from, to: from + content.length, insert: markdown };
}

function rowNode(table: SyntaxNode, rowIdx: number): SyntaxNode | null {
  if (rowIdx < 0) return table.getChild("TableHeader");
  return table.getChildren("TableRow")[rowIdx] ?? null;
}

/**
 * Change spec that writes `text` (display form, unescaped) into a cell of the
 * table at `table`. `rowIdx` is -1 for the header row, else the body row
 * index. Returns `null` when the row does not exist.
 */
export function tableCellChange(
  state: EditorState,
  table: SyntaxNode,
  rowIdx: number,
  colIdx: number,
  text: string,
): ChangeSpec | null {
  const row = rowNode(table, rowIdx);
  if (!row) return null;

  const line = state.doc.sliceString(row.from, row.to);
  const markdown = escapeCellText(text);
  const local = replaceCellInRowLine(line, colIdx, markdown);
  if (local) {
    return { from: row.from + local.from, to: row.from + local.to, insert: local.insert };
  }

  // Ragged row shorter than the column: rebuild this one line with the cell
  // in place. Only reached for rows a spreadsheet or hand edit left short.
  const cells = parseCells(line);
  while (cells.length <= colIdx) cells.push("");
  cells[colIdx] = markdown;
  return { from: row.from, to: row.to, insert: `| ${cells.join(" | ")} |` };
}

/** Change spec that appends an empty body row of `width` columns to `table`. */
export function appendTableRowChange(table: SyntaxNode, width: number): ChangeSpec {
  const rows = table.getChildren("TableRow");
  const anchor = rows.length > 0 ? rows[rows.length - 1] : table.getChild("TableDelimiter");
  const at = anchor ? anchor.to : table.to;
  return { from: at, insert: `\n|${"  |".repeat(width)}` };
}

/** Walk from a node up to the enclosing `Table`, or `null`. */
export function enclosingTable(node: SyntaxNode | null): SyntaxNode | null {
  for (let n = node; n; n = n.parent) if (n.name === "Table") return n;
  return null;
}
