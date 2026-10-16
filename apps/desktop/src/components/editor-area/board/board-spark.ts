/**
 * Docking glow: the feedback when dragged cards dock onto another
 * (SPECs/board-docking-glow-spec.md).
 *
 * While the drag is in reach, each dragged card's *imprint* sits where it will
 * land and the arrow it will get is previewed, lit in the target card's
 * colour. The target and the imprints carry a soft halo that breathes once a
 * beat, and at each peak a ring goes out from the port where the arrow
 * leaves. On drop the cards glide into their imprints, a dot runs the new
 * arrow, and the light is handed to the card it arrives at: its halo flares,
 * one ring plays, everything settles away.
 *
 * Colour is the target card's own outline colour (the foreground for notes and
 * outline-less shapes), so the light follows the user's palette. Everything
 * here draws into scene-space groups the canvas owns; widths are passed in
 * screen pixels via `px` so the light reads the same at any zoom.
 */

import type { BoardEl, ShapeEl, StickyEl } from "./board-model";
import { type Box, type Point, headAngle, svgOutlinePath } from "./board-geometry";
import { arrowHead, colorVar, svgEl } from "./board-render";
import type { Side } from "./board-flow";

type Card = ShapeEl | StickyEl;

/** One breath of the halo; the port rings at each peak. Not a transition: an
 *  ambient pulse that only runs while a dock is offered (docs/motion.md). */
export const BEAT_MS = 1600;
/** How long each ring takes to go out (it ends before the next one). */
const RING_MS = BEAT_MS * 0.6;
const RING_PX = 14;
/** The halo's strength; it breathes between 0.65 and 1 of it. */
const GLOW = 0.6;
/** The new arrow's opacity before it is made: the faint preview it firms up from. */
const PREVIEW_OPACITY = 0.4;
/** Matches --motion-settle; --ease-out is --ease-spring's fallback curve. */
export const GLIDE_MS = 180;
/** On drop: the dot runs the arrow, the card's halo flares then settles, one ring. */
const RUN_MS = 220;
const FLARE_MS = 120;
const SETTLE_MS = 480;
const LAND_RING_MS = 380;

/* ---------------------------------------------------------------- pure */

/** Which side of `box` the point `p` (on or near its edge) lies on. */
export function sideOf(box: Box, p: Point): Side {
  const ox = (p.x - (box.x + box.w / 2)) / (box.w / 2 || 1);
  const oy = (p.y - (box.y + box.h / 2)) / (box.h / 2 || 1);
  return Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? "e" : "w") : oy > 0 ? "s" : "n";
}

/** Where the line from `box`'s centre toward `toward` leaves the box. */
export function edgePoint(box: Box, toward: Point): Point {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.min(
    dx ? box.w / 2 / Math.abs(dx) : Infinity,
    dy ? box.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: c.x + dx * Math.min(t, 1), y: c.y + dy * Math.min(t, 1) };
}

/** Where the beat is at `ms` since the dock was offered: the halo's breath
 *  (0 to 1, peaking mid-beat) and the ring's progress since the last peak
 *  (null while none is out). Not finite (reduced motion): full, no ring. */
export function beatAt(ms: number): { breath: number; ring: number | null } {
  if (!Number.isFinite(ms)) return { breath: 1, ring: null };
  const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * ms) / BEAT_MS - Math.PI / 2);
  const sincePeak = ms - BEAT_MS / 2;
  if (sincePeak < 0) return { breath, ring: null };
  const ring = (sincePeak % BEAT_MS) / RING_MS;
  return { breath, ring: ring < 1 ? ring : null };
}

/** The point `d` along a polyline. */
export function pointAlong(pts: Point[], d: number): Point {
  let left = d;
  for (let i = 1; i < pts.length; i += 1) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, Math.max(0, left / seg)) : 0;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      };
    }
    left -= seg;
  }
  return pts[0];
}

/** --ease-out, cubic-bezier(0.16, 1, 0.3, 1), as a function of time. */
export function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.16,
    y1 = 1,
    x2 = 0.3,
    y2 = 1;
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 20; i += 1) {
    u = (lo + hi) / 2;
    if (((ax * u + bx) * u + cx) * u < t) lo = u;
    else hi = u;
  }
  return ((ay * u + by) * u + cy) * u;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function pathD(pts: Point[]): string {
  return pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(" ");
}

function polyLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/* ---------------------------------------------------------------- shape */

/** The card's outline in its own (unrotated, origin top-left) space,
 *  matching what the renderer draws. */
