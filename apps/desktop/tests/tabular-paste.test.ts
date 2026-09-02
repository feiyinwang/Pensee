import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import {
  parseTabularText,
  tabularPasteTransaction,
  toMarkdownTable,
} from "../src/lib/tabular-paste";

const tsv = [
  "Approach\tOwner\tCaveats",
  "Tokens first\tCristian\tNeeds Andrii",
  "Install now\tTamas\t",
].join("\n");

const expectedTable = [
  "| Approach | Owner | Caveats |",
  "| --- | --- | --- |",
  "| Tokens first | Cristian | Needs Andrii |",
  "| Install now | Tamas |  |",
].join("\n");

describe("parseTabularText", () => {
  test("splits tab-separated rows into trimmed cells", () => {
    expect(parseTabularText(tsv)).toEqual([
      ["Approach", "Owner", "Caveats"],
      ["Tokens first", "Cristian", "Needs Andrii"],
      ["Install now", "Tamas", ""],
    ]);
  });

  test("drops the trailing newline spreadsheets append", () => {
    expect(parseTabularText("a\tb\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTabularText("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("rejects text without tabs", () => {
    expect(parseTabularText("just prose\nmore prose")).toBeUndefined();
  });

  test("rejects a single tabbed line", () => {
    expect(parseTabularText("a\tb")).toBeUndefined();
  });

  test("rejects when any line lacks a tab", () => {
    expect(parseTabularText("a\tb\nprose line\nc\td")).toBeUndefined();
  });

  test("unwraps quoted cells with newlines, tabs and doubled quotes", () => {
    expect(parseTabularText('h1\th2\n"line one\nline two"\t"say ""hi""\tthere"')).toEqual([
      ["h1", "h2"],
      ["line one\nline two", 'say "hi"\tthere'],
    ]);
  });

  test("keeps a quote that does not close at a delimiter as literal text", () => {
    expect(parseTabularText('h1\th2\n"quoted" phrase\tx')).toEqual([
      ["h1", "h2"],
      ['"quoted" phrase', "x"],
    ]);
  });

  test("keeps an empty quoted cell empty", () => {
    expect(parseTabularText('h1\th2\n""\tx')).toEqual([
      ["h1", "h2"],
      ["", "x"],
    ]);
  });
});

describe("toMarkdownTable", () => {
  test("uses the first row as header and pads short rows", () => {
    expect(toMarkdownTable(parseTabularText(tsv)!)).toBe(expectedTable);
    expect(
      toMarkdownTable([
        ["a", "b", "c"],
        ["d", "e"],
      ]),
    ).toBe(["| a | b | c |", "| --- | --- | --- |", "| d | e |  |"].join("\n"));
  });

  test("widens to the widest row when a body row is wider than the header", () => {
    expect(toMarkdownTable([["a"], ["b", "c"]])).toBe(
      ["| a |  |", "| --- | --- |", "| b | c |"].join("\n"),
    );
  });

  test("escapes pipes and turns cell newlines into <br>", () => {
    expect(
      toMarkdownTable([
        ["a|b", "x"],
        ["one\ntwo", "y"],
      ]),
    ).toBe(["| a\\|b | x |", "| --- | --- |", "| one<br>two | y |"].join("\n"));
  });
});

function makeState(doc: string, anchor: number, head = anchor) {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ extensions: [GFM] })],
  });
}

function apply(state: EditorState, text: string) {
  const spec = tabularPasteTransaction(state, text);
  if (!spec) return null;
  const next = state.update(spec);
  return { doc: next.state.doc.toString(), head: next.state.selection.main.head };
}

describe("tabularPasteTransaction", () => {
  test("inserts the table with no padding on an empty line between blank lines", () => {
    const doc = "para\n\n\n\nafter";
    const result = apply(makeState(doc, 6), tsv);
    expect(result?.doc).toBe(`para\n\n${expectedTable}\n\nafter`);
    expect(result?.head).toBe(6 + expectedTable.length);
  });

  test("puts a blank line between a preceding paragraph and the table", () => {
    const result = apply(makeState("para\n", 5), tsv);
    expect(result?.doc).toBe(`para\n\n${expectedTable}`);
  });

  test("separates the table from a following non-blank line", () => {
    const result = apply(makeState("\nafter", 0), tsv);
    expect(result?.doc).toBe(`${expectedTable}\n\nafter`);
  });

  test("moves a mid-line paste onto its own lines and keeps both halves", () => {
    const result = apply(makeState("Hello world", 6), tsv);
    expect(result?.doc).toBe(`Hello \n\n${expectedTable}\n\nworld`);
    expect(result?.head).toBe(`Hello \n\n${expectedTable}`.length);
  });

  test("replaces a selection", () => {
    const result = apply(makeState("\nold\n", 1, 4), tsv);
    expect(result?.doc).toBe(`\n${expectedTable}\n`);
  });

  test("tags the transaction as a paste", () => {
    const spec = tabularPasteTransaction(makeState("", 0), tsv);
    expect(spec?.userEvent).toBe("input.paste");
  });

  test("returns null for text that is not a table", () => {
    expect(tabularPasteTransaction(makeState("", 0), "plain\ttext")).toBeNull();
    expect(tabularPasteTransaction(makeState("", 0), "no tabs\nhere")).toBeNull();
  });

  test("returns null inside a fenced code block", () => {
    const doc = "```\ncode\n\n```\n";
    expect(tabularPasteTransaction(makeState(doc, 9), tsv)).toBeNull();
  });

  test("returns null inside inline code", () => {
    const doc = "text `co de` more";
    expect(tabularPasteTransaction(makeState(doc, 8), tsv)).toBeNull();
  });

  test("returns null inside an existing table cell", () => {
    const doc = "| a | b |\n| --- | --- |\n| c | d |\n";
    const cellPos = doc.indexOf("c") + 1;
    expect(tabularPasteTransaction(makeState(doc, cellPos), tsv)).toBeNull();
  });

  test("the inserted markdown parses as a table the widget can render", () => {
    const result = apply(makeState("para\n", 5), tsv)!;
    const state = makeState(result.doc, 0);
    let sawTable = false;
    // Parse eagerly: a fresh state only has the viewport parsed.
    ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({
      enter: (node) => {
        if (node.name === "Table") sawTable = true;
      },
    });
    expect(sawTable).toBe(true);
  });
});
