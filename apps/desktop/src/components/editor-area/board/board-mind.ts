/**
 * Mind maps — pure tree operations and layout, no DOM.
 *
 * A mind map is `MindEl` topics linked by `pa` (parent id). Order among
 * siblings is their order in `scene.els`. Layout is Lark's default: the root
 * in the middle, first-level topics split across both sides (balanced by
 * subtree height unless pinned with `sd`), each subtree stacked vertically and
 * centred on its parent, branches drawn as curves in the first-level topic's
 * colour.
 *
 * Layout writes x/y/w/h onto the elements, so a saved board renders the map
 * exactly as laid out in any SVG viewer.
 */

import { type BoardEl, type BoardScene, type ColorToken, type MindEl, newId } from "./board-model";

export type Measure = (text: string, size: number) => number;

export const MIND_PALETTE: ColorToken[] = ["blue", "orange", "green", "purple", "red"];

export const MIND = {
  padX: 16,
  padY: 9,
  /** horizontal gap parent → child */
  hGap: 56,
  /** vertical gap between sibling subtrees */
  vGap: 14,
  lineHeight: 1.35,
  minW: 56,
} as const;

export function isMind(el: BoardEl | null | undefined): el is MindEl {
  return el?.t === "mind";
}

export function mindChildren(scene: BoardScene, id: string): MindEl[] {
  return scene.els.filter((el): el is MindEl => isMind(el) && el.pa === id);
}

/**
 * Id and child lookups for one pass over a scene that does not change during
 * it (a render). Each map is built on first use. Without one, the helpers
 * below scan `scene.els`, which made every topic of a large board cost
 * several full scans per render.
 */
export interface SceneLookup {
  el(id: string): BoardEl | undefined;
  kids(id: string): MindEl[];
}

export function sceneLookup(scene: BoardScene): SceneLookup {
  let byId: Map<string, BoardEl> | null = null;
  let byParent: Map<string, MindEl[]> | null = null;
  return {
    el(id) {
      if (!byId) {
        byId = new Map();
        // First wins, like `find`.
        for (const e of scene.els) if (!byId.has(e.id)) byId.set(e.id, e);
      }
      return byId.get(id);
    },
    kids(id) {
      if (!byParent) {
        byParent = new Map();
        for (const e of scene.els) {
          if (!isMind(e) || !e.pa) continue;
          const list = byParent.get(e.pa);
          if (list) list.push(e);
          else byParent.set(e.pa, [e]);
        }
      }
      return byParent.get(id) ?? [];
    },
  };
}

export function mindParent(scene: BoardScene, el: MindEl, look?: SceneLookup): MindEl | null {
  if (!el.pa) return null;
  const pa = el.pa;
  const parent = look ? look.el(pa) : scene.els.find((e) => e.id === pa);
  return isMind(parent) ? parent : null;
}

export function mindRoot(scene: BoardScene, el: MindEl): MindEl {
  let node = el;
  const seen = new Set<string>();
  for (
    let parent = mindParent(scene, node);
    parent && !seen.has(parent.id);
    parent = mindParent(scene, node)
  ) {
    seen.add(node.id);
    node = parent;
  }
  return node;
}

export function mindDepth(scene: BoardScene, el: MindEl, look?: SceneLookup): number {
  let depth = 0;
  const seen = new Set<string>();
  for (let p = mindParent(scene, el, look); p && !seen.has(p.id); p = mindParent(scene, p, look)) {
    seen.add(p.id);
    depth += 1;
  }
  return depth;
}

/** `id` and everything below it, parents before children. */
export function mindSubtree(scene: BoardScene, id: string): MindEl[] {
  const out: MindEl[] = [];
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const el = scene.els.find((e) => e.id === next);
    if (!isMind(el)) continue;
    out.push(el);
    for (const kid of mindChildren(scene, next)) queue.push(kid.id);
  }
  return out;
}

/** The colour a topic's branch is drawn in: its first-level ancestor's. */
export function branchColor(scene: BoardScene, el: MindEl, look?: SceneLookup): ColorToken {
  let node = el;
  let parent = mindParent(scene, node, look);
  if (!parent) return "ink";
  const seen = new Set<string>();
  while (parent.pa && !seen.has(parent.id)) {
    seen.add(parent.id);
    node = parent;
    const up = mindParent(scene, node, look);
    if (!up) break;
    parent = up;
  }
  if (node.c) return node.c;
  const siblings = look ? look.kids(parent.id) : mindChildren(scene, parent.id);
  const index = siblings.findIndex((k) => k.id === node.id);
  return MIND_PALETTE[Math.max(index, 0) % MIND_PALETTE.length];
}

export function mindFontSize(depth: number): number {
  return depth === 0 ? 18 : depth === 1 ? 15 : 14;
}

export function mindNodeSize(
  text: string,
  depth: number,
  measure: Measure,
): { w: number; h: number } {
  const size = mindFontSize(depth);
  const lines = (text || "Topic").split("\n");
  const w = Math.max(...lines.map((l) => measure(l || " ", size))) + MIND.padX * 2;
  const h = lines.length * size * MIND.lineHeight + MIND.padY * 2;
  return { w: Math.max(Math.ceil(w), MIND.minW), h: Math.ceil(h) };
}

/* -------------------------------------------------------------- layout */

/**
 * Lays out the whole tree under `rootId` in place. The root keeps its centre,
 * so editing a topic never makes the map jump away from where you are.
 */
