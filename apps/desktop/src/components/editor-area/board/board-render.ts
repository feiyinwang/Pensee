/**
 * Scene → SVG.
 *
 * Reconciles by element id instead of re-serializing the whole tree, so a drag
 * touches only the moved node's attributes. That is the difference between
 * "smooth at 300 elements" and "janky at 40".
 *
 * Colours are emitted as `var(--wr-board-*)` so the board follows the editor
 * theme; no hex value is ever stored in the document.
 */

import {
  type BoardEl,
  type BoardScene,
  type ColorToken,
  type LinkerEl,
  type ShapeEl,
  STICKY_SIZE,
  isLinker,
  isShape,
} from "./board-model";
import { type Point, headAngle, pathD, routeLinker, svgOutlinePath } from "./board-geometry";

const NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function colorVar(token: ColorToken): string {
  return token === "none" ? "none" : `var(--wr-board-${token})`;
}

function stickyVar(token: string): string {
  return `var(--wr-board-sticky-${token})`;
}

function dashArray(el: { d: string; w: number }): string | null {
  if (el.d === "dashed") return `${el.w * 4} ${el.w * 3}`;
  if (el.d === "dotted") return `${el.w * 0.1} ${el.w * 2.4}`;
  return null;
}

/* ------------------------------------------------------------ measurement */

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();

export const BOARD_FONT =
  'ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

function measure(text: string, size: number, weight = 400): number {
  const key = `${size}|${weight}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${weight} ${size}px ${BOARD_FONT}`;
  const width = measureCtx.measureText(text).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

/** Greedy wrap. Breaks inside a run of CJK or a too-long word so a single
 *  pasted URL cannot blow out the box. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    const tokens = paragraph.match(/\s+|[^\s]+/g) ?? [];
    for (const token of tokens) {
      const candidate = line + token;
      if (measure(candidate, size) <= maxWidth || !line) {
        if (measure(candidate, size) <= maxWidth) {
          line = candidate;
          continue;
        }
        // Single token wider than the box — hard-break it character by character.
        let chunk = "";
        for (const ch of token) {
          if (measure(chunk + ch, size) > maxWidth && chunk) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
        continue;
      }
      out.push(line.trimEnd());
      line = token.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Shrinks the font until the wrapped text fits, then stops at `min`. */
export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  max: number,
  min: number,
): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 1) {
    const lines = wrapText(text, size, boxW);
    if (lines.length * size * LINE_HEIGHT <= boxH) return { size, lines };
  }
  return { size: min, lines: wrapText(text, min, boxW) };
}

export const LINE_HEIGHT = 1.35;
export const STICKY_FONT_MAX = 22;
export const STICKY_FONT_MIN = 11;

/** Font ascent and descent as fractions of the size, measured once. */
let fontMetrics: { ascent: number; descent: number } | null = null;

function metrics(): { ascent: number; descent: number } {
  if (fontMetrics) return fontMetrics;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const m = measureCtx
    ? ((measureCtx.font = `400 100px ${BOARD_FONT}`), measureCtx.measureText("Hg"))
    : null;
  fontMetrics =
    m && m.fontBoundingBoxAscent > 0
      ? { ascent: m.fontBoundingBoxAscent / 100, descent: m.fontBoundingBoxDescent / 100 }
      : { ascent: 0.8, descent: 0.2 };
  return fontMetrics;
}

/** Alphabetic baseline of a line whose box starts at `lineTop`, placed the
 *  way CSS places it (half-leading above the ascent). Matching CSS is the
 *  point: the in-place editor is a textarea, so drawn and edited text now sit
 *  on the same pixel. SVG's `central` baseline put glyphs ~8px higher. */
export function baselineIn(lineTop: number, size: number): number {
  const { ascent, descent } = metrics();
  return lineTop + (size * LINE_HEIGHT - size * (ascent + descent)) / 2 + size * ascent;
}

