import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { htmlBlockParserExtension } from "../src/components/editor-area/html-block-decorations";
import { transcriptEdges } from "../src/components/editor-area/transcript-edges";
import { withFullParse } from "./helpers/parsed-state";

const BLOCK = [
  "<details>",
  "<summary>Transcript</summary>",
  "<p><small>0:00</small> Welcome.</p>",
  "</details>",
].join("\n");

function makeState(doc: string, at = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [markdown({ extensions: [GFM, htmlBlockParserExtension] }), transcriptEdges],
  });
  return withFullParse(state);
}

/** Type `text` at `at`, the way an input transaction does. */
function typeAt(doc: string, at: number, text: string) {
  const state = makeState(doc, at);
  const next = state.update({
    changes: { from: at, insert: text },
    selection: EditorSelection.cursor(at + text.length),
    userEvent: "input.type",
  }).state;
  return { doc: next.doc.toString(), caret: next.selection.main.head };
}

describe("typing at the transcript's edges", () => {
  test("before <details> goes on its own line above the box", () => {
    const { doc, caret } = typeAt(`${BLOCK}\n\nNotes`, 0, "Hello");
    expect(doc).toBe(`Hello\n\n${BLOCK}\n\nNotes`);
    expect(caret).toBe(5);
  });

  test("after </details> on its line goes below a blank line", () => {
    const { doc, caret } = typeAt(`${BLOCK}\n\nNotes`, BLOCK.length, "Hello");
    expect(doc).toBe(`${BLOCK}\n\nHello\n\nNotes`);
    expect(caret).toBe(BLOCK.length + 2 + 5);
  });

  test("on the empty line under the box keeps that line blank", () => {
    const { doc, caret } = typeAt(`${BLOCK}\n\nNotes`, BLOCK.length + 1, "Hello");
    expect(doc).toBe(`${BLOCK}\n\nHello\nNotes`);
    expect(caret).toBe(BLOCK.length + 2 + 5);
  });

  test("in a note with nothing under the box yet", () => {
    const { doc } = typeAt(`${BLOCK}\n`, BLOCK.length + 1, "H");
    expect(doc).toBe(`${BLOCK}\n\nH`);
  });

  test("the next keystroke on that line is left alone", () => {
    const { doc } = typeAt(`${BLOCK}\n\nH`, BLOCK.length + 3, "e");
    expect(doc).toBe(`${BLOCK}\n\nHe`);
  });

  test("Enter at the box's edges is left alone", () => {
    expect(typeAt(`${BLOCK}\n`, 0, "\n").doc).toBe(`\n${BLOCK}\n`);
    expect(typeAt(`${BLOCK}\n`, BLOCK.length + 1, "\n").doc).toBe(`${BLOCK}\n\n`);
  });

  test("a <details> that isn't a transcript is left alone", () => {
    const other = "<details>\n<summary>More</summary>\n</details>";
    expect(typeAt(`${other}\n`, 0, "x").doc).toBe(`x${other}\n`);
  });
});

describe("a caret placed at the box's start", () => {
  test("lands on the line under the box", () => {
    const state = makeState(`${BLOCK}\n\nNotes`, 10);
    const next = state.update({ selection: { anchor: 0 } }).state;
    expect(next.selection.main.head).toBe(BLOCK.length + 1);
  });

  test("lands after the box when nothing follows it", () => {
    const state = makeState(BLOCK, 10);
    const next = state.update({ selection: { anchor: 0 } }).state;
    expect(next.selection.main.head).toBe(BLOCK.length);
  });

  test("moved there by the arrow keys stays", () => {
    const state = makeState(`${BLOCK}\n\nNotes`, BLOCK.length + 1);
    const next = state.update({ selection: { anchor: 0 }, userEvent: "select" }).state;
    expect(next.selection.main.head).toBe(0);
  });

  test("as a note swaps in, lands under the box", () => {
    const state = makeState("old", 0);
    const doc = `${BLOCK}\n\nNotes`;
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: doc },
      selection: EditorSelection.cursor(0),
      userEvent: "pensee.swap",
    }).state;
    expect(next.selection.main.head).toBe(BLOCK.length + 1);
  });
});
