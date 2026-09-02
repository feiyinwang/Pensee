import { describe, expect, test } from "vite-plus/test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { columnsParserExtension } from "../src/components/editor-area/columns-decorations";
import {
  acceptsBlockType,
  applyBlockType,
  canInsert,
  canMove,
  columnBlockCount,
  currentBlockType,
  deleteTarget,
  duplicateTarget,
  insertBlock,
  moveTarget,
  targetMarkdown,
  type ActionTarget,
} from "../src/components/editor-area/block-actions";
import { blockTypeOf, setBlockType } from "../src/components/editor-area/markdown-formatting";

/** Stands in for `EditorView`: the actions only ever read `state` and call
 *  `dispatch`, which is the whole reason they are typed against a narrow
 *  interface instead of the view. Counting dispatches is the point — every
 *  action has to be a single undo step. */
class Fake {
  state: EditorState;
  dispatches = 0;

  constructor(doc: string) {
    this.state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM, columnsParserExtension] })],
    });
  }

  dispatch(spec: TransactionSpec) {
    this.dispatches++;
    this.state = this.state.update(spec).state;
  }

  get doc() {
    return this.state.doc.toString();
  }

  get caret() {
    return this.state.selection.main.head;
  }
}

const block = (from: number, to: number, name = "Paragraph"): ActionTarget => ({
  kind: "block",
  from,
  to,
  name,
});

// "one\n\ntwo\n\nthree" — one 0..3, two 5..8, three 10..15.
const THREE = "one\n\ntwo\n\nthree";
const ONE = block(0, 3);
const TWO = block(5, 8);
const THREE_ = block(10, 15);

const ROW = [
  '<div class="wr-row" style="display:flex;flex-wrap:wrap;gap:16px">',
  '<div class="wr-col" style="flex:1 1 0;min-width:150px">',
  "",
  "![](a.png)",
  "",
  "caption a",
  "",
  "</div>",
  '<div class="wr-col" style="flex:1 1 0;min-width:150px">',
  "",
  "![](b.png)",
  "",
  "caption b",
  "",
  "</div>",
  "</div>",
].join("\n");

function rowStart(ed: Fake): number {
  let at = -1;
  syntaxTree(ed.state).iterate({
    enter: (node) => {
      if (node.name === "ColumnRow" && at < 0) at = node.from;
    },
  });
  return at;
}

// ---------------------------------------------------------------------------
// Block type: the shared conversion
// ---------------------------------------------------------------------------

describe("blockTypeOf", () => {
  test("reads the nine shapes", () => {
    expect(blockTypeOf("hello")).toBe("text");
    expect(blockTypeOf("# hi")).toBe("h1");
    expect(blockTypeOf("### hi")).toBe("h3");
    expect(blockTypeOf("- hi")).toBe("bullet");
    expect(blockTypeOf("- [ ] hi")).toBe("task");
    expect(blockTypeOf("1. hi")).toBe("numbered");
    expect(blockTypeOf("> hi")).toBe("quote");
    expect(blockTypeOf("```\nhi\n```")).toBe("code");
  });

  test("an h4 is none of them, rather than the wrong one", () => {
    expect(blockTypeOf("#### hi")).toBeNull();
  });
});

