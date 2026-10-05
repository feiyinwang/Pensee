/**
 * Docking spark: the electric feedback when dragged cards dock onto another.
 *
 * While the drag is in reach, the target card is *charged*: a crackling
 * outline round its real shape, a lit bar and soft glow spilling inward on the
 * edge facing the dragged card, a port ring at the contact point, and a bolt
 * arcing from there to each dragged head. On drop, *current flows*: a pulse
 * runs down each new arrow into its card, splits at the entry edge, races
 * round the outline to the far side while a wash of light sweeps across the
 * card, then everything fades.
 *
 * Colour is the target card's own outline colour (blue for notes and
 * outline-less shapes), so the effect follows the user's palette. Everything
 * here draws into scene-space groups the canvas owns; widths are passed in
 * screen pixels via `px` so the glow reads the same at any zoom.
 */

import type { BoardEl, ShapeEl, StickyEl } from "./board-model";
import { type Box, type Point, elementBounds, svgOutlinePath } from "./board-geometry";
import { colorVar, svgEl } from "./board-render";
import type { Side } from "./board-flow";

type Card = ShapeEl | StickyEl;

/** How often a held charge re-crackles. Not a transition: an ambient flicker
 *  that only runs while a dock is offered (see docs/motion.md). */
export const CRACKLE_MS = 70;
/** The flow on drop: arrow pulse, then the trace round the card, then fade. */
const PULSE_MS = 220;
const TRACE_MS = 460;
const FADE_MS = 260;

let uid = 0;

/* ---------------------------------------------------------------- pure */

/** A jagged line from `a` to `b`: `segments` steps, each interior point
 *  pushed sideways by up to `amp`, tapered so both ends stay pinned. */
export function boltPoints(
  a: Point,
  b: Point,
  amp: number,
  segments: number,
  rnd: () => number = Math.random,
): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = Math.max(2, Math.round(segments));
  const pts: Point[] = [a];
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const off = (rnd() * 2 - 1) * amp * Math.sin(Math.PI * t);
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
  }
  pts.push(b);
  return pts;
}

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

function pathD(pts: Point[], closed = false): string {
  return (
    pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(" ") +
    (closed ? " Z" : "")
  );
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

/** The card's outline sampled every `step` (local space). Needs the path in
 *  the document to measure it, so it is measured inside `g`. */
function outlineSamples(g: SVGGElement, d: string, step: number): Point[] {
  const probe = svgEl("path", { d, fill: "none", stroke: "none" });
  g.append(probe);
  const len = probe.getTotalLength();
  const n = Math.max(12, Math.min(160, Math.round(len / step)));
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const q = probe.getPointAtLength((len * i) / n);
    pts.push({ x: q.x, y: q.y });
  }
  probe.remove();
  return pts;
}

/** The colour the card glows in: its outline, or blue when it has none. */
export function sparkColor(el: Card): string {
  if (el.t === "sticky") return "var(--wr-board-blue)";
  const s = el.st.s;
  if (s === "none" || s === "ink" || s === "muted") return "var(--wr-board-blue)";
  return colorVar(s);
}

/** Glow, body and white-hot core: the three strokes every lit line is. */
function litStroke(
  parent: SVGElement,
  d: string,
  px: (n: number) => number,
  scale = 1,
): SVGPathElement[] {
  const layers: [string, number][] = [
    ["wr-board-spark-glow", 7 * scale],
    ["wr-board-spark-body", 2.6 * scale],
    ["wr-board-spark-core", 1.1 * scale],
  ];
  return layers.map(([cls, w]) => {
    const node = svgEl("path", { d, class: cls, "stroke-width": px(w) });
    parent.append(node);
    return node;
  });
}

/** A lit bar along `side` of `box`, centred on `at`, `frac` of the side long. */
function edgeBar(box: Box, side: Side, at: Point, frac: number): [Point, Point] {
  if (side === "e" || side === "w") {
    const half = (box.h * frac) / 2;
    const cy = Math.min(Math.max(at.y, box.y + half), box.y + box.h - half);
    const x = side === "e" ? box.x + box.w : box.x;
    return [
      { x, y: cy - half },
      { x, y: cy + half },
    ];
  }
  const half = (box.w * frac) / 2;
  const cx = Math.min(Math.max(at.x, box.x + half), box.x + box.w - half);
  const y = side === "s" ? box.y + box.h : box.y;
  return [
    { x: cx - half, y },
    { x: cx + half, y },
  ];
}