/**
 * `y` is the top of the first line box; lines are `size × LINE_HEIGHT` apart,
 * the in-place editor's line height.
 */
function appendLines(
  parent: SVGElement,
  lines: string[],
  opts: {
    x: number;
    y: number;
    size: number;
    align: "l" | "c" | "r";
    fill: string;
    weight?: number;
  },
): SVGTextElement {
  const anchor = opts.align === "c" ? "middle" : opts.align === "r" ? "end" : "start";
  const lineH = opts.size * LINE_HEIGHT;
  const text = svgEl("text", {
    x: opts.x,
    y: baselineIn(opts.y, opts.size),
    "font-size": opts.size,
    "font-family": BOARD_FONT,
    "font-weight": opts.weight ?? 400,
    fill: opts.fill,
    "text-anchor": anchor,
    "xml:space": "preserve",
  });
  lines.forEach((line, i) => {
    const tspan = svgEl("tspan", { x: opts.x, dy: i === 0 ? 0 : lineH });
    tspan.textContent = line || " ";
    text.append(tspan);
  });
  parent.append(text);
  return text;
}

/** Top of a block of `lines` centred vertically in `h`, never above `pad`. */
export function centredTop(h: number, lines: number, size: number, pad: number): number {
  return Math.max((h - lines * size * LINE_HEIGHT) / 2, pad);
}

/* ---------------------------------------------------------------- element */

export interface RenderContext {
  /** Turns a document-relative image path into something the webview can load. */
  resolveSrc: (src: string) => string;
  scene: BoardScene;
}

function renderShape(g: SVGGElement, el: ShapeEl): void {
  const fill = colorVar(el.st.f);
  const stroke = colorVar(el.st.s);
  let node: SVGElement;
  if (el.t === "ellipse") {
    node = svgEl("ellipse", {
      cx: el.w / 2,
      cy: el.h / 2,
      rx: Math.max(el.w / 2, 0),
      ry: Math.max(el.h / 2, 0),
    });
  } else if (el.t === "rect" || el.t === "roundRect") {
    node = svgEl("rect", {
      x: 0,
      y: 0,
      width: Math.max(el.w, 0),
      height: Math.max(el.h, 0),
      rx: el.t === "roundRect" ? Math.min(el.st.r, el.w / 2, el.h / 2) : 0,
    });
  } else {
    node = svgEl("path", { d: svgOutlinePath(el), "stroke-linejoin": "round" });
  }
  node.setAttribute("fill", fill);
  node.setAttribute("stroke", stroke);
  node.setAttribute("stroke-width", String(el.st.w));
  const dash = dashArray(el.st);
  if (dash) node.setAttribute("stroke-dasharray", dash);
  g.append(node);

  if (el.lb?.tx) {
    const pad = 10;
    const { size, lines } = fitFontSize(
      el.lb.tx,
      Math.max(el.w - pad * 2, 20),
      Math.max(el.h - pad * 2, 16),
      el.lb.sz,
      9,
    );
    appendLines(g, lines, {
      x: el.lb.al === "c" ? el.w / 2 : el.lb.al === "r" ? el.w - pad : pad,
      y: centredTop(el.h, lines.length, size, pad),
      size,
      align: el.lb.al,
      fill: colorVar(el.lb.c ?? "ink"),
    });
  }
}

function renderSticky(g: SVGGElement, el: BoardEl & { c: string; tx: string }): void {
  g.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: STICKY_SIZE,
      height: STICKY_SIZE,
      rx: 2,
      fill: stickyVar(el.c),
      stroke: "var(--wr-board-sticky-edge)",
      "stroke-width": 1,
    }),
  );
  if (el.tx) {
    const pad = 16;
    // Lark-style: centred both ways, as large as fits — a two-word note reads
    // from across the room, a paragraph shrinks to fit.
    const { size, lines } = fitFontSize(
      el.tx,
      STICKY_SIZE - pad * 2,
      STICKY_SIZE - pad * 2,
      STICKY_FONT_MAX,
      STICKY_FONT_MIN,
    );
    appendLines(g, lines, {
      x: STICKY_SIZE / 2,
      y: centredTop(STICKY_SIZE, lines.length, size, pad),
      size,
      align: "c",
      fill: "var(--wr-board-sticky-ink)",
    });
  }
}

