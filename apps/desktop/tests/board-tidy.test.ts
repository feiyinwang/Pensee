import { describe, expect, test } from "vite-plus/test";
import {
  emptyScene,
  type LinkerEl,
  type ShapeEl,
} from "../src/components/editor-area/board/board-model";
import { QUICK_GAP, connectorBetween } from "../src/components/editor-area/board/board-flow";
import { boxesOverlap } from "../src/components/editor-area/board/board-geometry";
import { tidyFlow } from "../src/components/editor-area/board/board-tidy";

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

const ROW = 110 + QUICK_GAP / 2;

describe("tidyFlow", () => {
  test("columns to the right, next steps stacked in order, parent centred", () => {
    const root = rect("root", 0, 0);
    // Messy: children scattered, but "b" is above "c" which is above "d".
    const b = rect("b", 700, -300);
    const c = rect("c", 300, 40);
    const d = rect("d", 500, 900);
    const e = rect("e", 20, 600); // a grandchild via c
    const links = [
      connectorBetween(root, d),
      connectorBetween(root, b),
      connectorBetween(root, c),
      connectorBetween(c, e),
    ];
    // Pinned sides from earlier placements get reset to right → left.
    links[0].b1 = { ...(links[0].b1 as NonNullable<LinkerEl["b1"]>), sd: "s" };
    const scene = { ...emptyScene(), els: [root, b, c, d, e, ...links] };
    const moved = tidyFlow(scene);
    expect(moved.sort()).toEqual(["b", "c", "d", "e"]);
    const col1 = 160 + QUICK_GAP;
    expect([b.x, c.x, d.x]).toEqual([col1, col1, col1]);
    expect(e.x).toBe(col1 + 160 + QUICK_GAP);
    expect(c.y - b.y).toBe(ROW);
    expect(d.y - c.y).toBe(ROW);
    // The root keeps its spot and sits level with the middle child.
    expect(root).toMatchObject({ x: 0, y: 0 });
    expect(c.y).toBe(0);
    expect(e.y).toBe(c.y);
    for (const l of links) expect([l.b1?.sd, l.b2?.sd]).toEqual(["e", "w"]);
  });

  test("a cycle still lays out, and the closing link finds its own sides", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 0, 400);
    const ab = connectorBetween(a, b, "s");
    const ba = connectorBetween(b, a, "n");
    tidyFlow({ ...emptyScene(), els: [a, b, ab, ba] });
    expect(b.x).toBe(160 + QUICK_GAP);
    expect(b.y).toBe(0);
    expect(ab.b1?.sd).toBe("e");
    expect(ba.b1?.sd).toBeUndefined();
  });

  test("groups don't end up on top of each other; unjoined cards stay", () => {
    const a = rect("a", 0, 0);
    const a1 = rect("a1", 0, 200);
    const a2 = rect("a2", 0, 400);
    const z = rect("z", 0, 150);
    const z1 = rect("z1", 900, 150);
    const lone = rect("lone", 2000, 2000);
    const scene = {
      ...emptyScene(),
      els: [
        a,
        a1,
        a2,
        z,
        z1,
        lone,
        connectorBetween(a, a1),
        connectorBetween(a, a2),
        connectorBetween(z, z1),
      ],
    };
    tidyFlow(scene);
    const first = [a, a1, a2];
    for (const p of first) for (const q of [z, z1]) expect(boxesOverlap(p, q)).toBe(false);
    expect(lone).toMatchObject({ x: 2000, y: 2000 });
  });

  test("with a scope, only the groups holding it move", () => {
    const a = rect("a", 0, 0);
    const a1 = rect("a1", 0, 300);
    const z = rect("z", 0, 1000);
    const z1 = rect("z1", 0, 1300);
    const scene = {
      ...emptyScene(),
      els: [a, a1, z, z1, connectorBetween(a, a1), connectorBetween(z, z1)],
    };
    expect(tidyFlow(scene, new Set(["z1"]))).toEqual(["z1"]);
    expect(a1).toMatchObject({ x: 0, y: 300 });
  });

  test("an already tidy board moves nothing", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 160 + QUICK_GAP, 0);
    expect(tidyFlow({ ...emptyScene(), els: [a, b, connectorBetween(a, b)] })).toEqual([]);
  });
});
