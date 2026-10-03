import { describe, expect, test } from "vite-plus/test";
import { fitView, lerpView, slideOrder } from "../src/components/editor-area/board/board-present";
import { parseBoard } from "../src/components/editor-area/board/board-model";

const HEADER = '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}';
const frame = (id: string, x: number, y: number) =>
  `{"id":"${id}","t":"frame","x":${x},"y":${y},"w":1600,"h":900,"name":"${id}"}`;

describe("slideOrder", () => {
  test("sections read in rows, left to right", () => {
    const { scene } = parseBoard(
      [HEADER, frame("c", 0, 1000), frame("b", 1700, 40), frame("a", 0, 0)].join("\n"),
    );
    expect(slideOrder(scene).map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [1700, 40],
      [0, 1000],
    ]);
  });

  test("a board without sections is one slide of everything", () => {
    const { scene } = parseBoard(
      [HEADER, '{"id":"s","t":"sticky","x":10,"y":20,"c":"yellow","tx":"x"}'].join("\n"),
    );
    expect(slideOrder(scene)).toEqual([{ x: 10, y: 20, w: 200, h: 200 }]);
  });
});

describe("camera", () => {
  test("fitView centres the slide and fits its tighter side", () => {
    const v = fitView({ x: 0, y: 0, w: 1600, h: 900 }, 1000, 1000, 0);
    expect(v.zoom).toBeCloseTo(1000 / 1600);
    expect(v.x + 1000 / v.zoom / 2).toBeCloseTo(800);
    expect(v.y + 1000 / v.zoom / 2).toBeCloseTo(450);
  });

  test("lerpView starts and ends exactly on its viewports", () => {
    const a = { x: 0, y: 0, zoom: 1 };
    const b = { x: 500, y: 200, zoom: 2 };
    expect(lerpView(a, b, 0, 800, 600)).toEqual(a);
    const end = lerpView(a, b, 1, 800, 600);
    expect(end.x).toBeCloseTo(500);
    expect(end.zoom).toBeCloseTo(2);
  });
});
