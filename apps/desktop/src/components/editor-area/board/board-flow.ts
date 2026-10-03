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
  type LinkerEl,
  type ShapeEl,
  type StickyEl,
  defaultStyle,
  isShape,
  newId,
} from "./board-model";
import { type Box, type Point, boxesOverlap, elementBounds } from "./board-geometry";

export type Side = "n" | "e" | "s" | "w";
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
 * The next step's position: `QUICK_GAP` past `src` on `side`. If that spot is
 * taken (a branch already went that way) it slides sideways, alternating
 * either side of the axis, so repeated clicks fan out instead of stacking.
 */
export function nextStepBox(src: BoardEl, side: Side, scene: BoardScene): Box {
  const [sx, sy] = STEP[side];
  const base: Box = {
    x: src.x + sx * (src.w + QUICK_GAP),
    y: src.y + sy * (src.h + QUICK_GAP),
    w: src.w,
    h: src.h,
  };
  const others = scene.els.filter((el) => el.id !== src.id && el.t !== "frame").map(elementBounds);
  const shift = sx !== 0 ? src.h + QUICK_GAP / 2 : src.w + QUICK_GAP / 2;
  for (let i = 0; i < 8; i += 1) {
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const box: Box = {
      ...base,
      x: base.x + (sx === 0 ? k * shift : 0),
      y: base.y + (sy === 0 ? k * shift : 0),
    };
    if (!others.some((o) => boxesOverlap(o, box))) return box;
  }
  return base;
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

/** An elbow arrow bound at both ends — it follows either shape when moved. */
export function connectorBetween(a: BoardEl, b: BoardEl): LinkerEl {
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
    b1: { el: a.id, fx: 0, gap: 4 },
    b2: { el: b.id, fx: 0, gap: 4 },
    hd: { s: "none", e: "triangle" },
    st: defaultStyle(),
  };
}
