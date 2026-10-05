import { describe, expect, test } from "vite-plus/test";
import { boltPoints, edgePoint, sideOf } from "../src/components/editor-area/board/board-spark";

describe("docking spark geometry", () => {
  test("a bolt keeps both ends pinned and stays within its amplitude", () => {
    let i = 0;
    const rnd = () => [0, 1, 0.25, 0.9][i++ % 4];
    const pts = boltPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, 5, rnd);
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)).toEqual({ x: 100, y: 0 });
    for (const q of pts) expect(Math.abs(q.y)).toBeLessThanOrEqual(8);
    expect(pts.slice(1, -1).map((q) => q.x)).toEqual([20, 40, 60, 80]);
  });

  test("the contact point is where the centre line leaves the box", () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    expect(edgePoint(box, { x: 400, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(edgePoint(box, { x: 100, y: -300 })).toEqual({ x: 100, y: 0 });
  });

  test("sideOf names the edge a point sits on, in half-sizes", () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    expect(sideOf(box, { x: 200, y: 40 })).toBe("e");
    expect(sideOf(box, { x: 0, y: 60 })).toBe("w");
    expect(sideOf(box, { x: 120, y: 0 })).toBe("n");
    expect(sideOf(box, { x: 80, y: 100 })).toBe("s");
  });
});
