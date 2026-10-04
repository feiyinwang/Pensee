import { describe, expect, test } from "vite-plus/test";
import { emptyScene, type ShapeEl } from "../src/components/editor-area/board/board-model";
import { ATTACH_REACH, QUICK_GAP, placeNear } from "../src/components/editor-area/board/board-flow";

const rect = (id: string, x: number, y: number): ShapeEl => ({
  id,
  t: "roundRect",
  x,
  y,
  w: 160,
  h: 110,
  a: 0,
  op: 1,
  st: { s: "ink", f: "none", w: 1.5, d: "solid", r: 8 },
});

describe("placeNear", () => {
  test("centres on the cursor when nothing is near", () => {
    const scene = { ...emptyScene(), els: [rect("a", 0, 0)] };
    const spot = placeNear(scene, { x: 1000, y: 1000 }, 160, 110);
    expect(spot.from).toBeNull();
    expect(spot.box).toEqual({ x: 920, y: 945, w: 160, h: 110 });
  });

  test("lines up beside a nearby shape on the side facing the cursor", () => {
    const scene = { ...emptyScene(), els: [rect("a", 0, 0)] };
    const right = placeNear(scene, { x: 160 + 60, y: 40 }, 160, 110);
    expect(right.from?.id).toBe("a");
    expect(right.side).toBe("e");
    expect(right.box).toEqual({ x: 160 + QUICK_GAP, y: 0, w: 160, h: 110 });
    const below = placeNear(scene, { x: 70, y: 110 + 50 }, 160, 110);
    expect(below.side).toBe("s");
    expect(below.box.y).toBe(110 + QUICK_GAP);
  });

  test("ignores shapes out of reach and the cursor on top of a shape", () => {
    const scene = { ...emptyScene(), els: [rect("a", 0, 0)] };
    expect(placeNear(scene, { x: 160 + ATTACH_REACH + 5, y: 50 }, 160, 110).from).toBeNull();
    expect(placeNear(scene, { x: 80, y: 50 }, 160, 110).from).toBeNull();
  });

  test("slides along when the spot beside is taken", () => {
    const scene = { ...emptyScene(), els: [rect("a", 0, 0), rect("b", 160 + QUICK_GAP, 0)] };
    const spot = placeNear(scene, { x: 200, y: 50 }, 160, 110);
    expect(spot.from?.id).toBe("a");
    expect(spot.box.y).not.toBe(0);
  });
});
