/**
 * Board geometry: bounds, hit testing, arrow binding, routing, snapping.
 *
 * Portions are ports of Excalidraw's approach (MIT, https://github.com/excalidraw/excalidraw):
 *  - the focus/gap binding model from `element/binding.ts` — an endpoint stores a
 *    *normalized* offset along the target's boundary rather than an absolute
 *    point, which is why the arrow stays put when the target is resized;
 *  - the rotation-aware bounding box from `element/bounds.ts`;
 *  - the "transparent fill hits only near the outline" rule from `element/collision.ts`.
 * The rendering layer, roughjs, and the UI are deliberately NOT taken.
 *
 * Every tolerance in here is expressed in SCENE units and callers convert from
 * screen pixels by dividing by zoom. Handles and hit slop must not grow when
 * the user zooms in.
 */

import { type BoardEl, type BoardScene, type LinkerEl, findEl, isLinker } from "./board-model";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ basic */

export function rotate(px: number, py: number, cx: number, cy: number, a: number): Point {
  if (!a) return { x: px, y: py };
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function centerOf(el: BoardEl): Point {
  if (isLinker(el)) {
    const b = linkerLocalBounds(el);
    return { x: el.x + b.x + b.w / 2, y: el.y + b.y + b.h / 2 };
  }
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

function linkerLocalBounds(el: LinkerEl): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of el.pts) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Axis-aligned bounds in scene space, rotation included. */
export function elementBounds(el: BoardEl): Box {
  if (isLinker(el)) {
    const b = linkerLocalBounds(el);
    return { x: el.x + b.x, y: el.y + b.y, w: b.w, h: b.h };
  }
  if (!el.a) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const c = centerOf(el);
  const corners = [
    rotate(el.x, el.y, c.x, c.y, el.a),
    rotate(el.x + el.w, el.y, c.x, c.y, el.a),
    rotate(el.x + el.w, el.y + el.h, c.x, c.y, el.a),
    rotate(el.x, el.y + el.h, c.x, c.y, el.a),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export function boxesUnion(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInBox(p: Point, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/* --------------------------------------------------------------- outlines */

/** Unit outline in a 0..1 × 0..1 box. Ellipse is handled analytically, so it is
 *  approximated here only for generic ray intersection. */
function unitOutline(t: BoardEl["t"]): [number, number][] {
  switch (t) {
    case "diamond":
      return [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ];
    case "triangle":
      return [
        [0.5, 0],
        [1, 1],
        [0, 1],
      ];
    case "pentagon":
      return regular(5, -Math.PI / 2);
    case "hexagon":
      return regular(6, 0);
    case "star":
      return star(5);
    case "bubble":
      return [
        [0, 0],
        [1, 0],
        [1, 0.78],
        [0.42, 0.78],
        [0.24, 1],
        [0.26, 0.78],
        [0, 0.78],
      ];
    case "cross":
      return [
        [0.34, 0],
        [0.66, 0],
        [0.66, 0.34],
        [1, 0.34],
        [1, 0.66],
        [0.66, 0.66],
        [0.66, 1],
        [0.34, 1],
        [0.34, 0.66],
        [0, 0.66],
        [0, 0.34],
        [0.34, 0.34],
      ];
    case "ellipse":
      return ellipseApprox(24);
    default:
      return [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
  }
}

function regular(n: number, phase: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = phase + (i * 2 * Math.PI) / n;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return out;
}

function star(points: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? 0.5 : 0.21;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return out;
}

function ellipseApprox(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i * 2 * Math.PI) / n;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return out;
}

/** Outline in scene space, rotation applied. */
export function outlinePolygon(el: BoardEl): Point[] {
  const c = centerOf(el);
  return unitOutline(el.t).map(([ux, uy]) =>
    rotate(el.x + ux * el.w, el.y + uy * el.h, c.x, c.y, el.a),
  );
}

export function svgOutlinePath(el: BoardEl): string {
  const pts = unitOutline(el.t).map(([ux, uy]) => [ux * el.w, uy * el.h]);
  return (
    pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ") +
    " Z"
  );
}

/* ------------------------------------------------------------- hit testing */

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: Point, pts: Point[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i += 1) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && n > 2) best = Math.min(best, distToSegment(p, pts[n - 1], pts[0]));
  return best;
}

export function absLinkerPoints(el: LinkerEl): Point[] {
  return el.pts.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
}

/**
 * `tol` is in scene units — callers pass `SCREEN_TOL / zoom`.
 * Transparent-filled shapes only respond near their outline (or on their
 * label), which is what makes overlapping outlines usable.
 */
export function hitTest(el: BoardEl, p: Point, tol: number): boolean {
  if (isLinker(el)) return distToPolyline(p, absLinkerPoints(el), false) <= tol + el.st.w;

  if (el.t === "frame") {
    // Frames are grabbed by their title bar and their border, never by their
    // interior — otherwise they would swallow every click meant for a child.
    const b = { x: el.x, y: el.y, w: el.w, h: el.h };
    const onTitle = p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y - FRAME_TITLE_H && p.y < el.y;
    if (onTitle) return true;
    return pointInBox(p, b) && distToPolyline(p, outlinePolygon(el), true) <= tol + 2;
  }

  const poly = outlinePolygon(el);
  const inside = el.t === "ellipse" ? pointInEllipse(el, p) : pointInPolygon(p, poly);
  // Every shape is grabbed by its interior, hollow or filled (Lark). Things
  // stacked above a shape still win, because hits walk the z-order top-down.
  if (inside) return true;
  return distToPolyline(p, poly, true) <= tol;
}

function pointInEllipse(el: BoardEl, p: Point): boolean {
  const c = centerOf(el);
  const local = rotate(p.x, p.y, c.x, c.y, -el.a);
  const rx = el.w / 2;
  const ry = el.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (local.x - c.x) / rx;
  const ny = (local.y - c.y) / ry;
  return nx * nx + ny * ny <= 1;
}

export const FRAME_TITLE_H = 22;

/** Topmost element under the point. Array order is z-order, so iterate back. */
export function elementAt(scene: BoardScene, p: Point, tol: number): BoardEl | null {
  for (let i = scene.els.length - 1; i >= 0; i -= 1) {
    const el = scene.els[i];
    if (el.lk) continue;
    if (isLinker(el)) {
      // Routed, not stored, points: a bound end follows its shape, and the
      // stored point goes stale the moment that shape moves.
      if (linkerHit(scene, el, p, tol)) return el;
    } else if (hitTest(el, p, tol)) return el;
  }
  return null;
}

export const LINKER_LABEL_PAD = 6;

function linkerHit(scene: BoardScene, el: LinkerEl, p: Point, tol: number): boolean {
  const route = routeLinker(scene, el);
  if (distToPolyline(p, route, false) <= tol + el.st.w) return true;
  if (!el.lb?.tx) return false;
  const m = polylineMidpoint(route);
  const half = el.lb.tx.length * el.lb.sz * 0.3 + LINKER_LABEL_PAD;
  return Math.abs(p.x - m.x) <= half && Math.abs(p.y - m.y) <= el.lb.sz;
}

/** Innermost frame whose interior contains the point — used for drop targeting. */
export function frameAt(scene: BoardScene, p: Point): BoardEl | null {
  let best: BoardEl | null = null;
  for (const el of scene.els) {
    if (el.t !== "frame") continue;
    if (pointInBox(p, { x: el.x, y: el.y, w: el.w, h: el.h })) {
      if (!best || el.w * el.h < best.w * best.h) best = el;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- binding */

function perp(d: Point): Point {
  return { x: -d.y, y: d.x };
}

function norm(d: Point): Point {
  const len = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / len, y: d.y / len };
}

/** Distance from the element's center to its boundary along `dir`. */
function boundaryRadius(el: BoardEl, dir: Point): number {
  const c = centerOf(el);
  const far = { x: c.x + dir.x * 1e6, y: c.y + dir.y * 1e6 };
  if (el.t === "ellipse") {
    const local = rotate(far.x, far.y, c.x, c.y, -el.a);
    const dx = local.x - c.x;
    const dy = local.y - c.y;
    const rx = Math.max(el.w / 2, 0.001);
    const ry = Math.max(el.h / 2, 0.001);
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return Math.hypot(dx * t, dy * t);
  }
  const poly = outlinePolygon(el);
  let best = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const hit = segIntersect(c, far, a, b);
    if (hit) best = Math.max(best, Math.hypot(hit.x - c.x, hit.y - c.y));
  }
  return best || Math.min(el.w, el.h) / 2;
}

function segIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * Where a bound endpoint actually lands.
 *
 * `focus` is normalized against the boundary radius, so scaling the target
 * keeps the endpoint at the same relative spot — this is the whole reason the
 * model stores focus instead of a point.
 */
export function bindingPoint(target: BoardEl, focus: number, gap: number, from: Point): Point {
  const c = centerOf(target);
  const dir = norm({ x: c.x - from.x, y: c.y - from.y });
  const side = perp(dir);
  const radius = boundaryRadius(target, side);
  const focusPoint = { x: c.x + side.x * focus * radius, y: c.y + side.y * focus * radius };
  const inward = norm({ x: focusPoint.x - from.x, y: focusPoint.y - from.y });
  const far = { x: focusPoint.x - inward.x * 1e6, y: focusPoint.y - inward.y * 1e6 };

  let hit: Point | null = null;
  if (target.t === "ellipse") {
    hit = ellipseRayHit(target, focusPoint, { x: -inward.x, y: -inward.y });
  } else {
    const poly = outlinePolygon(target);
    let bestDist = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const p = segIntersect(focusPoint, far, poly[i], poly[(i + 1) % poly.length]);
      if (!p) continue;
      const dist = Math.hypot(p.x - from.x, p.y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        hit = p;
      }
    }
  }
  const edge = hit ?? focusPoint;
  return { x: edge.x - inward.x * gap, y: edge.y - inward.y * gap };
}

function ellipseRayHit(el: BoardEl, origin: Point, dir: Point): Point | null {
  const c = centerOf(el);
  const o = rotate(origin.x, origin.y, c.x, c.y, -el.a);
  const d = rotate(origin.x + dir.x, origin.y + dir.y, c.x, c.y, -el.a);
  const dx = d.x - o.x;
  const dy = d.y - o.y;
  const rx = Math.max(el.w / 2, 0.001);
  const ry = Math.max(el.h / 2, 0.001);
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const A = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  const B = (2 * ox * dx) / (rx * rx) + (2 * oy * dy) / (ry * ry);
  const C = (ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return null;
  const sq = Math.sqrt(disc);
  const t = Math.min(...[(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((v) => v >= 0));
  if (!Number.isFinite(t)) return null;
  const local = { x: o.x + dx * t, y: o.y + dy * t };
  return rotate(local.x, local.y, c.x, c.y, el.a);
}

/** Inverse of `bindingPoint` — what focus value puts the endpoint here. */
export function computeFocus(target: BoardEl, endpoint: Point, from: Point): number {
  const c = centerOf(target);
  const dir = norm({ x: c.x - from.x, y: c.y - from.y });
  const side = perp(dir);
  const radius = boundaryRadius(target, side) || 1;
  const offset = (endpoint.x - c.x) * side.x + (endpoint.y - c.y) * side.y;
  return Math.max(-0.9, Math.min(0.9, offset / radius));
}

/* ---------------------------------------------------------------- routing */

/**
 * Resolves a linker's absolute endpoints, honouring bindings. Returns scene
 * coordinates; the element's own `pts` are only the fallback for unbound ends.
 *
 * A binding to a deleted element degrades to the stored point instead of
 * throwing — deleting a shape must not make its arrows disappear.
 */
export function routeLinker(scene: BoardScene, el: LinkerEl): Point[] {
  const raw = absLinkerPoints(el);
  let start = raw[0];
  let end = raw[raw.length - 1];

  const t1 = el.b1 ? findEl(scene, el.b1.el) : undefined;
  const t2 = el.b2 ? findEl(scene, el.b2.el) : undefined;

  if (t1 && el.b1) start = bindingPoint(t1, el.b1.fx, el.b1.gap, t2 ? centerOf(t2) : end);
  if (t2 && el.b2) end = bindingPoint(t2, el.b2.fx, el.b2.gap, t1 ? centerOf(t1) : start);

  if (el.sh === "elbow" && t1 && t2 && el.b1 && el.b2) {
    // Flowchart style: leave and arrive at the facing side midpoints.
    return orthogonalRoute(
      sideAnchor(t1, centerOf(t2), el.b1.gap),
      sideAnchor(t2, centerOf(t1), el.b2.gap),
    );
  }
  if (el.sh === "elbow") return elbowRoute(start, end, [t1, t2].filter(Boolean) as BoardEl[]);
  if (raw.length > 2 && el.sh === "straight") {
    return [start, ...raw.slice(1, -1), end];
  }
  return [start, end];
}

export interface SideAnchor {
  p: Point;
  /** True when the anchor is on the left or right side. */
  horizontal: boolean;
}

/** Midpoint of the side of `el` that faces `toward`, pushed out by `gap`.
 *  The side is chosen relative to the box's own proportions, so a wide box
 *  connects sideways to things level with it and vertically to things below. */
export function sideAnchor(el: BoardEl, toward: Point, gap: number): SideAnchor {
  const b = elementBounds(el);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * b.h >= Math.abs(dy) * b.w) {
    return { p: { x: dx >= 0 ? b.x + b.w + gap : b.x - gap, y: c.y }, horizontal: true };
  }
  return { p: { x: c.x, y: dy >= 0 ? b.y + b.h + gap : b.y - gap }, horizontal: false };
}

/** Right-angled path between two side anchors: a Z when both leave the same
 *  way, an L when they meet at a corner. */
export function orthogonalRoute(a: SideAnchor, b: SideAnchor): Point[] {
  if (a.horizontal && b.horizontal) {
    const mx = (a.p.x + b.p.x) / 2;
    return [a.p, { x: mx, y: a.p.y }, { x: mx, y: b.p.y }, b.p];
  }
  if (!a.horizontal && !b.horizontal) {
    const my = (a.p.y + b.p.y) / 2;
    return [a.p, { x: a.p.x, y: my }, { x: b.p.x, y: my }, b.p];
  }
  return a.horizontal ? [a.p, { x: b.p.x, y: a.p.y }, b.p] : [a.p, { x: a.p.x, y: b.p.y }, b.p];
}

/** The point halfway along a polyline — where a connector's label sits. */
export function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  let left = total / 2;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return points[points.length - 1];
}

/** Orthogonal 3-segment route. Picks the variant that stays clear of the two
 *  bound elements, so an elbow arrow never cuts through the box it connects. */
export function elbowRoute(a: Point, b: Point, avoid: BoardEl[]): Point[] {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const horizontalFirst: Point[] = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  const verticalFirst: Point[] = [a, { x: a.x, y: my }, { x: b.x, y: my }, b];

  const cost = (route: Point[]) => {
    let crossings = 0;
    for (const el of avoid) {
      const box = elementBounds(el);
      const inset = { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 };
      for (let i = 0; i < route.length - 1; i += 1) {
        if (segmentCrossesBox(route[i], route[i + 1], inset)) crossings += 1;
      }
    }
    return crossings;
  };

  const preferHorizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const first = preferHorizontal ? horizontalFirst : verticalFirst;
  const second = preferHorizontal ? verticalFirst : horizontalFirst;
  return cost(first) <= cost(second) ? first : second;
}

function segmentCrossesBox(a: Point, b: Point, box: Box): boolean {
  if (box.w <= 0 || box.h <= 0) return false;
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  for (let i = 0; i < 4; i += 1) {
    if (segIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

export function pathD(points: Point[], shape: LinkerEl["sh"]): string {
  if (points.length < 2) return "";
  if (shape === "curved" && points.length === 2) {
    const [a, b] = points;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const bow = 0.22;
    const cx = mx - dy * bow;
    const cy = my + dx * bow;
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

/** Direction the head at `which` end should point. */
export function headAngle(points: Point[], which: "s" | "e"): number {
  if (points.length < 2) return 0;
  const [a, b] =
    which === "e" ? [points[points.length - 2], points[points.length - 1]] : [points[1], points[0]];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/* --------------------------------------------------------------- snapping */

export interface SnapResult {
  dx: number;
  dy: number;
  guides: { x?: number; y?: number; from: number; to: number }[];
}

/**
 * Edge/center alignment against other elements.
 * `tol` arrives in scene units (screen px / zoom) so the magnet feels the same
 * at every zoom level.
 */
export function snapMove(moving: Box, others: Box[], tol: number): SnapResult {
  const res: SnapResult = { dx: 0, dy: 0, guides: [] };
  if (!others.length) return res;

  const mv = {
    xs: [moving.x, moving.x + moving.w / 2, moving.x + moving.w],
    ys: [moving.y, moving.y + moving.h / 2, moving.y + moving.h],
  };

  let bestX: { delta: number; at: number; other: Box } | null = null;
  let bestY: { delta: number; at: number; other: Box } | null = null;

  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oys = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const mx of mv.xs) {
      for (const ox of oxs) {
        const delta = ox - mx;
        if (Math.abs(delta) <= tol && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, at: ox, other: o };
        }
      }
    }
    for (const my of mv.ys) {
      for (const oy of oys) {
        const delta = oy - my;
        if (Math.abs(delta) <= tol && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, at: oy, other: o };
        }
      }
    }
  }

  if (bestX) {
    res.dx = bestX.delta;
    res.guides.push({
      x: bestX.at,
      from: Math.min(moving.y, bestX.other.y),
      to: Math.max(moving.y + moving.h, bestX.other.y + bestX.other.h),
    });
  }
  if (bestY) {
    res.dy = bestY.delta;
    res.guides.push({
      y: bestY.at,
      from: Math.min(moving.x, bestX ? bestX.other.x : bestY.other.x),
      to: Math.max(moving.x + moving.w, bestY.other.x + bestY.other.w),
    });
  }
  return res;
}

/* ---------------------------------------------------------------- handles */

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";

export function handlePositions(box: Box): Record<HandleId, Point> {
  const { x, y, w, h } = box;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
    rot: { x: x + w / 2, y },
  };
}

/** Applies a corner/edge drag. Never lets a side collapse or invert. */
export function resizeBox(
  start: Box,
  handle: HandleId,
  dx: number,
  dy: number,
  keepRatio: boolean,
  fromCenter: boolean,
): Box {
  let { x, y, w, h } = start;
  const min = 4;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.startsWith("n");
  const south = handle.startsWith("s");

  if (fromCenter) {
    if (east || west) {
      const sign = east ? 1 : -1;
      w = Math.max(min, start.w + sign * dx * 2);
      x = start.x + (start.w - w) / 2;
    }
    if (north || south) {
      const sign = south ? 1 : -1;
      h = Math.max(min, start.h + sign * dy * 2);
      y = start.y + (start.h - h) / 2;
    }
  } else {
    if (east) w = Math.max(min, start.w + dx);
    if (west) {
      w = Math.max(min, start.w - dx);
      x = start.x + start.w - w;
    }
    if (south) h = Math.max(min, start.h + dy);
    if (north) {
      h = Math.max(min, start.h - dy);
      y = start.y + start.h - h;
    }
  }

  if (keepRatio && start.w > 0 && start.h > 0 && (east || west) && (north || south)) {
    const ratio = start.w / start.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (west) x = start.x + start.w - w;
    if (north) y = start.y + start.h - h;
  }

  return { x, y, w, h };
}
