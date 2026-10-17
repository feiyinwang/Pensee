import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
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
  listItemAt,
  moveTarget,
  targetMarkdown,
  type ActionTarget,
} from "../src/components/editor-area/block-actions";
import {
  blockTypeOf,
  clearEmptyHeadingOnEnter,
  setBlockType,
} from "../src/components/editor-area/markdown-formatting";

/** Stands in for `EditorView`: the actions only ever read `state` and call
 *  `dispatch`, which is the whole reason they are typed against a narrow
 *  interface instead of the view. Counting dispatches is the point — every
 *  action has to be a single undo step. */
class Fake {
  state: EditorState;
  dispatches = 0;

  constructor(doc: string, selection?: { anchor: number; head: number }) {
    this.state = EditorState.create({
      doc,
      selection: selection && EditorSelection.single(selection.anchor, selection.head),
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

  test("a bare hash is an empty heading, not text", () => {
    // CommonMark's empty heading. Calling it Text made it a ghost the type
    // grid could neither light up nor clear.
    expect(blockTypeOf("#")).toBe("h1");
    expect(blockTypeOf("##")).toBe("h2");
    expect(blockTypeOf("#hashtag")).toBe("text");
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

  test("clears a bare hash instead of stacking another on it", () => {
    expect(setBlockType("#", "text")).toBe("");
    expect(setBlockType("#", "h2")).toBe("## ");
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

  test("heads one line of a multi-line paragraph, leaving its neighbour alone", () => {
    // What the gutter grip now hands over when the pointer is on line 2:
    // that line's own offsets, not the whole Paragraph node.
    const ed = new Fake("first line here\nsecond line here");
    expect(applyBlockType(ed, block(16, 32), "h1")).toBe(true);
    expect(ed.doc).toBe("first line here\n# second line here");
    expect(ed.dispatches).toBe(1);
  });

  test("Heading 1 on a ghost `#` removes it rather than writing `# #`", () => {
    // The tile is lit (it IS an h1), so picking it again clears the shape, and
    // an empty result deletes the block — ghost gone, neighbour untouched.
    const ed = new Fake("#\nnow i have it done");
    expect(applyBlockType(ed, block(0, 1, "ATXHeading1"), "h1")).toBe(true);
    expect(ed.doc).toBe("now i have it done");
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

  test("the lines of a paragraph move, and stay one paragraph", () => {
    // The grip addresses each line of a paragraph, so the move list has to
    // offer them too — and reordering must not insert a blank line and quietly
    // split the paragraph in half.
    const ed = new Fake("first line here\nsecond line here");
    expect(canMove(ed, block(0, 15), 1)).toBe(true);
    expect(moveTarget(ed, block(0, 15), 1)).toBe(true);
    expect(ed.doc).toBe("second line here\nfirst line here");
    expect(ed.dispatches).toBe(1);
  });

  test("blank-line separation between real blocks survives a move", () => {
    const ed = new Fake(THREE);
    moveTarget(ed, TWO, 1);
    expect(ed.doc).toBe("one\n\nthree\n\ntwo");
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

// ---------------------------------------------------------------------------
// Empty heading
// ---------------------------------------------------------------------------

describe("clearEmptyHeadingOnEnter", () => {
  /** Runs the command against a doc with the caret at `head`. */
  function press(doc: string, head: number) {
    const ed = new Fake(doc);
    ed.state = ed.state.update({ selection: { anchor: head } }).state;
    const handled = clearEmptyHeadingOnEnter({
      state: ed.state,
      dispatch: (spec) => ed.dispatch(spec),
    });
    return { handled, doc: ed.doc, caret: ed.caret };
  }

  test("clears the `# ` new-file template instead of stranding the hashes", () => {
    // The exact shape every new note starts in, and the very first Enter it
    // sees. Leaving `# ` behind is what put the hash on the line above the
    // words the user then typed.
    expect(press("# ", 2)).toEqual({ handled: true, doc: "", caret: 0 });
  });

  test("clears a bare hash and deeper empty headings", () => {
    expect(press("#", 1).doc).toBe("");
    expect(press("###   ", 6).doc).toBe("");
    expect(press("######", 6).doc).toBe("");
  });

  test("only the empty heading line goes; the rest of the doc stays", () => {
    expect(press("# \nbody text", 2)).toEqual({ handled: true, doc: "\nbody text", caret: 0 });
  });

  test("leaves a heading that has text alone", () => {
    expect(press("# title", 7).handled).toBe(false);
    expect(press("# title", 7).doc).toBe("# title");
  });

  test("leaves non-headings alone", () => {
    expect(press("", 0).handled).toBe(false);
    expect(press("- ", 2).handled).toBe(false);
    expect(press("#hashtag", 8).handled).toBe(false);
    expect(press("####### seven", 13).handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// List items: each bullet is its own block under the grip
// ---------------------------------------------------------------------------

describe("list items", () => {
  const item = (from: number, to: number): ActionTarget => block(from, to, "ListItem");
  const LIST = "1. one\n2. two\n3. three";

  test("the grip resolves the item on the hovered line, not the whole list", () => {
    const ed = new Fake(LIST);
    expect(listItemAt(ed.state, 9)).toEqual({ from: 7, to: 13, name: "ListItem" });
  });

  test("a nested line resolves to the nested item, and a parent stops before it", () => {
    const ed = new Fake("- a\n  - b\n- c");
    expect(listItemAt(ed.state, 8)).toEqual({ from: 6, to: 9, name: "ListItem" });
    expect(listItemAt(ed.state, 1)).toEqual({ from: 0, to: 3, name: "ListItem" });
  });

  test("the tile reflects the item, and converting one item leaves its siblings", () => {
    const ed = new Fake("- a\n- b\n- c");
    expect(currentBlockType(ed, item(4, 7))).toBe("bullet");
    expect(applyBlockType(ed, item(4, 7), "task")).toBe(true);
    expect(ed.doc).toBe("- a\n- [ ] b\n- c");
    expect(ed.dispatches).toBe(1);
  });

  test("turning an item into text splits the list around it", () => {
    const ed = new Fake(LIST);
    expect(applyBlockType(ed, item(7, 13), "numbered")).toBe(true);
    expect(ed.doc).toBe("1. one\n\ntwo\n\n3. three");
    expect(ed.dispatches).toBe(1);
  });

  test("moving swaps bodies with a sibling and keeps the numbering", () => {
    const ed = new Fake(LIST);
    expect(canMove(ed, item(0, 6), -1)).toBe(false);
    expect(moveTarget(ed, item(0, 6), 1)).toBe(true);
    expect(ed.doc).toBe("1. two\n2. one\n3. three");
    expect(ed.caret).toBe(7);
  });

  test("insert below adds an empty sibling item", () => {
    const ed = new Fake("- [x] a\n- b");
    expect(insertBlock(ed, item(0, 7), "below")).toBe(true);
    expect(ed.doc).toBe("- [x] a\n- [ ] \n- b");
    expect(ed.caret).toBe(14);
  });

  test("duplicate stays inside the list", () => {
    const ed = new Fake("- a\n- b");
    expect(duplicateTarget(ed, item(0, 3))).toBe(true);
    expect(ed.doc).toBe("- a\n- a\n- b");
  });

  test("deleting the last item keeps the paragraph below separate", () => {
    const ed = new Fake("- a\n- b\n\npara");
    expect(deleteTarget(ed, item(4, 7))).toBe(true);
    expect(ed.doc).toBe("- a\n\npara");
  });
});

// ---------------------------------------------------------------------------
// A selection across several items: the type tiles convert every one of them
// ---------------------------------------------------------------------------

describe("selected list items", () => {
  const item = (from: number, to: number): ActionTarget => block(from, to, "ListItem");
  /** Select from the start of line `a` to the end of line `b` (1-based). */
  const lines = (doc: string, a: number, b: number) => {
    const all = doc.split("\n");
    const start = all.slice(0, a - 1).join("\n").length + (a > 1 ? 1 : 0);
    const end = all.slice(0, b).join("\n").length;
    return { anchor: start, head: end };
  };

  test("numbered numbers every selected bullet in order, in one undo step", () => {
    const doc = "- a\n- b\n- c";
    const ed = new Fake(doc, lines(doc, 1, 3));
    expect(applyBlockType(ed, item(4, 7), "numbered")).toBe(true);
    expect(ed.doc).toBe("1. a\n2. b\n3. c");
    expect(ed.dispatches).toBe(1);
  });

  test("the run continues from a numbered item just above the selection", () => {
    const doc = "1. a\n- b\n- c\n- d";
    const ed = new Fake(doc, lines(doc, 2, 3));
    expect(applyBlockType(ed, item(5, 8), "numbered")).toBe(true);
    expect(ed.doc).toBe("1. a\n2. b\n3. c\n- d");
  });

  test("nested items convert too, count from 1, and stay nested under the wider marker", () => {
    const doc = "- a\n  - x\n  - y\n- b";
    const ed = new Fake(doc, lines(doc, 1, 4));
    expect(applyBlockType(ed, item(0, 3), "numbered")).toBe(true);
    expect(ed.doc).toBe("1. a\n   1. x\n   2. y\n2. b");
    // Still a child of `a`: two ListItems above its text, not one.
    let depth = 0;
    const x = ed.doc.indexOf("x");
    for (let n = syntaxTree(ed.state).resolveInner(x, 1); n; n = n.parent!) {
      if (n.name === "ListItem") depth++;
      if (!n.parent) break;
    }
    expect(depth).toBe(2);
  });

  test("one item's children move with its marker too", () => {
    const ed = new Fake("1. a\n   - x");
    expect(applyBlockType(ed, item(0, 4), "bullet")).toBe(true);
    expect(ed.doc).toBe("- a\n  - x");
  });

  test("a selection ending at the start of a line does not take that line", () => {
    const doc = "- a\n- b\n- c";
    const ed = new Fake(doc, { anchor: 0, head: 8 });
    expect(applyBlockType(ed, item(0, 3), "task")).toBe(true);
    expect(ed.doc).toBe("- [ ] a\n- [ ] b\n- c");
  });

  test("the tile is lit only when every selected item has that shape, and then clears them", () => {
    const doc = "- a\n- b\n1. c";
    const mixed = new Fake(doc, lines(doc, 1, 3));
    expect(currentBlockType(mixed, item(0, 3))).toBeNull();
    const same = new Fake(doc, lines(doc, 1, 2));
    expect(currentBlockType(same, item(0, 3))).toBe("bullet");
    expect(applyBlockType(same, item(0, 3), "bullet")).toBe(true);
    expect(same.doc).toBe("a\nb\n\n1. c");
    expect(same.dispatches).toBe(1);
  });

  test("bullet and task swap markers, keeping a ticked box when it stays a task", () => {
    const doc = "1. a\n2. b";
    const ed = new Fake(doc, lines(doc, 1, 2));
    expect(applyBlockType(ed, item(0, 4), "bullet")).toBe(true);
    expect(ed.doc).toBe("- a\n- b");
    const doc2 = "- [x] a\n- b";
    const ed2 = new Fake(doc2, lines(doc2, 1, 2));
    expect(applyBlockType(ed2, item(0, 7), "task")).toBe(true);
    expect(ed2.doc).toBe("- [x] a\n- [ ] b");
  });

  test("the selection keeps covering the items, so a second pick works on all of them", () => {
    const doc = "- a\n- b";
    const ed = new Fake(doc, lines(doc, 1, 2));
    applyBlockType(ed, item(0, 3), "numbered");
    applyBlockType(ed, item(0, 4), "task");
    expect(ed.doc).toBe("- [ ] a\n- [ ] b");
  });

  test("a grip outside the selection converts only its own item", () => {
    const doc = "- a\n- b\n- c";
    const ed = new Fake(doc, lines(doc, 1, 2));
    expect(applyBlockType(ed, item(8, 11), "numbered")).toBe(true);
    expect(ed.doc).toBe("- a\n- b\n1. c");
  });
});
