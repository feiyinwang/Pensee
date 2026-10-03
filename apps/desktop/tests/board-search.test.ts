import { describe, expect, test } from "vite-plus/test";
import { findMatches, replaceInElement } from "../src/components/editor-area/board/board-search";
import { parseBoard } from "../src/components/editor-area/board/board-model";

const BOARD = [
  '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
  '{"id":"b","t":"sticky","x":0,"y":300,"c":"yellow","tx":"Ship the beta"}',
  '{"id":"a","t":"rect","x":0,"y":0,"w":100,"h":60,"lb":{"tx":"Beta (v0.9) plan"}}',
  '{"id":"f","t":"frame","x":500,"y":0,"w":400,"h":300,"name":"Beta launch"}',
  '{"id":"l","t":"arrow","x":0,"y":0,"w":0,"h":0,"pts":[[0,0],[10,0]],"lb":{"tx":"no"}}',
].join("\n");

describe("board find & replace", () => {
  test("finds labels, notes and section names, case-insensitively, in reading order", () => {
    const { scene } = parseBoard(BOARD);
    expect(findMatches(scene, "BETA")).toEqual(["a", "f", "b"]);
    expect(findMatches(scene, "  ")).toEqual([]);
  });

  test("treats the query literally", () => {
    const { scene } = parseBoard(BOARD);
    expect(findMatches(scene, "(v0.9)")).toEqual(["a"]);
    expect(findMatches(scene, "v0?9")).toEqual([]);
  });

  test("replaces every occurrence in an element, keeping the rest", () => {
    const { scene } = parseBoard(BOARD);
    const shape = scene.els.find((e) => e.id === "a")!;
    expect(replaceInElement(shape, "beta", "GA")).toBe(1);
    expect(shape.t !== "text" && "lb" in shape && shape.lb?.tx).toBe("GA (v0.9) plan");
    const frame = scene.els.find((e) => e.id === "f")!;
    replaceInElement(frame, "Beta launch", "");
    expect(frame.t === "frame" && frame.name).toBe("Section");
  });
});
