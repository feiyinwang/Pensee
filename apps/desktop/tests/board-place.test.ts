import { describe, expect, test } from "vite-plus/test";
import {
  emptyScene,
  parseBoard,
  serializeBoard,
  type LinkerEl,
  type ShapeEl,
} from "../src/components/editor-area/board/board-model";
import {
  ATTACH_REACH,
  QUICK_GAP,
  connectorBetween,
  placeNear,
} from "../src/components/editor-area/board/board-flow";
import { routeLinker } from "../src/components/editor-area/board/board-geometry";

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

describe("connectorBetween with a placement side", () => {
  // A step placed to the right that slid down below its siblings.
  const a = rect("a", 0, 0);
  const b = rect("b", 160 + QUICK_GAP, 300);

  test("enters the new item from the side it was placed on", () => {
    const scene = { ...emptyScene(), els: [a, b] };
    const arrow = connectorBetween(a, b, "e");
    expect(arrow.b2?.sd).toBe("w");
    const route = routeLinker(scene, arrow);
    const end = route[route.length - 1];
    expect(end).toEqual({ x: b.x - 4, y: b.y + b.h / 2 });
    // Leaves the source from the bottom, then turns right: an L.
    expect(route).toHaveLength(3);
    expect(route[0]).toEqual({ x: 80, y: 110 + 4 });
  });

  test("keeps the pinned side through a save and load", () => {
    const scene = { ...emptyScene(), els: [a, b, connectorBetween(a, b, "e")] };
    const back = parseBoard(serializeBoard(scene));
    const arrow = back.scene.els.find((el) => el.t === "arrow") as LinkerEl;
    expect(arrow.b2?.sd).toBe("w");
    expect(arrow.b1?.sd).toBeUndefined();
  });
});
