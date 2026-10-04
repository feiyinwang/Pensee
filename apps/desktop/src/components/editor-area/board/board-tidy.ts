/**
 * Tidy up — pure, no DOM. Lays out the cards joined by arrows as left-to-right
 * trees: each step one column to the right of the card it comes from, a
 * card's next steps stacked in their current top-to-bottom order, and every
 * card centred on the steps after it. Arrows along the tree leave the right
 * side and enter the left, like cards placed with quick connect.
 */

import {
  type BoardScene,
  type LinkerEl,
  type ShapeEl,
  type StickyEl,
  isLinker,
} from "./board-model";
import { type Box, boxesOverlap } from "./board-geometry";
import { QUICK_GAP, canQuickConnect } from "./board-flow";

type Card = ShapeEl | StickyEl;

/** Between columns, and between stacked cards — the quick-connect spacing. */
const COL_GAP = QUICK_GAP;
const ROW_GAP = QUICK_GAP / 2;

/**
 * Tidies, in place, every group of joined cards — or with `scope`, only the
 * groups holding one of those ids. The first root of each group keeps its
 * spot; groups that would then overlap one another move down. Returns the
 * ids of the cards it moved (empty: nothing to tidy).
 */
export function tidyFlow(scene: BoardScene, scope?: ReadonlySet<string>): string[] {
  const cards = new Map<string, Card>();
  for (const el of scene.els) if (canQuickConnect(el)) cards.set(el.id, el);

  const out = new Map<string, { to: string; link: LinkerEl }[]>();
  const indeg = new Map<string, number>();
  const links: LinkerEl[] = [];
  const parent = new Map<string, string>(); // union-find, for groups
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(id, r);
    return r;
  };
  for (const id of cards.keys()) parent.set(id, id);
  for (const el of scene.els) {
    if (!isLinker(el) || !el.b1 || !el.b2) continue;
    const a = el.b1.el;
    const b = el.b2.el;
    if (a === b || !cards.has(a) || !cards.has(b)) continue;
    links.push(el);
    out.set(a, [...(out.get(a) ?? []), { to: b, link: el }]);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
    parent.set(find(a), find(b));
  }

  const groups = new Map<string, Card[]>();
  for (const link of links) {
    for (const id of [link.b1?.el, link.b2?.el] as string[]) {
      const root = find(id);
      const list = groups.get(root) ?? [];
      if (!list.some((c) => c.id === id)) list.push(cards.get(id) as Card);
      groups.set(root, list);
    }
  }

  const byPos = (a: Card, b: Card) => a.y - b.y || a.x - b.x;
  const treeLinks = new Set<LinkerEl>();
  const placed: Box[] = [];
  const moved: string[] = [];
  const todo = [...groups.values()]
    .filter((g) => !scope || g.some((c) => scope.has(c.id)))
    .map((g) => g.sort(byPos));
  // Top groups first, so a lower one is the one that moves out of the way.
  todo.sort((a, b) => byPos(a[0], b[0]));

  for (const group of todo) {
    // Spanning tree, breadth first from the cards nothing points into
    // (top to bottom); a cycle with no such card starts from its leftmost.
    const kids = new Map<string, Card[]>();
    const depth = new Map<string, number>();
    const roots: Card[] = [];
    const visit = (root: Card) => {
      roots.push(root);
      depth.set(root.id, 0);
      const queue = [root];
      while (queue.length) {
        const c = queue.shift() as Card;
        const next: Card[] = [];
        for (const { to, link } of out.get(c.id) ?? []) {
          if (depth.has(to)) continue;
          depth.set(to, (depth.get(c.id) as number) + 1);
          treeLinks.add(link);
          next.push(cards.get(to) as Card);
        }
        next.sort(byPos);
        kids.set(c.id, next);
        queue.push(...next);
      }
    };
    for (const c of group) if (!indeg.get(c.id)) visit(c);
    for (const c of [...group].sort((a, b) => a.x - b.x || a.y - b.y)) {
      if (!depth.has(c.id)) visit(c);
    }

    const colW: number[] = [];
    for (const c of group) {
      const d = depth.get(c.id) as number;
      colW[d] = Math.max(colW[d] ?? 0, c.w);
    }
    const colX: number[] = [0];
    for (let d = 1; d < colW.length; d += 1) colX[d] = colX[d - 1] + colW[d - 1] + COL_GAP;

    const heights = new Map<string, number>();
    const height = (c: Card): number => {
      const ks = kids.get(c.id) ?? [];
      const span = ks.reduce((sum, k) => sum + height(k), 0) + ROW_GAP * Math.max(ks.length - 1, 0);
      const h = Math.max(c.h, span);
      heights.set(c.id, h);
      return h;
    };
    const pos = new Map<string, { x: number; y: number }>();
    const place = (c: Card, top: number): void => {
      const ks = kids.get(c.id) ?? [];
      const x = colX[depth.get(c.id) as number];
      if (!ks.length) {
        pos.set(c.id, { x, y: top });
        return;
      }
      const span =
        ks.reduce((sum, k) => sum + (heights.get(k.id) as number), 0) + ROW_GAP * (ks.length - 1);
      let y = top + ((heights.get(c.id) as number) - span) / 2;
      for (const k of ks) {
        place(k, y);
        y += (heights.get(k.id) as number) + ROW_GAP;
      }
      const first = pos.get(ks[0].id) as { y: number };
      const last = pos.get(ks[ks.length - 1].id) as { y: number };
      const mid = (first.y + ks[0].h / 2 + last.y + ks[ks.length - 1].h / 2) / 2;
      pos.set(c.id, { x, y: mid - c.h / 2 });
    };
    let top = 0;
    for (const r of roots) {
      const h = height(r); // fills `heights`, which `place` reads
      place(r, top);
      top += h + ROW_GAP * 2;
    }

    // The first root stays put; the rest follows it.
    const anchor = pos.get(roots[0].id) as { x: number; y: number };
    let dx = roots[0].x - anchor.x;
    let dy = roots[0].y - anchor.y;
    const bounds = (): Box => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of group) {
        const p = pos.get(c.id) as { x: number; y: number };
        x0 = Math.min(x0, p.x + dx);
        y0 = Math.min(y0, p.y + dy);
        x1 = Math.max(x1, p.x + dx + c.w);
        y1 = Math.max(y1, p.y + dy + c.h);
      }
      return {
        x: x0 - ROW_GAP,
        y: y0 - ROW_GAP,
        w: x1 - x0 + 2 * ROW_GAP,
        h: y1 - y0 + 2 * ROW_GAP,
      };
    };
    for (let box = bounds(), hit = placed.find((b) => boxesOverlap(b, box)); hit; ) {
      dy += hit.y + hit.h - box.y;
      box = bounds();
      hit = placed.find((b) => boxesOverlap(b, box));
    }
    placed.push(bounds());

    for (const c of group) {
      const p = pos.get(c.id) as { x: number; y: number };
      const x = Math.round(p.x + dx);
      const y = Math.round(p.y + dy);
      if (x !== c.x || y !== c.y) moved.push(c.id);
      c.x = x;
      c.y = y;
    }
  }

  const tidied = new Set(todo.flat().map((c) => c.id));
  for (const link of links) {
    if (!tidied.has(link.b1?.el as string)) continue;
    if (treeLinks.has(link)) {
      (link.b1 as NonNullable<LinkerEl["b1"]>).sd = "e";
      (link.b2 as NonNullable<LinkerEl["b2"]>).sd = "w";
    } else {
      // A link across the tree finds its own sides.
      delete link.b1?.sd;
      delete link.b2?.sd;
    }
  }
  return moved;
}
