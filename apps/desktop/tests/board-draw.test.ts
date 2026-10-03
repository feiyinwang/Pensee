import { describe, expect, test } from "vite-plus/test";
import { simplify, smoothPath, strokeFrom } from "../src/components/editor-area/board/board-draw";
import {
  defaultStyle,
  parseBoard,
  serializeBoard,
  emptyScene,
} from "../src/components/editor-area/board/board-model";

describe("pen strokes", () => {
  test("a straight run of points collapses to its ends", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplify(line, 0.5)).toEqual([line[0], line[49]]);
  });

  test("corners survive simplification", () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ];
    expect(simplify(corner, 0.5)).toEqual([corner[0], corner[2], corner[4]]);
  });

  test("a stroke is stored relative to its top-left and round-trips", () => {
    const stroke = strokeFrom(
      [
        { x: 100, y: 50 },
        { x: 130, y: 90 },
        { x: 160, y: 40 },
      ],
      defaultStyle({ w: 2 }),
      0.5,
    )!;
    expect([stroke.x, stroke.y, stroke.w, stroke.h]).toEqual([100, 40, 60, 50]);
    const scene = emptyScene();
    scene.els.push(stroke);
    expect(parseBoard(serializeBoard(scene)).scene.els[0]).toEqual(stroke);
    expect(smoothPath(stroke.pts)).toMatch(/^M0 10 Q30 50/);
  });
});
