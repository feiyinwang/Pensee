/**
 * Present mode — pure slide order and camera math, no DOM.
 *
 * Slides are sections (frames) in reading order: rows top to bottom, left to
 * right within a row, a row being frames whose tops are within half a frame
 * height of each other. A board without sections presents as one slide.
 */

import type { BoardScene, Viewport } from "./board-model";
import { type Box, boxesUnion, elementBounds } from "./board-geometry";

export function slideOrder(scene: BoardScene): Box[] {
  const frames = scene.els
    .filter((el) => el.t === "frame" && el.w > 0 && el.h > 0)
    .map((el) => ({ x: el.x, y: el.y, w: el.w, h: el.h }));
  if (!frames.length) {
    const all = boxesUnion(scene.els.map(elementBounds));
    return all && all.w > 0 && all.h > 0 ? [all] : [];
  }
  frames.sort((a, b) => a.y - b.y);
  const rows: Box[][] = [];
  for (const f of frames) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(f.y - row[0].y) <= Math.min(f.h, row[0].h) / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** The viewport that shows `box` as large as fits in `w × h`, centred, with
 *  `pad` screen pixels to spare on the tighter side. */
export function fitView(box: Box, w: number, h: number, pad: number): Viewport {
  const zoom = Math.min((w - pad * 2) / box.w, (h - pad * 2) / box.h);
  return {
    zoom,
    x: box.x + box.w / 2 - w / zoom / 2,
    y: box.y + box.h / 2 - h / zoom / 2,
  };
}

/**
 * Camera between two viewports at progress `t` (0..1, may overshoot on a
 * spring). Zoom moves geometrically and the centre linearly, which reads as
 * one continuous glide rather than a zoom followed by a pan.
 */
export function lerpView(a: Viewport, b: Viewport, t: number, w: number, h: number): Viewport {
  const ca = { x: a.x + w / a.zoom / 2, y: a.y + h / a.zoom / 2 };
  const cb = { x: b.x + w / b.zoom / 2, y: b.y + h / b.zoom / 2 };
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t);
  const cx = ca.x + (cb.x - ca.x) * t;
  const cy = ca.y + (cb.y - ca.y) * t;
  return { zoom, x: cx - w / zoom / 2, y: cy - h / zoom / 2 };
}

export function lerpBox(a: Box, b: Box, t: number): Box {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}