describe("setBlockType", () => {
  test("converts rather than stacks — the old prefix goes first", () => {
    expect(setBlockType("- hi", "h2")).toBe("## hi");
    expect(setBlockType("## hi", "bullet")).toBe("- hi");
    expect(setBlockType("- [ ] hi", "quote")).toBe("> hi");
  });

  test("numbers every line of a multi-line block", () => {
    expect(setBlockType("a\nb", "numbered")).toBe("1. a\n2. b");
  });

  test("a heading takes one line, never the next line's content", () => {
    // Two lines with no blank between them are ONE markdown paragraph, which
    // is what a single Enter produces. Prefixing every line made two headings
    // and put a `#` in front of text the grip was not pointing at.
    expect(setBlockType("now i have it done\nnext line content", "h1")).toBe(
      "# now i have it done\n\nnext line content",
    );
    expect(setBlockType("a\nb\nc", "h2")).toBe("## a\n\nb\nc");
    expect(setBlockType("a\nb", "h3")).toBe("### a\n\nb");
  });

  test("the lines a heading leaves behind keep their own shape", () => {
    expect(setBlockType("- a\n- b\n- c", "h1")).toBe("# a\n\n- b\n- c");
    expect(setBlockType("> q1\n> q2", "h1")).toBe("# q1\n\n> q2");
  });

  test("keeps code content verbatim, prefixes and all", () => {
    expect(setBlockType("- not a list", "code")).toBe("```\n- not a list\n```");
  });

  test("unwraps a fence on the way out", () => {
    expect(setBlockType("```\nhi\n```", "text")).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// Plain blocks
// ---------------------------------------------------------------------------

describe("applyBlockType", () => {
  test("turns a paragraph into a heading in one dispatch", () => {
    const ed = new Fake(THREE);
    expect(applyBlockType(ed, TWO, "h2")).toBe(true);
    expect(ed.doc).toBe("one\n\n## two\n\nthree");
    expect(ed.dispatches).toBe(1);
    expect(ed.caret).toBe(5);
  });

  test("picking the shape it already has clears it", () => {
    const ed = new Fake("## two");
    expect(applyBlockType(ed, block(0, 6), "h2")).toBe(true);
    expect(ed.doc).toBe("two");
  });

  test("works on the block the handle points at, not the one the caret is in", () => {
    const ed = new Fake(THREE);
    // Caret stays at 0 — inside "one" — while "three" is converted.
    applyBlockType(ed, THREE_, "h1");
    expect(ed.doc).toBe("one\n\ntwo\n\n# three");
  });

  test("heads only the line the grip is beside, in one dispatch", () => {
    const ed = new Fake("now i have it done\nnext line content");
    expect(applyBlockType(ed, block(0, 36), "h1")).toBe(true);
    expect(ed.doc).toBe("# now i have it done\n\nnext line content");
    expect(ed.dispatches).toBe(1);
  });

  test("lights the tile matching the target", () => {
    const ed = new Fake("- a\n- b");
    expect(currentBlockType(ed, block(0, 7, "BulletList"))).toBe("bullet");
  });
});

describe("acceptsBlockType", () => {
  test("no type tiles on a picture", () => {
    const ed = new Fake("![](a.png)");
    expect(acceptsBlockType(ed, block(0, 10))).toBe(false);
  });

  test("no type tiles on a fenced block", () => {
    const ed = new Fake("```\nx\n```");
    expect(acceptsBlockType(ed, block(0, 9, "FencedCode"))).toBe(false);
  });

  test("yes on a paragraph", () => {
    const ed = new Fake(THREE);
    expect(acceptsBlockType(ed, TWO)).toBe(true);
  });
});

describe("moveTarget", () => {
  test("down swaps with the next block and follows it", () => {
    const ed = new Fake(THREE);
    expect(moveTarget(ed, TWO, 1)).toBe(true);
    expect(ed.doc).toBe("one\n\nthree\n\ntwo");
    expect(ed.dispatches).toBe(1);
    expect(ed.caret).toBe(12);
  });

  test("up swaps with the previous block and follows it", () => {
    const ed = new Fake(THREE);
    expect(moveTarget(ed, TWO, -1)).toBe(true);
    expect(ed.doc).toBe("two\n\none\n\nthree");
    expect(ed.caret).toBe(0);
  });

  test("no move off either end", () => {
    const ed = new Fake(THREE);
    expect(canMove(ed, ONE, -1)).toBe(false);
    expect(canMove(ed, THREE_, 1)).toBe(false);
    expect(canMove(ed, TWO, 1)).toBe(true);
  });
});

describe("insertBlock", () => {
  test("above the first block leaves an empty line to type on", () => {
    const ed = new Fake(THREE);
    insertBlock(ed, ONE, "above");
    expect(ed.doc).toBe("\n\none\n\ntwo\n\nthree");
    expect(ed.caret).toBe(0);
  });

  test("below puts the caret past the blank line", () => {
    const ed = new Fake(THREE);
    insertBlock(ed, TWO, "below");
    expect(ed.caret).toBe(10);
  });

  test("bands cannot hold an empty block, so they are not offered one", () => {
    expect(canInsert({ kind: "band", rowFrom: 0, index: 0, band: "below" })).toBe(false);
  });
});

describe("duplicateTarget", () => {
  test("copy lands directly below, caret in the copy", () => {
    const ed = new Fake(THREE);
    expect(duplicateTarget(ed, TWO)).toBe(true);
    expect(ed.doc).toBe("one\n\ntwo\n\ntwo\n\nthree");
    expect(ed.caret).toBe(10);
  });
});

describe("deleteTarget", () => {
  test("a middle block takes its blank line with it", () => {
    const ed = new Fake(THREE);
    expect(deleteTarget(ed, TWO)).toBe(true);
    expect(ed.doc).toBe("one\n\nthree");
    expect(ed.dispatches).toBe(1);
    expect(ed.caret).toBe(5);
  });

  test("the last block eats the blank line above instead", () => {
    const ed = new Fake(THREE);
    deleteTarget(ed, THREE_);
    expect(ed.doc).toBe("one\n\ntwo");
    expect(ed.caret).toBe(8);
  });

  test("the only block leaves an empty document", () => {
    const ed = new Fake("solo");
    deleteTarget(ed, block(0, 4));
    expect(ed.doc).toBe("");
    expect(ed.caret).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Inside a row: bands and columns
// ---------------------------------------------------------------------------

describe("bands", () => {
  test("the caption band reads back as its own markdown", () => {
    const ed = new Fake(ROW);
    const at = rowStart(ed);
    expect(at).toBeGreaterThanOrEqual(0);
    const band: ActionTarget = { kind: "band", rowFrom: at, index: 0, band: "below" };
    expect(targetMarkdown(ed, band)).toBe("caption a");
  });

  test("converting a caption rewrites only that column", () => {
    const ed = new Fake(ROW);
    const band: ActionTarget = { kind: "band", rowFrom: rowStart(ed), index: 0, band: "below" };
    expect(applyBlockType(ed, band, "h3")).toBe(true);
    expect(ed.dispatches).toBe(1);
    expect(ed.doc).toContain("### caption a");
    expect(ed.doc).toContain("caption b");
  });

  test("deleting a caption keeps the picture and the row", () => {
    const ed = new Fake(ROW);
    const band: ActionTarget = { kind: "band", rowFrom: rowStart(ed), index: 0, band: "below" };
    expect(deleteTarget(ed, band)).toBe(true);
    expect(ed.doc).not.toContain("caption a");
    expect(ed.doc).toContain("![](a.png)");
    expect(ed.doc).toContain('class="wr-row"');
  });
});

describe("columns", () => {
  test("moving right swaps the two cells", () => {
    const ed = new Fake(ROW);
    const col: ActionTarget = { kind: "col", rowFrom: rowStart(ed), index: 0 };
    expect(moveTarget(ed, col, 1)).toBe(true);
    expect(ed.doc.indexOf("b.png")).toBeLessThan(ed.doc.indexOf("a.png"));
  });

  test("the last column cannot move further right", () => {
    const ed = new Fake(ROW);
    expect(canMove(ed, { kind: "col", rowFrom: rowStart(ed), index: 1 }, 1)).toBe(false);
  });

  test("deleting one of two columns unwraps the survivor", () => {
    const ed = new Fake(ROW);
    const col: ActionTarget = { kind: "col", rowFrom: rowStart(ed), index: 0 };
    expect(deleteTarget(ed, col)).toBe(true);
    expect(ed.doc).not.toContain('class="wr-row"');
    expect(ed.doc).toBe("![](b.png)\n\ncaption b");
  });

  test("the confirmation knows how many blocks it is about to take", () => {
    const ed = new Fake(ROW);
    expect(columnBlockCount(ed, { kind: "col", rowFrom: rowStart(ed), index: 0 })).toBe(2);
  });

  test("no type tiles on a whole column", () => {
    const ed = new Fake(ROW);
    expect(acceptsBlockType(ed, { kind: "col", rowFrom: rowStart(ed), index: 0 })).toBe(false);
  });
});