function outlineD(el: Card): string {
  const { w, h } = el;
  if (el.t === "ellipse") {
    return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`;
  }
  if (el.t === "rect" || el.t === "roundRect" || el.t === "sticky") {
    const r = el.t === "roundRect" ? Math.min(el.st.r, w / 2, h / 2) : el.t === "sticky" ? 2 : 0;
    return (
      `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h}` +
      ` H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`
    );
  }
  return svgOutlinePath(el);
}

function cardTransform(el: BoardEl): string {
  const t = `translate(${el.x.toFixed(1)} ${el.y.toFixed(1)})`;
  if (!el.a) return t;
  const deg = ((el.a * 180) / Math.PI).toFixed(2);
  return `${t} rotate(${deg} ${(el.w / 2).toFixed(1)} ${(el.h / 2).toFixed(1)})`;
}

/** The ink the card glows in: its outline, or the foreground when it has none. */
export function sparkColor(el: Card): string {
  if (el.t === "sticky") return "var(--wr-board-ink)";
  const s = el.st.s;
  if (s === "none" || s === "muted") return "var(--wr-board-ink)";
  return colorVar(s);
}

/** A soft halo round `card`'s outline, at opacity 0 until set. */
function halo(parent: SVGElement, card: Card, px: (n: number) => number): SVGPathElement {
  const g = svgEl("g", { transform: cardTransform(card) });
  const node = svgEl("path", {
    d: outlineD(card),
    class: "wr-board-glow-halo",
    "stroke-width": px(8),
  });
  g.append(node);
  parent.append(g);
  return node;
}

/** A lit line along `route` with the board's arrowhead: a thin core over a
 *  soft blurred under-stroke. Returns the under-stroke, whose strength
 *  follows the beat. */
function litArrow(parent: SVGElement, route: Point[], px: (n: number) => number): SVGPathElement {
  const d = pathD(route);
  const under = svgEl("path", { d, class: "wr-board-glow-under", "stroke-width": px(5.25) });
  parent.append(under, svgEl("path", { d, class: "wr-board-glow-line", "stroke-width": 1.5 }));
  parent.append(
    arrowHead("triangle", route[route.length - 1], headAngle(route, "e"), "var(--wr-glow)", 1.5),
  );
  return under;
}

/* ---------------------------------------------------------------- charge */

export interface Charge {
  /** The card the dragged ones dock after, where it will sit (it may move
   *  to sit level with its next steps). */
  target: Card;
  /** Whether `target` is moving there, so its new spot is drawn as an imprint. */
  targetMoves: boolean;
  /** Each dragged card where it will land. */
  landings: Card[];
  /** The arrow each head will get, routed as the board will route it. */
  routes: Point[][];
}

export interface ChargeView {
  /** Sets the breath and ring for `ms` since the dock was offered; updates
   *  attributes only, so it is cheap to call every frame. */
  beat: (ms: number) => void;
}

/** Draws the offered dock into `layer` (replacing what was there). */
export function drawCharge(
  layer: SVGGElement,
  charge: Charge,
  px: (n: number) => number,
): ChargeView {
  layer.replaceChildren();
  const { target, targetMoves, landings, routes } = charge;
  layer.setAttribute("style", `--wr-glow: ${sparkColor(target)}`);

  // Halos first so the imprints' hairlines sit on top of them.
  const halos: { node: SVGPathElement; peak: number }[] = [
    { node: halo(layer, target, px), peak: 0.4 },
  ];
  const spots = targetMoves ? [target, ...landings] : landings;
  for (const card of landings) halos.push({ node: halo(layer, card, px), peak: 0.22 });
  for (const card of spots) {
    const g = svgEl("g", { transform: cardTransform(card) });
    g.append(
      svgEl("path", { d: outlineD(card), class: "wr-board-imprint", "stroke-width": px(1) }),
    );
    layer.append(g);
  }

  const unders: SVGPathElement[] = [];
  const preview = svgEl("g", { class: "wr-board-glow-preview" });
  layer.append(preview);
  for (const route of routes) if (route.length > 1) unders.push(litArrow(preview, route, px));

  // One port per place an arrow leaves (heads docked together share it).
  const ports = new Map<string, Point>();
  for (const route of routes) {
    if (route.length) ports.set(`${Math.round(route[0].x)},${Math.round(route[0].y)}`, route[0]);
  }
  const rings: SVGCircleElement[] = [];
  for (const p of ports.values()) {
    const ring = svgEl("circle", {
      cx: p.x,
      cy: p.y,
      r: px(3),
      class: "wr-board-glow-ring",
      "stroke-width": px(1),
    });
    rings.push(ring);
    layer.append(ring, svgEl("circle", { cx: p.x, cy: p.y, r: px(3), class: "wr-board-glow-dot" }));
  }

  return {
    beat(ms) {
      const { breath, ring } = beatAt(ms);
      const a = GLOW * (0.65 + 0.35 * breath);
      for (const h of halos) h.node.setAttribute("stroke-opacity", (h.peak * a).toFixed(3));
      for (const u of unders) u.setAttribute("stroke-opacity", (0.35 * a).toFixed(3));
      for (const r of rings) {
        r.setAttribute("r", String(lerp(px(3), px(RING_PX), easeOut(ring ?? 0))));
        r.setAttribute("stroke-opacity", ring === null ? "0" : (0.6 * (1 - ring)).toFixed(3));
      }
    },
  };
}

/* ---------------------------------------------------------------- flow */

export interface Flow {
  from: Card;
  /** The new arrow's route, scene space, from `from` into `card`. */
  route: Point[];
  card: Card;
}

/**
 * Plays the hand-over on each docked arrow: the dot runs it from `from`, the
 * card it arrives at flares and settles, one ring at its port; `from`'s halo,
 * the lit line and the imprint (at `card`) fade meanwhile. Returns a cancel
 * function; the layer is emptied when it ends or is cancelled.
 */
export function playFlow(layer: SVGGElement, flows: Flow[], px: (n: number) => number): () => void {
  layer.replaceChildren();
  const frames: ((ms: number) => void)[] = [];

  for (const f of flows) {
    const g = svgEl("g", { class: "wr-board-glow", style: `--wr-glow: ${sparkColor(f.from)}` });
    layer.append(g);
    const imprint = svgEl("g", { transform: cardTransform(f.card) });
    imprint.append(
      svgEl("path", { d: outlineD(f.card), class: "wr-board-imprint", "stroke-width": px(1) }),
    );
    g.append(imprint);
    const fromHalo = halo(g, f.from, px);
    const cardHalo = halo(g, f.card, px);
    const line = svgEl("g", { class: "wr-board-glow-preview" });
    g.append(line);
    litArrow(line, f.route, px).setAttribute("stroke-opacity", String(0.35 * GLOW));
    const marks = svgEl("g");
    g.append(marks);
    const len = polyLength(f.route);
    const end = f.route[f.route.length - 1];
    const dot = svgEl("circle", { r: px(3), class: "wr-board-glow-dot" });
    const ring = svgEl("circle", {
      cx: end.x,
      cy: end.y,
      class: "wr-board-glow-ring",
      "stroke-width": px(1),
    });
    marks.append(ring, dot);

    frames.push((ms) => {
      imprint.style.opacity = String(1 - easeOut(clamp01(ms / GLIDE_MS)));
      fromHalo.setAttribute(
        "stroke-opacity",
        String(0.4 * GLOW * (1 - easeOut(clamp01(ms / 220)))),
      );
      line.style.opacity = String(1 - easeOut(clamp01(ms / 460)));
      // The light arrives with the dot: flare, then settle away.
      const up = easeOut(clamp01((ms - RUN_MS + 40) / FLARE_MS));
      const down = easeOut(clamp01((ms - RUN_MS - 80) / SETTLE_MS));
      cardHalo.setAttribute("stroke-opacity", String(0.5 * GLOW * up * (1 - down)));
      const run = easeOut(clamp01(ms / RUN_MS));
      if (run < 1) {
        const p = pointAlong(f.route, run * len);
        dot.setAttribute("cx", String(p.x));
        dot.setAttribute("cy", String(p.y));
        ring.setAttribute("stroke-opacity", "0");
      } else {
        const ph = clamp01((ms - RUN_MS) / LAND_RING_MS);
        dot.setAttribute("cx", String(end.x));
        dot.setAttribute("cy", String(end.y));
        dot.style.opacity = String(1 - easeOut(ph));
        ring.setAttribute("r", String(lerp(px(3), px(RING_PX + 2), easeOut(ph))));
        ring.setAttribute("stroke-opacity", String(0.7 * (1 - ph)));
      }
    });
  }

  const total = RUN_MS + 80 + SETTLE_MS;
  const start = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const ms = now - start;
    for (const f of frames) f(ms);
    if (ms < total) raf = requestAnimationFrame(tick);
    else layer.replaceChildren();
  };
  frames.forEach((f) => f(0));
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    layer.replaceChildren();
  };
}

/* ---------------------------------------------------------------- glide */

export interface Glide {
  /** An element's rendered node, already at its new place. */
  node: SVGGElement;
  /** Where it was let go, relative to that place. */
  dx: number;
  dy: number;
}

/**
 * Glides each docked card from where it was let go into its place, and firms
 * each new arrow (`arrows`) up from its preview opacity. The scene is already
 * final; this only offsets the nodes' transforms. Returns a cancel function
 * that puts every node at rest.
 */
export function glideInto(moves: Glide[], arrows: SVGGElement[]): () => void {
  const bases = moves.map((m) => m.node.getAttribute("transform"));
  const settle = () => {
    moves.forEach((m, i) => {
      const base = bases[i];
      if (base === null) m.node.removeAttribute("transform");
      else m.node.setAttribute("transform", base);
    });
    for (const a of arrows) a.style.opacity = "";
  };
  const frame = (t: number) => {
    const e = easeOut(t);
    moves.forEach((m, i) => {
      const ox = (m.dx * (1 - e)).toFixed(2);
      const oy = (m.dy * (1 - e)).toFixed(2);
      m.node.setAttribute("transform", `translate(${ox} ${oy}) ${bases[i] ?? ""}`.trim());
    });
    for (const a of arrows) a.style.opacity = String(lerp(PREVIEW_OPACITY, 1, e));
  };
  const start = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const t = clamp01((now - start) / GLIDE_MS);
    frame(t);
    if (t < 1) raf = requestAnimationFrame(tick);
    else settle();
  };
  frame(0);
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    settle();
  };
}
