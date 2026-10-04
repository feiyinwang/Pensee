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
  dockTarget,
  nextStepBox,
  placeNear,
} from "../src/components/editor-area/board/board-flow";
import {
  boxesOverlap,
  nearestSide,
  routeLinker,
} from "../src/components/editor-area/board/board-geometry";

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
    // Leaves the middle of the source's right side, down a trunk halfway
    // across the gap, then right into the new card: a Z.
    expect(arrow.b1?.sd).toBe("e");
    expect(route[0]).toEqual({ x: 160 + 4, y: 55 });
    expect(route).toHaveLength(4);
    expect(route[1].x).toBe(160 + QUICK_GAP / 2);
  });

  test("keeps the pinned side through a save and load", () => {
    const scene = { ...emptyScene(), els: [a, b, connectorBetween(a, b, "e")] };
    const back = parseBoard(serializeBoard(scene));
    const arrow = back.scene.els.find((el) => el.t === "arrow") as LinkerEl;
    expect(arrow.b2?.sd).toBe("w");
    expect(arrow.b1?.sd).toBe("e");
  });
});

describe("nearestSide", () => {
  const box = rect("a", 0, 0); // 160 × 110

  test("picks the side closest to the drop point, any of the four", () => {
    expect(nearestSide(box, { x: 10, y: 55 })).toBe("w");
    expect(nearestSide(box, { x: 150, y: 55 })).toBe("e");
    expect(nearestSide(box, { x: 80, y: 5 })).toBe("n");
    expect(nearestSide(box, { x: 80, y: 105 })).toBe("s");
  });

  test("a pinned side holds on a straight line too", () => {
    const b = rect("b", 400, 0);
    const line = connectorBetween(box, b);
    line.sh = "straight";
    line.b2 = { el: "b", fx: 0, gap: 6, sd: "s" };
    const route = routeLinker({ ...emptyScene(), els: [box, b] }, line);
    expect(route[route.length - 1]).toEqual({ x: 480, y: 116 });
  });
});

describe("nextStepBox never overlaps", () => {
  test("slides past a full column, ignoring arrows that span it", () => {
    const src = rect("src", 0, 0);
    const x = 160 + QUICK_GAP;
    // Ten cards stacked to the right, both above and below the source.
    const column = Array.from({ length: 10 }, (_, i) => rect(`c${i}`, x, (i - 5) * 150));
    // A connector whose stored points cover the whole column.
    const stale = connectorBetween(src, column[9]);
    stale.pts = [
      [0, -2000],
      [400, 2000],
    ];
    const scene = { ...emptyScene(), els: [src, ...column, stale] };
    const box = nextStepBox(src, "e", scene);
    expect(box.x).toBe(x);
    for (const c of column) expect(boxesOverlap(box, c)).toBe(false);
  });
});

describe("dockTarget", () => {
  test("a card dragged near another docks into the slot after it", () => {
    const a = rect("a", 0, 0);
    const card = rect("card", 160 + 50, 30); // 50 to the right, a bit low
    const dock = dockTarget({ ...emptyScene(), els: [a, card] }, card);
    expect(dock?.from.id).toBe("a");
    expect(dock?.side).toBe("e");
    expect(dock?.box).toEqual({ x: 160 + QUICK_GAP, y: 0, w: 160, h: 110 });
  });

  test("nothing when out of reach, overlapping, or already joined", () => {
    const a = rect("a", 0, 0);
    const far = rect("far", 160 + 400, 0);
    expect(dockTarget({ ...emptyScene(), els: [a, far] }, far)).toBeNull();
    const onTop = rect("top", 40, 40);
    expect(dockTarget({ ...emptyScene(), els: [a, onTop] }, onTop)).toBeNull();
    const near = rect("near", 160 + 50, 0);
    const joined = { ...emptyScene(), els: [a, near, connectorBetween(a, near, "e")] };
    expect(dockTarget(joined, near)).toBeNull();
  });
});