function renderText(
  g: SVGGElement,
  el: BoardEl & { tx: string; sz: number; al: "l" | "c" | "r"; c: ColorToken },
): void {
  const lines = wrapText(el.tx || "", el.sz, Math.max(el.w, 20));
  appendLines(g, lines, {
    x: el.al === "c" ? el.w / 2 : el.al === "r" ? el.w : 0,
    y: 0,
    size: el.sz,
    align: el.al,
    fill: colorVar(el.c),
  });
}

function renderImage(
  g: SVGGElement,
  el: BoardEl & { src: string; alt?: string },
  ctx: RenderContext,
): void {
  const img = svgEl("image", {
    x: 0,
    y: 0,
    width: Math.max(el.w, 0),
    height: Math.max(el.h, 0),
    preserveAspectRatio: "xMidYMid slice",
  });
  img.setAttribute("href", ctx.resolveSrc(el.src));
  if (el.alt) {
    const title = svgEl("title");
    title.textContent = el.alt;
    img.append(title);
  }
  g.append(img);
}

function renderFrame(g: SVGGElement, el: BoardEl & { name: string }): void {
  g.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: Math.max(el.w, 0),
      height: Math.max(el.h, 0),
      fill: "var(--wr-board-frame-bg)",
      stroke: "var(--wr-board-frame-edge)",
      "stroke-width": 1,
    }),
  );
  const label = svgEl("text", {
    x: 0,
    y: -6,
    "font-size": 14,
    "font-family": BOARD_FONT,
    fill: "var(--wr-board-muted)",
    "dominant-baseline": "auto",
  });
  label.textContent = el.name;
  label.setAttribute("data-frame-title", "1");
  g.append(label);
}

