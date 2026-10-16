import { describe, expect, test } from "vite-plus/test";
import {
  BEAT_MS,
  beatAt,
  easeOut,
  edgePoint,
  pointAlong,
  sideOf,
} from "../src/components/editor-area/board/board-spark";

describe("docking glow geometry", () => {
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

  test("pointAlong walks an elbow route by distance", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 100 },
    ];
    expect(pointAlong(route, 20)).toEqual({ x: 20, y: 0 });
    expect(pointAlong(route, 90)).toEqual({ x: 40, y: 50 });
    expect(pointAlong(route, 500)).toEqual({ x: 40, y: 100 });
  });
});

describe("docking glow beat", () => {
  test("the halo is dimmest as the dock is offered and brightest mid-beat", () => {
    expect(beatAt(0).breath).toBeCloseTo(0);
    expect(beatAt(BEAT_MS / 2).breath).toBeCloseTo(1);
    expect(beatAt(BEAT_MS).breath).toBeCloseTo(0);
  });

  test("a ring goes out at each peak and is gone before the next", () => {
    expect(beatAt(BEAT_MS / 4).ring).toBeNull();
    expect(beatAt(BEAT_MS / 2).ring).toBeCloseTo(0);
    expect(beatAt(BEAT_MS / 2 + BEAT_MS * 0.3).ring).toBeCloseTo(0.5);
    expect(beatAt(BEAT_MS / 2 + BEAT_MS * 0.7).ring).toBeNull();
    expect(beatAt(BEAT_MS * 1.5).ring).toBeCloseTo(0);
  });

  test("reduced motion: full glow, no ring", () => {
    expect(beatAt(Infinity)).toEqual({ breath: 1, ring: null });
  });

  test("easeOut is --ease-out: pinned ends, fast start", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.25)).toBeGreaterThan(0.7);
    expect(easeOut(0.5)).toBeLessThanOrEqual(1);
  });
});