/** A linear gradient fading from `side` inward; returns its url. */
function inwardGradient(parent: SVGElement, side: Side, peak: number): string {
  const id = `wr-spark-grad-${(uid += 1)}`;
  const [x1, y1, x2, y2] =
    side === "w"
      ? [0, 0, 1, 0]
      : side === "e"
        ? [1, 0, 0, 0]
        : side === "n"
          ? [0, 0, 0, 1]
          : [0, 1, 0, 0];
  const grad = svgEl("linearGradient", { id, x1, y1, x2, y2 });
  grad.append(
    svgEl("stop", { offset: 0, class: "wr-board-spark-stop", "stop-opacity": peak }),
    svgEl("stop", { offset: 0.55, class: "wr-board-spark-stop", "stop-opacity": peak * 0.25 }),
    svgEl("stop", { offset: 1, class: "wr-board-spark-stop", "stop-opacity": 0 }),
  );
  parent.append(grad);
  return `url(#${id})`;
}

/* ---------------------------------------------------------------- charge */

export interface Charge {
  target: Card;
  /** Where the target's box now sits (it may be moving to sit level with
   *  its next steps); the live dragged heads are measured as they are. */
  targetBox: Box;
  heads: Card[];
}

/**
 * Draws the charged target into `layer` (replacing what was there). Called
 * on every drag frame and again every `CRACKLE_MS` while the pointer rests,
 * so the bolt and outline re-randomise and crackle.
 */
export function drawCharge(layer: SVGGElement, charge: Charge, px: (n: number) => number): void {
  layer.replaceChildren();
  const { target, targetBox: box, heads } = charge;
  layer.setAttribute("style", `--wr-spark: ${sparkColor(target)}`);
  const local = svgEl("g", {
    // `box` is the target's bounds where it will sit; shift its own frame
    // by the same amount (bounds and frame differ when it is rotated).
    transform: cardTransform({
      ...target,
      x: target.x + box.x - elementBounds(target).x,
      y: target.y + box.y - elementBounds(target).y,
    }),
  });
  layer.append(local);
  const d = outlineD(target);

  // A soft halo, then the outline itself, lit.
  local.append(svgEl("path", { d, class: "wr-board-spark-halo", "stroke-width": px(14) }));
  litStroke(local, d, px, 0.8);

  // The crackle: two strands jittered off the outline, away from the centre.
  const c = { x: target.w / 2, y: target.h / 2 };
  const samples = outlineSamples(local, d, px(10));
  for (const [amp, cls] of [
    [px(3), "wr-board-spark-strand"],
    [px(2), "wr-board-spark-strand is-faint"],
  ] as const) {
    const jag = samples.map((q) => {
      const ox = q.x - c.x;
      const oy = q.y - c.y;
      const l = Math.hypot(ox, oy) || 1;
      const off = (Math.random() * 2 - 0.6) * amp;
      return { x: q.x + (ox / l) * off, y: q.y + (oy / l) * off };
    });
    local.append(svgEl("path", { d: pathD(jag, true), class: cls, "stroke-width": px(1.2) }));
  }

  const tc = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  for (const head of heads) {
    const hb = elementBounds(head);
    const hc = { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 };
    const contact = edgePoint(box, hc);
    const side = sideOf(box, contact);

    // The edge that faces the dragged card lights up and spills inward.
    const clipId = `wr-spark-clip-${(uid += 1)}`;
    const clip = svgEl("clipPath", { id: clipId });
    clip.append(svgEl("path", { d }));
    local.append(clip);
    const depth = 0.5;
    const spill = svgEl("rect", {
      x: side === "e" ? target.w * (1 - depth) : 0,
      y: side === "s" ? target.h * (1 - depth) : 0,
      width: side === "e" || side === "w" ? target.w * depth : target.w,
      height: side === "n" || side === "s" ? target.h * depth : target.h,
      fill: inwardGradient(local, side, 0.38),
      "clip-path": `url(#${clipId})`,
      class: "wr-board-spark-spill",
    });
    local.append(spill);
    // A soft cloud of light straddling the edge, long along it.
    const along = side === "e" || side === "w";
    const reach = (along ? box.h : box.w) * 0.42;
    layer.append(
      svgEl("ellipse", {
        cx: contact.x,
        cy: contact.y,
        rx: along ? px(22) : reach,
        ry: along ? reach : px(22),
        class: "wr-board-spark-cloud",
      }),
    );
    const [b0, b1] = edgeBar(box, side, contact, 0.5);
    litStroke(layer, pathD([b0, b1]), px, 1.6);

    // The bolt, from the contact port to the dragged card's near edge. When
    // they touch there is nothing to arc across, so the port alone shows.
    const tip = edgePoint(hb, tc);
    const gap = Math.hypot(tip.x - contact.x, tip.y - contact.y);
    if (
      gap > px(14) &&
      !(hb.x < box.x + box.w && hb.x + hb.w > box.x && hb.y < box.y + box.h && hb.y + hb.h > box.y)
    ) {
      const segs = Math.min(18, Math.max(4, gap / px(11)));
      const bolt = boltPoints(contact, tip, px(7), segs);
      litStroke(layer, pathD(bolt), px, 0.9);
      // A short fork off the bolt, the way real arcs branch.
      const at = bolt[1 + Math.floor(Math.random() * Math.max(1, bolt.length - 2))];
      const ang = Math.atan2(tip.y - contact.y, tip.x - contact.x) + (Math.random() - 0.5) * 1.8;
      const reach = Math.min(gap * 0.3, px(26));
      const fork = boltPoints(
        at,
        { x: at.x + Math.cos(ang) * reach, y: at.y + Math.sin(ang) * reach },
        px(3),
        3,
      );
      layer.append(
        svgEl("path", {
          d: pathD(fork),
          class: "wr-board-spark-body is-fork",
          "stroke-width": px(1.2),
        }),
      );
      layer.append(
        svgEl("circle", { cx: tip.x, cy: tip.y, r: px(3), class: "wr-board-spark-dot" }),
      );
    }

    // The port: a ring with a hot centre.
    layer.append(
      svgEl("circle", {
        cx: contact.x,
        cy: contact.y,
        r: px(9),
        class: "wr-board-spark-ring",
        "stroke-width": px(1.5),
      }),
      svgEl("circle", { cx: contact.x, cy: contact.y, r: px(4), class: "wr-board-spark-dot" }),
    );
  }
}

