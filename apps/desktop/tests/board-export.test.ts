import { describe, expect, test } from "vite-plus/test";
import { exportSubset } from "../src/components/editor-area/board/board-export";
import { parseBoard } from "../src/components/editor-area/board/board-model";

const BOARD = [
  '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
  '{"id":"f","t":"frame","x":0,"y":0,"w":400,"h":300,"name":"S"}',
  '{"id":"in","t":"rect","x":20,"y":20,"w":50,"h":50,"fr":"f"}',
  '{"id":"a","t":"rect","x":600,"y":0,"w":50,"h":50}',
  '{"id":"b","t":"rect","x":800,"y":0,"w":50,"h":50}',
  '{"id":"ab","t":"arrow","x":0,"y":0,"w":0,"h":0,"pts":[[0,0],[1,0]],"b1":{"el":"a"},"b2":{"el":"b"}}',
  '{"id":"ax","t":"arrow","x":0,"y":0,"w":0,"h":0,"pts":[[0,0],[1,0]],"b1":{"el":"a"},"b2":{"el":"in"}}',
].join("\n");

describe("exportSubset", () => {
  const { scene } = parseBoard(BOARD);
  const ids = (sel: string[]) => exportSubset(scene, new Set(sel)).els.map((e) => e.id);

  test("a section brings its contents", () => {
    expect(ids(["f"])).toEqual(["f", "in"]);
  });

  test("connectors come along only when both ends do", () => {
    expect(ids(["a", "b"])).toEqual(["a", "b", "ab"]);
    expect(ids(["a"])).toEqual(["a"]);
  });

  test("the board itself is untouched", () => {
    exportSubset(scene, new Set(["a"]));
    expect(scene.els).toHaveLength(6);
  });
});
