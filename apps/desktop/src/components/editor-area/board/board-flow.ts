/**
 * Flowchart building blocks — pure, no DOM.
 *
 * Quick connect (Lark, FigJam): a selected shape shows a dot on each side.
 * Clicking one adds the next step — a blank copy of the shape, a gap away on
 * that side — and an elbow arrow to it. Dragging from a dot draws a connector
 * from that side instead (handled by the canvas).
 */

import {
  type BoardEl,
  type BoardScene,
  type BoxSide,
  type LinkerEl,
  type ShapeEl,
  type StickyEl,
  defaultStyle,
  isLinker,
  isShape,
  newId,
} from "./board-model";
import { type Box, type Point, boxesOverlap, elementBounds } from "./board-geometry";

export type Side = BoxSide;
export const SIDES: Side[] = ["n", "e", "s", "w"];
/** Scene units between a shape and the one quick connect adds. */
export const QUICK_GAP = 80;

export function canQuickConnect(el: BoardEl | null | undefined): el is ShapeEl | StickyEl {
  return Boolean(el && (isShape(el) || el.t === "sticky"));
}

/** Where each side's dot sits: centred on the side, `offset` outside it. */
export function quickDots(box: Box, offset: number): Record<Side, Point> {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    n: { x: cx, y: box.y - offset },
    e: { x: box.x + box.w + offset, y: cy },
    s: { x: cx, y: box.y + box.h + offset },
    w: { x: box.x - offset, y: cy },
  };
}

const STEP: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/**
 * The next step's position: `QUICK_GAP` past `src` on `side`, centred on
 * `src`'s axis, sized `size` (default: `src`'s own). If that spot is taken (a
 * branch already went that way) it slides sideways, alternating either side
 * of the axis, so repeated clicks fan out instead of stacking.
 */
export function nextStepBox(
  src: BoardEl,
  side: Side,
  scene: BoardScene,
  size: { w: number; h: number } = src,
  ignore?: string,
): Box {
  const [sx, sy] = STEP[side];
  const { w, h } = size;
  const base: Box = {
    x:
      sx > 0 ? src.x + src.w + QUICK_GAP : sx < 0 ? src.x - QUICK_GAP - w : src.x + (src.w - w) / 2,
    y:
      sy > 0 ? src.y + src.h + QUICK_GAP : sy < 0 ? src.y - QUICK_GAP - h : src.y + (src.h - h) / 2,
    w,
    h,
  };
  // Connectors don't block a spot: their stored points can span a whole
  // column of cards they no longer follow, which used to fill every slot.
  const others = scene.els
    .filter((el) => el.id !== src.id && el.id !== ignore && el.t !== "frame" && !isLinker(el))
    .map(elementBounds);
  const clear = QUICK_GAP / 4;
  const free = (box: Box): boolean =>
    !others.some((o) =>
      boxesOverlap(o, {
        x: box.x - clear,
        y: box.y - clear,
        w: box.w + 2 * clear,
        h: box.h + 2 * clear,
      }),
    );
  const shift = sx !== 0 ? h + QUICK_GAP / 2 : w + QUICK_GAP / 2;
  // Down (or right) first, then up, further out each round until a spot is
  // free; a board can't fill MAX_SLIDES slots both ways, but stop regardless.
  for (let i = 0; i < MAX_SLIDES * 2 + 1; i += 1) {
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const box: Box = {
      ...base,
      x: base.x + (sx === 0 ? k * shift : 0),
      y: base.y + (sy === 0 ? k * shift : 0),
    };
    if (free(box)) return box;
  }
  return base;
}

const MAX_SLIDES = 200;

/** How close (scene units, edge to cursor) a shape or note must be for a new
 *  one dropped at the cursor to attach to it. */
export const ATTACH_REACH = 160;

/**
 * Where a new `w × h` shape or note dropped at `at` lands. Near an existing
 * shape or note (within `ATTACH_REACH` of its edge, not on top of it) it goes
 * beside that one — on the side facing the cursor, a gap away, lined up on its
 * axis — and `from` names it, so the caller connects the two. Otherwise it is
 * centred on the cursor. `ignore` is the new item itself while it is in the
 * scene (a click in progress).
 */
export function placeNear(
  scene: BoardScene,
  at: Point,
  w: number,
  h: number,
  ignore?: string,
): { box: Box; from: ShapeEl | StickyEl | null; side: Side | null } {
  let best: { el: ShapeEl | StickyEl; d: number } | null = null;
  for (const el of scene.els) {
    if (el.id === ignore || !canQuickConnect(el)) continue;
    const b = elementBounds(el);
    const dx = Math.max(b.x - at.x, 0, at.x - (b.x + b.w));
    const dy = Math.max(b.y - at.y, 0, at.y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    // On top of a shape is not "next to" it.
    if (d === 0 || d > ATTACH_REACH) continue;
    if (!best || d < best.d) best = { el, d };
  }
  if (!best) return { box: { x: at.x - w / 2, y: at.y - h / 2, w, h }, from: null, side: null };
  const b = elementBounds(best.el);
  // Which side faces the cursor: the larger offset, measured in half-sizes so
  // a wide shape doesn't always win left/right.
  const ox = (at.x - (b.x + b.w / 2)) / (b.w / 2 || 1);
  const oy = (at.y - (b.y + b.h / 2)) / (b.h / 2 || 1);
  const side: Side = Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? "e" : "w") : oy > 0 ? "s" : "n";
  return { box: nextStepBox(best.el, side, scene, { w, h }, ignore), from: best.el, side };
}

/** A blank copy of `src` (same kind, size and style; no text) at `box`. */
export function blankCopy(src: ShapeEl | StickyEl, box: Box): ShapeEl | StickyEl {
  const copy = structuredClone(src) as ShapeEl | StickyEl;
  copy.id = newId();
  copy.x = box.x;
  copy.y = box.y;
  delete copy.g;
  if (copy.t === "sticky") copy.tx = "";
  else delete copy.lb;
  return copy;
}

const OPPOSITE: Record<Side, Side> = { n: "s", e: "w", s: "n", w: "e" };

/** An elbow arrow bound at both ends — it follows either shape when moved.
 *  With `side` (where `b` was placed relative to `a`) both ends are pinned:
 *  it leaves the middle of `a`'s side `side` and enters `b` from the facing
 *  side, so every step placed to the right of `a` hangs off one trunk into
 *  its left side, even one that slid down past its siblings. */
export function connectorBetween(a: BoardEl, b: BoardEl, side?: Side | null): LinkerEl {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return {
    id: newId(),
    t: "arrow",
    x: ac.x,
    y: ac.y,
    w: 0,
    h: 0,
    a: 0,
    op: 1,
    sh: "elbow",
    pts: [
      [0, 0],
      [bc.x - ac.x, bc.y - ac.y],
    ],
    b1: side ? { el: a.id, fx: 0, gap: 4, sd: side } : { el: a.id, fx: 0, gap: 4 },
    b2: side ? { el: b.id, fx: 0, gap: 4, sd: OPPOSITE[side] } : { el: b.id, fx: 0, gap: 4 },
    hd: { s: "none", e: "triangle" },
    st: defaultStyle(),
  };
}
