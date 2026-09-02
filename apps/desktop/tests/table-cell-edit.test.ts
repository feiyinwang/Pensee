import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import {
  appendTableRowChange,
  enclosingTable,
  escapeCellText,
  parseCells,
  replaceCellInRowLine,
  tableCellChange,
  unescapeCellText,
} from "../src/lib/table-cell-edit";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] });
}

function tableAt(state: EditorState, pos: number): SyntaxNode {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const table = enclosingTable(tree.resolveInner(pos, 1));
  if (!table) throw new Error("no table at " + pos);
  return table;
}

function applyCell(doc: string, rowIdx: number, colIdx: number, text: string): string {
  const state = makeState(doc);
  const table = tableAt(state, doc.indexOf("|"));
  const change = tableCellChange(state, table, rowIdx, colIdx, text);
  if (change === null) throw new Error("no change");
  return state.update({ changes: change }).state.doc.toString();
}

describe("cell text escaping", () => {
  test("round-trips pipes and line breaks", () => {
    expect(unescapeCellText("a\\|b<br>c<BR/>d")).toBe("a|b\nc\nd");
    expect(escapeCellText("a|b\nc")).toBe("a\\|b<br>c");
    expect(escapeCellText(unescapeCellText("x\\|y<br>z"))).toBe("x\\|y<br>z");
  });
});

describe("parseCells", () => {
  test("splits on unescaped pipes with optional outer pipes", () => {
    expect(parseCells("| a | b\\|c | d |")).toEqual(["a", "b\\|c", "d"]);
    expect(parseCells("a | b")).toEqual(["a", "b"]);
    expect(parseCells("|  |  |")).toEqual(["", ""]);
  });
});

describe("replaceCellInRowLine", () => {
  test("targets only the cell's own characters", () => {
    const line = "|   Name   |  Count |";
    const change = replaceCellInRowLine(line, 1, "Total")!;
    const next = line.slice(0, change.from) + change.insert + line.slice(change.to);
    expect(next).toBe("|   Name   |  Total |");
  });

  test("respects escaped pipes when counting columns", () => {
    const line = "| a\\|b | c |";
    const change = replaceCellInRowLine(line, 1, "z")!;
    expect(line.slice(0, change.from) + change.insert + line.slice(change.to)).toBe(
      "| a\\|b | z |",
    );
  });

  test("rewrites an empty cell's gap as a padded cell", () => {
    const line = "| a |  | c |";
    const change = replaceCellInRowLine(line, 1, "b")!;
    expect(line.slice(0, change.from) + change.insert + line.slice(change.to)).toBe(
      "| a | b | c |",
    );
  });

  test("returns undefined for a column the row does not have", () => {
    expect(replaceCellInRowLine("| a | b |", 2, "c")).toBeUndefined();
  });
});

describe("tableCellChange", () => {
  const doc = [
    "before",
    "",
    "| Name | Count |",
    "| --- | ---: |",
    "| Tea   |   2 |",
    "",
    "after",
  ].join("\n");

  test("edits a body cell and leaves every other byte alone", () => {
    expect(applyCell(doc, 0, 1, "3")).toBe(doc.replace("|   2 |", "|   3 |"));
  });

  test("edits a header cell", () => {
    expect(applyCell(doc, -1, 0, "Drink")).toBe(doc.replace("| Name |", "| Drink |"));
  });

  test("escapes pipes and newlines on the way in", () => {
    expect(applyCell(doc, 0, 0, "Tea|Coffee\nHot")).toBe(
      doc.replace("| Tea   |", "| Tea\\|Coffee<br>Hot   |"),
    );
  });

  test("clears a cell to empty without changing the column count", () => {
    const next = applyCell(doc, 0, 0, "");
    expect(next).toBe(doc.replace("| Tea   |", "|    |"));
    expect(parseCells(next.split("\n")[4])).toEqual(["", "2"]);
  });

  test("pads a ragged row when the column is missing", () => {
    const ragged = ["| a | b | c |", "| --- | --- | --- |", "| x |"].join("\n");
    expect(applyCell(ragged, 0, 2, "z")).toBe(
      ["| a | b | c |", "| --- | --- | --- |", "| x |  | z |"].join("\n"),
    );
  });

  test("returns null for a row that does not exist", () => {
    const state = makeState(doc);
    const table = tableAt(state, doc.indexOf("|"));
    expect(tableCellChange(state, table, 5, 0, "x")).toBeNull();
  });
});

describe("appendTableRowChange", () => {
  test("adds an empty row after the last body row", () => {
    const doc = "| a | b |\n| --- | --- |\n| c | d |\n\ntext";
    const state = makeState(doc);
    const table = tableAt(state, 0);
    const next = state.update({ changes: appendTableRowChange(table, 2) }).state.doc.toString();
    expect(next).toBe("| a | b |\n| --- | --- |\n| c | d |\n|  |  |\n\ntext");
  });

  test("adds the first body row after the delimiter", () => {
    const doc = "| a | b |\n| --- | --- |";
    const state = makeState(doc);
    const next = state
      .update({ changes: appendTableRowChange(tableAt(state, 0), 2) })
      .state.doc.toString();
    expect(next).toBe("| a | b |\n| --- | --- |\n|  |  |");
    // The new row must parse as a row, or the next Tab has nowhere to land.
    const reparsed = tableAt(makeState(next), 0);
    expect(reparsed.getChildren("TableRow")).toHaveLength(1);
  });
});