export function layoutMind(scene: BoardScene, rootId: string, measure: Measure): void {
  const root = scene.els.find((e) => e.id === rootId);
  if (!isMind(root)) return;
  const nodes = mindSubtree(scene, rootId);
  const depth = new Map<string, number>([[rootId, 0]]);
  for (const n of nodes) {
    if (n.pa && depth.has(n.pa)) depth.set(n.id, depth.get(n.pa)! + 1);
  }
  const cx = root.x + root.w / 2;
  const cy = root.y + root.h / 2;
  for (const n of nodes) {
    const { w, h } = mindNodeSize(n.tx, depth.get(n.id) ?? 1, measure);
    n.w = w;
    n.h = h;
  }

  const subtreeH = new Map<string, number>();
  const measureTree = (n: MindEl): number => {
    const kids = mindChildren(scene, n.id);
    const stacked =
      kids.reduce((sum, k) => sum + measureTree(k), 0) + MIND.vGap * Math.max(kids.length - 1, 0);
    const total = Math.max(n.h, stacked);
    subtreeH.set(n.id, total);
    return total;
  };
  measureTree(root);

  // First-level topics: pinned sides stay; the rest go to the lighter side.
  const first = mindChildren(scene, rootId);
  let leftH = 0;
  let rightH = 0;
  for (const k of first) if (k.sd === "l") leftH += subtreeH.get(k.id)!;
  for (const k of first) if (k.sd === "r") rightH += subtreeH.get(k.id)!;
  for (const k of first) {
    if (k.sd) continue;
    k.sd = rightH <= leftH ? "r" : "l";
    if (k.sd === "r") rightH += subtreeH.get(k.id)!;
    else leftH += subtreeH.get(k.id)!;
  }

  // `cx/cy` were taken before the root was re-measured, so it grows in place.
  const place = (parent: MindEl, kids: MindEl[], side: "l" | "r"): void => {
    if (!kids.length) return;
    const total =
      kids.reduce((sum, k) => sum + subtreeH.get(k.id)!, 0) + MIND.vGap * (kids.length - 1);
    let top = parent.y + parent.h / 2 - total / 2;
    for (const k of kids) {
      const span = subtreeH.get(k.id)!;
      k.x = side === "r" ? parent.x + parent.w + MIND.hGap : parent.x - MIND.hGap - k.w;
      k.y = top + span / 2 - k.h / 2;
      place(k, mindChildren(scene, k.id), side);
      top += span + MIND.vGap;
    }
  };

  root.x = Math.round(cx - root.w / 2);
  root.y = Math.round(cy - root.h / 2);
  place(
    root,
    first.filter((k) => k.sd === "r"),
    "r",
  );
  place(
    root,
    first.filter((k) => k.sd === "l"),
    "l",
  );
  for (const n of nodes) {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
  }
}

/* -------------------------------------------------------------- editing */

function blankTopic(pa: string | undefined): MindEl {
  return { id: newId(), t: "mind", x: 0, y: 0, w: MIND.minW, h: 36, a: 0, op: 1, tx: "", pa };
}

export function newMindRoot(at: { x: number; y: number }, text = "Central topic"): MindEl {
  const root = blankTopic(undefined);
  root.tx = text;
  root.x = at.x - 70;
  root.y = at.y - 22;
  root.w = 140;
  root.h = 44;
  return root;
}

/** Inserts a child as the last of `parent`'s children (scene order is sibling
 *  order). First-level topics get the next palette colour. */
export function addMindChild(scene: BoardScene, parent: MindEl): MindEl {
  const kid = blankTopic(parent.id);
  const siblings = mindChildren(scene, parent.id);
  if (!parent.pa) kid.c = MIND_PALETTE[siblings.length % MIND_PALETTE.length];
  const after = siblings.length
    ? lastIndexOfSubtree(scene, siblings[siblings.length - 1].id)
    : scene.els.indexOf(parent);
  scene.els.splice(after + 1, 0, kid);
  // Start beside the parent so the first frame is not at the origin.
  kid.x = parent.x + parent.w + MIND.hGap;
  kid.y = parent.y;
  return kid;
}

/** A sibling right after `node`; on the root it is a child instead. */
export function addMindSibling(scene: BoardScene, node: MindEl): MindEl {
  const parent = mindParent(scene, node);
  if (!parent) return addMindChild(scene, node);
  const kid = blankTopic(parent.id);
  if (!parent.pa) {
    // No side yet: the layout puts it on the lighter side of the root.
    kid.c = MIND_PALETTE[mindChildren(scene, parent.id).length % MIND_PALETTE.length];
  }
  scene.els.splice(lastIndexOfSubtree(scene, node.id) + 1, 0, kid);
  kid.x = node.x;
  kid.y = node.y + node.h;
  return kid;
}

function lastIndexOfSubtree(scene: BoardScene, id: string): number {
  const ids = new Set(mindSubtree(scene, id).map((n) => n.id));
  let last = -1;
  scene.els.forEach((el, i) => {
    if (ids.has(el.id)) last = i;
  });
  return last;
}

/* --------------------------------------------------------------- drawing */

/** The branch from `parent` to `child`: a horizontal S-curve between the
 *  facing side midpoints. */
export function mindBranchPath(parent: BoardEl, child: BoardEl): string {
  const right = child.x >= parent.x + parent.w / 2;
  const sx = right ? parent.x + parent.w : parent.x;
  const sy = parent.y + parent.h / 2;
  const ex = right ? child.x : child.x + child.w;
  const ey = child.y + child.h / 2;
  const mx = (sx + ex) / 2;
  return `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
}