/* ---------------------------------------------------------------- flow */

export interface Flow {
  from: Card;
  /** The new arrow's route, scene space, from `from` into `card`. */
  route: Point[];
  card: Card;
  /** The side of `card` the arrow enters. */
  entry: Side;
}

/** Quick off the mark but still visibly travelling (a cubic got the trace
 *  most of the way round in its first few frames). */
const easeOut = (t: number) => 1 - (1 - t) ** 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Plays current flowing from each `from` down its arrow and through its
 * card: in at the entry edge, round both halves of the outline to the far
 * side, with a wash of light sweeping across. Returns a cancel function;
 * the layer is emptied when it ends or is cancelled.
 */
export function playFlow(layer: SVGGElement, flows: Flow[], px: (n: number) => number): () => void {
  layer.replaceChildren();
  const frames: ((ms: number) => void)[] = [];

  for (const f of flows) {
    const g = svgEl("g", { class: "wr-board-spark", style: `--wr-spark: ${sparkColor(f.from)}` });
    layer.append(g);

    // 1. A bright pulse rides the arrow.
    const routeLen = polyLength(f.route);
    const seg = Math.min(routeLen * 0.45, px(60));
    const pulse = litStroke(g, pathD(f.route), px, 1);
    for (const p of pulse) {
      p.setAttribute("stroke-dasharray", `${seg} ${routeLen + seg}`);
      p.setAttribute("stroke-linecap", "round");
    }

    // 2. Through the card, in its own space.
    const card = f.card;
    const local = svgEl("g", { transform: cardTransform(card) });
    g.append(local);
    const d = outlineD(card);
    const clipId = `wr-spark-clip-${(uid += 1)}`;
    const clip = svgEl("clipPath", { id: clipId });
    clip.append(svgEl("path", { d }));
    local.append(clip);

    const horizontal = f.entry === "w" || f.entry === "e";
    // The band runs away from the entry, its bright edge leading.
    const backwards = f.entry === "e" || f.entry === "s";
    const span = horizontal ? card.w : card.h;
    const band = span * 0.8;
    const washGrad = `wr-spark-wash-${(uid += 1)}`;
    const grad = svgEl("linearGradient", {
      id: washGrad,
      x1: backwards && horizontal ? 1 : 0,
      y1: backwards && !horizontal ? 1 : 0,
      x2: horizontal && !backwards ? 1 : 0,
      y2: !horizontal && !backwards ? 1 : 0,
    });
    grad.append(
      svgEl("stop", { offset: 0, class: "wr-board-spark-stop", "stop-opacity": 0 }),
      svgEl("stop", { offset: 0.7, class: "wr-board-spark-stop", "stop-opacity": 0.45 }),
      svgEl("stop", { offset: 1, class: "wr-board-spark-stop", "stop-opacity": 0 }),
    );
    local.append(grad);
    const wash = svgEl("rect", {
      width: horizontal ? band : card.w,
      height: horizontal ? card.h : band,
      fill: `url(#${washGrad})`,
      "clip-path": `url(#${clipId})`,
      class: "wr-board-spark-spill",
    });
    local.append(wash);

    // Both halves of the outline, from the entry point to the far side.
    const samples = outlineSamples(local, d, px(4));
    const entryAt: Point =
      f.entry === "w"
        ? { x: 0, y: card.h / 2 }
        : f.entry === "e"
          ? { x: card.w, y: card.h / 2 }
          : f.entry === "n"
            ? { x: card.w / 2, y: 0 }
            : { x: card.w / 2, y: card.h };
    const farAt = { x: card.w - entryAt.x, y: card.h - entryAt.y };
    const nearest = (p: Point) =>
      samples.reduce(
        (best, q, i) => {
          const dd = Math.hypot(q.x - p.x, q.y - p.y);
          return dd < best.d ? { i, d: dd } : best;
        },
        { i: 0, d: Infinity },
      ).i;
    const i0 = nearest(entryAt);
    const i1 = nearest(farAt);
    const n = samples.length;
    const walk = (dir: 1 | -1): Point[] => {
      const out: Point[] = [samples[i0]];
      for (let i = i0; i !== i1; ) {
        i = (i + dir + n) % n;
        out.push(samples[i]);
      }
      return out;
    };
    const halves = [walk(1), walk(-1)].map((pts) => {
      const len = polyLength(pts);
      const strokes = litStroke(local, pathD(pts), px, 1);
      for (const s of strokes) s.setAttribute("stroke-dasharray", `0 ${len + 1}`);
      return { len, strokes };
    });
    const entryFlash = litStroke(local, "", px, 1.3);
    const [e0, e1] = edgeBar({ x: 0, y: 0, w: card.w, h: card.h }, f.entry, entryAt, 0.6);
    for (const s of entryFlash) s.setAttribute("d", pathD([e0, e1]));

    frames.push((ms) => {
      // Pulse: 0 → PULSE_MS.
      const pt = clamp01(ms / PULSE_MS);
      const head = easeOut(pt) * (routeLen + seg);
      for (const p of pulse) {
        p.setAttribute("stroke-dashoffset", String(seg - head));
        p.style.opacity = String(1 - clamp01((ms - PULSE_MS) / 120));
      }
      // Trace and wash: PULSE_MS * 0.7 → + TRACE_MS.
      const tt = clamp01((ms - PULSE_MS * 0.7) / TRACE_MS);
      const te = easeOut(tt);
      const fade = 1 - clamp01((ms - PULSE_MS * 0.7 - TRACE_MS) / FADE_MS);
      for (const h of halves) {
        for (const s of h.strokes) {
          s.setAttribute("stroke-dasharray", `${h.len * te} ${h.len + 1}`);
          s.style.opacity = String(fade);
        }
      }
      // The wash's bright edge (70% into the band) keeps pace with the trace.
      const x = te * span - band * 0.7;
      wash.setAttribute(horizontal ? "x" : "y", String(backwards ? span - band - x : x));
      wash.style.opacity = String(tt > 0 ? fade : 0);
      const flash = tt > 0 ? (1 - te) * fade : 0;
      for (const s of entryFlash) s.style.opacity = String(flash);
    });
  }

  const total = PULSE_MS * 0.7 + TRACE_MS + FADE_MS;
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
