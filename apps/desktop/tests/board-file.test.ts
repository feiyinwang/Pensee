import { describe, expect, test } from "vite-plus/test";
import {
  isBoardFile,
  readBoardSvg,
  relativePath,
} from "../src/components/editor-area/board/board-file";
import { serializeBoard } from "../src/components/editor-area/board/board-model";

const HEADER = '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}';
const STICKY =
  '{"id":"a1","t":"sticky","x":10,"y":20,"w":200,"h":200,"c":"yellow","tx":"a < b & c"}';

function file(meta: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" data-writer-board="1">\n<metadata id="writer-board">\n${meta}\n</metadata>\n<g/>\n</svg>\n`;
}

describe("readBoardSvg", () => {
  test("reads the scene out of escaped metadata", () => {
    const escaped = STICKY.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const parsed = readBoardSvg(file(`${HEADER}\n${escaped}`));
    expect(parsed?.badLines).toBe(0);
    expect(parsed?.scene.els).toHaveLength(1);
    const el = parsed!.scene.els[0];
    expect(el.t === "sticky" && el.tx).toBe("a < b & c");
  });

  test("accepts a CDATA body from an outside tool", () => {
    const parsed = readBoardSvg(file(`<![CDATA[${HEADER}\n${STICKY}]]>`));
    expect(parsed?.scene.els).toHaveLength(1);
  });

  test("keeps one element per line so diffs stay small", () => {
    const parsed = readBoardSvg(file(`${HEADER}\n${STICKY}`))!;
    expect(serializeBoard(parsed.scene).split("\n")).toHaveLength(2);
  });

  test("returns null for an SVG with no Pensée scene", () => {
    expect(readBoardSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
  });
});

describe("isBoardFile", () => {
  test("matches the double extension only", () => {
    expect(isBoardFile("note-assets/x.board.svg")).toBe(true);
    expect(isBoardFile("note-assets/X.BOARD.SVG?v=2")).toBe(true);
    expect(isBoardFile("note-assets/x.svg")).toBe(false);
  });
});

describe("relativePath", () => {
  test("sibling, child and parent paths", () => {
    expect(relativePath("/w/note-assets", "/w/note-assets/a.png")).toBe("a.png");
    expect(relativePath("/w", "/w/note-assets/a.png")).toBe("note-assets/a.png");
    expect(relativePath("/w/note-assets", "/w/pics/a.png")).toBe("../pics/a.png");
  });
});
