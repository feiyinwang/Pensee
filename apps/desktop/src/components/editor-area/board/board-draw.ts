/**
 * Pen strokes — pure geometry, no DOM.
 *
 * A stroke is captured as raw pointer points, simplified (Ramer–Douglas–
 * Peucker) so a scribble costs tens of points in the file rather than
 * hundreds, and drawn as a smooth curve through the midpoints of its segments.
 */

import { type DrawEl, type Style, newId } from "./board-model";
import type { Point } from "./board-geometry";

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Drops points that sit within `tolerance` of the line their neighbours make. */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = from + 1; i < to; i += 1) {
      const d = distToSegment(points[i], points[from], points[to]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Smooth path through `pts` (quadratic curves via segment midpoints). */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const f = (n: number) => Math.round(n * 10) / 10;
  if (pts.length === 2) return `M${f(pts[0][0])} ${f(pts[0][1])} L${f(pts[1][0])} ${f(pts[1][1])}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${f(lx)} ${f(ly)}`;
}

/** The stroke's own extent — what a resize scales from. */
export function strokeExtent(pts: [number, number][]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of pts) {
    w = Math.max(w, x);
    h = Math.max(h, y);
  }
  return { w, h };
}

/** A stroke element from scene-space points, origin at their top-left. */
export function strokeFrom(points: Point[], style: Style, tolerance: number): DrawEl | null {
  const pts = simplify(points, tolerance);
  if (pts.length < 2) return null;
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const local = pts.map((p) => [p.x - minX, p.y - minY] as [number, number]);
  const { w, h } = strokeExtent(local);
  return {
    id: newId(),
    t: "draw",
    x: minX,
    y: minY,
    w: Math.max(w, 1),
    h: Math.max(h, 1),
    a: 0,
    op: 1,
    pts: local,
    st: style,
  };
}