function renderLinker(g: SVGGElement, el: LinkerEl, ctx: RenderContext): void {
  const pts = routeLinker(ctx.scene, el);
  const stroke = colorVar(el.st.s);
  const path = svgEl("path", {
    d: pathD(pts, el.sh),
    fill: "none",
    stroke,
    "stroke-width": el.st.w,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  const dash = dashArray(el.st);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  g.append(path);

  for (const which of ["s", "e"] as const) {
    const kind = el.hd[which];
    if (kind === "none") continue;
    const at = which === "s" ? pts[0] : pts[pts.length - 1];
    const angle = headAngle(pts, which);
    g.append(arrowHead(kind, at, angle, stroke, el.st.w));
  }
}

function arrowHead(
  kind: string,
  at: Point,
  angle: number,
  color: string,
  width: number,
): SVGElement {
  const size = Math.max(9, width * 5);
  const group = svgEl("g", {
    transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(${((angle * 180) / Math.PI).toFixed(1)})`,
  });
  if (kind === "dot") {
    group.append(svgEl("circle", { cx: 0, cy: 0, r: size * 0.32, fill: color }));
  } else if (kind === "line") {
    group.append(
      svgEl("path", {
        d: `M${-size} ${-size * 0.55} L0 0 L${-size} ${size * 0.55}`,
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  } else {
    group.append(
      svgEl("path", {
        d: `M0 0 L${-size} ${-size * 0.42} L${-size * 0.72} 0 L${-size} ${size * 0.42} Z`,
        fill: color,
        stroke: "none",
      }),
    );
  }
  return group;
}

function transformFor(el: BoardEl): string {
  const t = `translate(${el.x.toFixed(1)} ${el.y.toFixed(1)})`;
  if (!el.a) return t;
  const deg = ((el.a * 180) / Math.PI).toFixed(2);
  return `${t} rotate(${deg} ${(el.w / 2).toFixed(1)} ${(el.h / 2).toFixed(1)})`;
}

/** Linkers are already routed in absolute scene coordinates. */
function needsTransform(el: BoardEl): boolean {
  return !isLinker(el);
}

export function renderElement(el: BoardEl, ctx: RenderContext): SVGGElement {
  const g = svgEl("g", { "data-el": el.id, "data-type": el.t });
  if (needsTransform(el)) g.setAttribute("transform", transformFor(el));
  if (el.op !== 1) g.setAttribute("opacity", String(el.op));

  if (isLinker(el)) renderLinker(g, el, ctx);
  else if (el.t === "sticky") renderSticky(g, el as never);
  else if (el.t === "text") renderText(g, el as never);
  else if (el.t === "image") renderImage(g, el as never, ctx);
  else if (el.t === "frame") renderFrame(g, el as never);
  else if (isShape(el)) renderShape(g, el);
  return g;
}

/* ------------------------------------------------------------ reconciler */

export class SceneRenderer {
  private nodes = new Map<string, SVGGElement>();
  private stamps = new Map<string, string>();

  constructor(private readonly layer: SVGGElement) {}

  /** `visible` is the culled subset; everything else is removed from the DOM. */
  render(scene: BoardScene, ctx: RenderContext, visible: BoardEl[]): void {
    const seen = new Set<string>();
    let prev: SVGGElement | null = null;

    for (const el of visible) {
      seen.add(el.id);
      const stamp = stampOf(el, scene);
      const existing = this.nodes.get(el.id);
      let node: SVGGElement | undefined = existing;
      if (!existing || this.stamps.get(el.id) !== stamp) {
        node = renderElement(el, ctx);
        this.stamps.set(el.id, stamp);
        if (existing) existing.replaceWith(node);
        this.nodes.set(el.id, node);
      }
      if (!node) continue;
      // Keep DOM order equal to z-order without rebuilding the layer.
      // Both locals are annotated: left to inference, `prev` and `shouldFollow`
      // resolve through each other across loop iterations and the checker gives
      // up with an implicit `any` (TS7022).
      const shouldFollow: ChildNode | null = prev ? prev.nextSibling : this.layer.firstChild;
      if (node !== shouldFollow) {
        this.layer.insertBefore(node, shouldFollow ?? null);
      }
      prev = node;
    }

    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
      this.stamps.delete(id);
    }
  }

  nodeFor(id: string): SVGGElement | undefined {
    return this.nodes.get(id);
  }

  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.stamps.clear();
  }
}

/**
 * Cheap change key. A linker also depends on whatever it is bound to, so its
 * stamp folds in the bound elements' geometry — otherwise moving a shape would
 * leave its arrows stale.
 */
function stampOf(el: BoardEl, scene: BoardScene): string {
  let base = JSON.stringify(el);
  if (isLinker(el)) {
    for (const b of [el.b1, el.b2]) {
      if (!b) continue;
      const target = scene.els.find((e) => e.id === b.el);
      if (target) base += `|${target.x},${target.y},${target.w},${target.h},${target.a}`;
    }
  }
  return base;
}

/* ------------------------------------------------------------- background */

export function backgroundDefs(): SVGDefsElement {
  const defs = svgEl("defs");
  const dot = svgEl("pattern", {
    id: "wr-board-dots",
    width: 24,
    height: 24,
    patternUnits: "userSpaceOnUse",
  });
  dot.append(svgEl("circle", { cx: 1, cy: 1, r: 1, fill: "var(--wr-board-dot)" }));
  const grid = svgEl("pattern", {
    id: "wr-board-grid",
    width: 24,
    height: 24,
    patternUnits: "userSpaceOnUse",
  });
  grid.append(
    svgEl("path", {
      d: "M24 0 L0 0 0 24",
      fill: "none",
      stroke: "var(--wr-board-dot)",
      "stroke-width": 1,
    }),
  );
  defs.append(dot, grid);
  return defs;
}
