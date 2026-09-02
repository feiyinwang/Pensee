// Tab-separated clipboard text → GFM pipe table.
//
// Spreadsheets, Notion, Google Docs, Confluence and browsers all put a copied
// table on the clipboard as tab-separated rows in `text/plain`. Markdown has
// no notion of that, so without help it pastes as one paragraph per row with
// invisible tabs between the columns. These two pure functions decide whether
// pasted text is such a table and, if so, serialise it as the pipe table the
// editor's `TableWidget` already renders.
//
// See SPECs/paste-tabular-data-as-table-spec.md for the rules.

import type { EditorState, TransactionSpec } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

/**
 * Parse tab-separated text into rows of cells, or return `undefined` when the
 * text is not tabular.
 *
 * Tabular means: at least two rows, and every row has at least one tab. A
 * cell wrapped in double quotes follows spreadsheet quoting — it may contain
 * tabs and newlines, and `""` stands for one `"`. Unquoted cells are taken
 * verbatim, so a stray quote inside prose is never treated as a delimiter.
 */
export function parseTabularText(text: string): string[][] | undefined {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!source.includes("\t")) return undefined;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(quoted ? cell : cell.trim());
    cell = "";
    quoted = false;
  };

  while (i < source.length) {
    const char = source[i];

    if (cell === "" && !quoted && char === '"') {
      // Quoted cell: consume through the closing quote. A quote that never
      // closes, or closes mid-cell, is literal content rather than quoting.
      const closing = findClosingQuote(source, i + 1);
      if (closing !== -1) {
        cell = source.slice(i + 1, closing).replace(/""/g, '"');
        quoted = true;
        i = closing + 1;
        continue;
      }
    }

    if (char === "\t") {
      endCell();
    } else if (char === "\n") {
      endCell();
      rows.push(row);
      row = [];
    } else {
      cell += char;
    }
    i++;
  }
  endCell();
  rows.push(row);

  if (rows.length < 2) return undefined;
  if (rows.some((r) => r.length < 2)) return undefined;
  return rows;
}

function findClosingQuote(source: string, from: number): number {
  for (let i = from; i < source.length; i++) {
    if (source[i] !== '"') continue;
    if (source[i + 1] === '"') {
      i++;
      continue;
    }
    // A closing quote must be followed by a delimiter or the end; otherwise
    // the quote is literal content, not spreadsheet quoting.
    const next = source[i + 1];
    if (next === undefined || next === "\t" || next === "\n") return i;
    return -1;
  }
  return -1;
}

/**
 * Serialise rows as a GFM pipe table. The first row is the header. Rows are
 * padded to the widest row so the delimiter row and every body row share one
 * width. Pipes are escaped and cell newlines become `<br>`, the only line
 * break a GFM cell can express.
 */
export function toMarkdownTable(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => {
    const padded = [...cells, ...Array<string>(width - cells.length).fill("")];
    return `| ${padded.map(escapeCell).join(" | ")} |`;
  };
  const [header, ...body] = rows;
  const delimiter = `| ${Array<string>(width).fill("---").join(" | ")} |`;
  return [line(header), delimiter, ...body.map(line)].join("\n");
}

function escapeCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

// A pasted table must not be rewritten inside code, where the bytes are the
// content, nor inside an existing table, where the rows would need merging
// rather than nesting.
const tabularPasteBlockedNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "Table"]);

/**
 * Build the transaction that replaces the main selection with `text` as a
 * pipe table, or return `null` when the text is not tabular or the caret sits
 * somewhere a table cannot go. The caller falls back to a plain paste on
 * `null`, so a paste that is not a table behaves exactly as before.
 *
 * A pipe table only parses as a table when it starts on its own line with a
 * blank line separating it from a preceding paragraph, and the line after it
 * would otherwise be read as another row, so the insert is padded with the
 * newlines its neighbours need.
 */
export function tabularPasteTransaction(state: EditorState, text: string): TransactionSpec | null {
  const rows = parseTabularText(text);
  if (!rows) return null;

  const { from, to } = state.selection.main;
  const tree = ensureSyntaxTree(state, from, 50) ?? syntaxTree(state);
  for (let node: SyntaxNode | null = tree.resolveInner(from, -1); node; node = node.parent) {
    if (tabularPasteBlockedNodes.has(node.name)) return null;
  }

  const { doc } = state;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);
  const prevLineBlank = fromLine.number === 1 || doc.line(fromLine.number - 1).text.trim() === "";
  const nextLineBlank =
    toLine.number === doc.lines || doc.line(toLine.number + 1).text.trim() === "";

  const before = from > fromLine.from ? "\n\n" : prevLineBlank ? "" : "\n";
  const after = to < toLine.to ? "\n\n" : nextLineBlank ? "" : "\n";
  const insert = before + toMarkdownTable(rows) + after;

  return {
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - after.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  };
}
