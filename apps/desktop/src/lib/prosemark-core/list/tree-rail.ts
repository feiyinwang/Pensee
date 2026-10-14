import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { animate, type AnimationPlaybackControls } from "motion";
import { treeChanged } from "../utils";

// Tree rail for bullet and task lists (SPECs/list-tree-rail-spec.md), after the
// spectrumui tree-nav: a hairline joins the items of a list, and a nested item
// is reached by a line that drops from its parent's bullet and curves into its
// own. An accent run follows the same lines from the top of the list to the
// hovered item (or, with no hover, the caret's item) and glides when the
// target changes.
//
// Everything is drawn in one SVG behind the text, in the editor's scroll
// space, so it never enters the contenteditable DOM or its hit-testing.

/** Must match `LIST_UNIT_CH` in `./index.ts`: one indent step / marker slot. */
const LIST_UNIT_CH = 3;
/** Corner radius of the curve into a nested item, in px. */
const ELBOW_R = 8;
/** Space kept clear around a bullet dot, in px (dot radius plus the gap). */
const DOT_HOLE_R = 7;
/** Space kept clear around a task box: half its 18px side plus the gap. */
const TASK_HOLE_HALF = 12;
// Matches --motion-settle and --ease-out (docs/motion.md): the run glides like
// a settle, and a retarget restarts from what is on screen, so it stays
// interruptible.
const GLIDE_S = 0.18;
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

// The bounce ball (after beui's bounce sidebar): it sits on the hovered
// item's bullet (else the caret's), at that item's level, or on the line just
// left of a task's box, and hops there along an arc when it moves. A light underdamped spring gives
// it a quick landing; a long jump gets a little softer. The arc bulges to the
// left, away from the text, and is capped so a long jump stays near the rail.
const DOT_SIZE = 7;
/** A task's dot sits this far left of the box's centre, on the line in. */
const DOT_TASK_OFFSET = TASK_HOLE_HALF + 5;
const BOUNCE = { stiffness: 280, damping: 18, mass: 0.3 };
/** arc()'s strength and its cap, as beui sets them: neighbouring rows get a
 *  ~5px hop and a long jump peaks near 20px instead of swinging out. */
const ARC_STRENGTH = 0.26;
const ARC_MAX_BULGE = 40;

export interface RailNode {
  /** `ListItem.from`; stable for the item while the doc is unchanged. */
  id: number;
  /** Parent bullet/task item, or null for a list's top-level items. */
  parent: number | null;
  /** Items with the same group are siblings (the `from` of their list). */
  group: number;
  /** Marker centre in layer px. */
  x: number;
  y: number;
  task: boolean;
}

export type RailSegment =
  | { kind: "v"; x: number; y0: number; y1: number }
  | { kind: "h"; y: number; x0: number; x1: number }
  /** Quarter turn from going down to going right: (x, y0) → (x + r, y0 + r). */
  | { kind: "arc"; x: number; y0: number; r: number };

export const segmentLength = (s: RailSegment): number => {
  if (s.kind === "v") return Math.abs(s.y1 - s.y0);
  if (s.kind === "h") return Math.abs(s.x1 - s.x0);
  return (Math.PI * s.r) / 2;
};

export const pathLength = (segs: readonly RailSegment[]): number =>
  segs.reduce((sum, s) => sum + segmentLength(s), 0);

const start = (s: RailSegment): [number, number] =>
  s.kind === "v" ? [s.x, s.y0] : s.kind === "h" ? [s.x0, s.y] : [s.x, s.y0];
const end = (s: RailSegment): [number, number] =>
  s.kind === "v" ? [s.x, s.y1] : s.kind === "h" ? [s.x1, s.y] : [s.x + s.r, s.y0 + s.r];

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

export function segmentsToPath(segs: readonly RailSegment[]): string {
  let d = "";
  let at: [number, number] | null = null;
  for (const s of segs) {
    const [sx, sy] = start(s);
    if (!at || at[0] !== sx || at[1] !== sy) d += `M${fmt(sx)} ${fmt(sy)}`;
    if (s.kind === "v") d += `V${fmt(s.y1)}`;
    else if (s.kind === "h") d += `H${fmt(s.x1)}`;
    else d += `A${fmt(s.r)} ${fmt(s.r)} 0 0 0 ${fmt(s.x + s.r)} ${fmt(s.y0 + s.r)}`;
    at = end(s);
  }
  return d;
}

/** The curve into `child` from a line dropping at `parentX`. */
function elbow(parentX: number, child: RailNode): RailSegment[] {
  const r = Math.max(0, Math.min(ELBOW_R, (child.x - parentX) / 2));
  return [
    { kind: "arc", x: parentX, y0: child.y - r, r },
    { kind: "h", y: child.y, x0: parentX + r, x1: child.x },
  ];
}

/** Appends `seg`, folding a vertical that continues the previous one into it,
 *  so two runs down the same column compare equal over their shared part. */
function push(segs: RailSegment[], seg: RailSegment): void {
  if (seg.kind === "v" && seg.y1 <= seg.y0) return;
  const last = segs[segs.length - 1];
  if (seg.kind === "v" && last?.kind === "v" && last.x === seg.x && last.y1 === seg.y0) {
    segs[segs.length - 1] = { ...last, y1: seg.y1 };
    return;
  }
  segs.push(seg);
}

export interface RailGeometry {
  /** The grey lines: every list's rail and every curve into a nested item. */
  base: RailSegment[];
  nodes: Map<number, RailNode>;
}

export function railGeometry(list: readonly RailNode[]): RailGeometry {
  const nodes = new Map(list.map((n) => [n.id, n]));
  const groups = new Map<number, RailNode[]>();
  for (const n of list) {
    const g = groups.get(n.group);
    if (g) g.push(n);
    else groups.set(n.group, [n]);
  }
  const base: RailSegment[] = [];
  for (const items of groups.values()) {
    items.sort((a, b) => a.y - b.y);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) continue;
    const parent = first.parent === null ? undefined : nodes.get(first.parent);
    if (!parent) {
      // A top-level list: one rail down its own bullet column.
      push(base, { kind: "v", x: first.x, y0: first.y, y1: last.y });
      continue;
    }
    // A nested list: its parent's line drops and curves into each item.
    const lastR = Math.min(ELBOW_R, (last.x - parent.x) / 2);
    push(base, { kind: "v", x: parent.x, y0: parent.y, y1: last.y - lastR });
    for (const child of items) for (const s of elbow(parent.x, child)) base.push(s);
  }
  return { base, nodes };
}

/** The accent run to `id`: down the top-level rail from its first item, then
 *  through each ancestor's curve, ending at the item's own marker. */
export function accentPath(geo: RailGeometry, id: number): RailSegment[] {
  const chain: RailNode[] = [];
  for (let n = geo.nodes.get(id); n; n = n.parent === null ? undefined : geo.nodes.get(n.parent)) {
    chain.unshift(n);
  }
  const root = chain[0];
  if (!root) return [];
  let top = root.y;
  for (const n of geo.nodes.values()) if (n.group === root.group && n.y < top) top = n.y;
  const segs: RailSegment[] = [];
  push(segs, { kind: "v", x: root.x, y0: top, y1: root.y });
  for (let i = 1; i < chain.length; i++) {
    const parent = chain[i - 1];
    const child = chain[i];
    if (!parent || !child) break;
    const r = Math.min(ELBOW_R, (child.x - parent.x) / 2);
    push(segs, { kind: "v", x: parent.x, y0: parent.y, y1: child.y - r });
    for (const s of elbow(parent.x, child)) segs.push(s);
  }
  return segs;
}

const sameSegment = (a: RailSegment, b: RailSegment): boolean => {
  if (a.kind === "v" && b.kind === "v") return a.x === b.x && a.y0 === b.y0 && a.y1 === b.y1;
  if (a.kind === "h" && b.kind === "h") return a.y === b.y && a.x0 === b.x0 && a.x1 === b.x1;
  if (a.kind === "arc" && b.kind === "arc") return a.x === b.x && a.y0 === b.y0 && a.r === b.r;
  return false;
};

/** Length the two runs share from their common start: the accent retracts to
 *  here before it grows along the new run. */
export function sharedLength(a: readonly RailSegment[], b: readonly RailSegment[]): number {
  let len = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const sa = a[i];
    const sb = b[i];
    if (!sa || !sb) break;
    if (sameSegment(sa, sb)) {
      len += segmentLength(sa);
      continue;
    }
    const sameStart = start(sa)[0] === start(sb)[0] && start(sa)[1] === start(sb)[1];
    if (sameStart && sa.kind === sb.kind && sa.kind !== "arc") {
      len += Math.min(segmentLength(sa), segmentLength(sb));
    }
    break;
  }
  return len;
}

/** The control point of the ball's hop, as motion's arc() places it: off the
 *  midpoint by strength × distance (capped), so the quadratic curve peaks at
 *  half that, on the left of the travel (away from the text). */
export function hopControl(
  start: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - start.x;
  const dy = to.y - start.y;
  const travel = Math.hypot(dx, dy);
  if (travel === 0) return { ...to };
  const bulge = Math.min(ARC_STRENGTH * travel, ARC_MAX_BULGE);
  let nx = -dy / travel;
  let ny = dx / travel;
  if (nx > 0 || (nx === 0 && ny > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: (start.x + to.x) / 2 + nx * bulge, y: (start.y + to.y) / 2 + ny * bulge };
}

// ---------------------------------------------------------------------------
// Syntax tree → items

const BULLET_CHARS = new Set(["-", "+", "*"]);

const isBulletItem = (item: SyntaxNode, state: EditorState): boolean => {
  const mark = item.firstChild;
  if (!mark || mark.name !== "ListMark" || mark.to - mark.from !== 1) return false;
  if (!BULLET_CHARS.has(state.doc.sliceString(mark.from, mark.to))) return false;
  // A bare marker with no space yet renders as text, not a list (see index.ts).
  const after = state.doc.sliceString(mark.to, mark.to + 1);
  return after === " " || after === "\t";
};

const ancestorItem = (node: SyntaxNode): SyntaxNode | null => {
  for (let p = node.parent; p; p = p.parent) if (p.name === "ListItem") return p;
  return null;
};

const itemDepth = (item: SyntaxNode): number => {
  let depth = 0;
  for (let p = ancestorItem(item); p; p = ancestorItem(p)) depth++;
  return depth;
};

/** The bullet/task item `pos` sits in: the innermost list item around it, if
 *  that item is a bullet or task. Both sides of `pos` are looked at: at the
 *  end of an item's text (where the caret usually is) the node after `pos` is
 *  already outside the item. */
export function bulletItemAt(state: EditorState, pos: number): number | null {
  const tree = syntaxTree(state);
  let inner: SyntaxNode | null = null;
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name !== "ListItem") continue;
      if (!inner || node.from > inner.from) inner = node;
      break;
    }
  }
  return inner && isBulletItem(inner, state) ? inner.from : null;
}

/** The outermost list around `pos`, so a rail that crosses the viewport is
 *  drawn even when both of its ends are scrolled out of view. */
const outermostList = (state: EditorState, pos: number): { from: number; to: number } | null => {
  let found: SyntaxNode | null = null;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "BulletList" || n.name === "OrderedList") found = n;
  }
  return found ? { from: found.from, to: found.to } : null;
};

interface ItemInfo {
  id: number;
  parent: number | null;
  group: number;
  depth: number;
  markFrom: number;
  task: boolean;
}

function collectItems(state: EditorState, from: number, to: number): ItemInfo[] {
  const a = outermostList(state, from);
  const b = outermostList(state, to);
  const scanFrom = Math.min(from, a?.from ?? from);
  const scanTo = Math.max(to, b?.to ?? to);
  const items: ItemInfo[] = [];
  syntaxTree(state).iterate({
    from: scanFrom,
    to: scanTo,
    enter: (ref) => {
      if (ref.name !== "ListItem") return;
      const node = ref.node;
      if (!isBulletItem(node, state)) return;
      const up = ancestorItem(node);
      const mark = node.firstChild;
      const task = mark?.nextSibling?.name === "Task";
      items.push({
        id: node.from,
        parent: up && isBulletItem(up, state) ? up.from : null,
        group: node.parent?.from ?? node.from,
        depth: itemDepth(node),
        markFrom: mark?.from ?? node.from,
        task,
      });
    },
  });
  return items;
}

// ---------------------------------------------------------------------------
// View

let maskSeq = 0;
const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, tag);

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Measured {
  geo: RailGeometry;
  bounds: { x: number; y: number; w: number; h: number };
}

class TreeRailView {
  private readonly dom: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly mask: SVGMaskElement;
  private readonly maskRect: SVGRectElement;
  private readonly holes: SVGGElement;
  private readonly basePath: SVGPathElement;
  private readonly accentPath: SVGPathElement;
  private readonly measureReq: { read: () => Measured | null; write: (m: Measured | null) => void };
  private geo: RailGeometry | null = null;
  private hover: number | null = null;
  private target: number | null = null;
  /** What is on screen: the run being drawn and how much of it shows. */
  private shown: RailSegment[] = [];
  private shownLen = 0;
  private anim: AnimationPlaybackControls | null = null;
  private readonly dotLayer: HTMLDivElement;
  private readonly dot: HTMLSpanElement;
  /** The item the dot sits on, and where it is headed. */
  private dotItem: number | null = null;
  private dotAt: { x: number; y: number } | null = null;
  /** Where the dot is drawn right now (mid-hop it is between items). */
  private dotNow: { x: number; y: number } | null = null;
  private dotAnim: AnimationPlaybackControls | null = null;
  /** The landing point of the hop in flight, read live by the hop, so a
   *  layout move mid-hop shifts where it lands instead of snapping. */
  private hopTo: { x: number; y: number } | null = null;

  constructor(private readonly view: EditorView) {
    this.dom = view.scrollDOM.appendChild(document.createElement("div"));
    this.dom.className = "cm-list-rail-layer";
    this.dom.setAttribute("aria-hidden", "true");
    this.svg = this.dom.appendChild(svgEl("svg"));
    const maskId = `cm-list-rail-mask-${(++maskSeq).toString()}`;
    const defs = this.svg.appendChild(svgEl("defs"));
    this.mask = defs.appendChild(svgEl("mask"));
    this.mask.id = maskId;
    this.mask.setAttribute("maskUnits", "userSpaceOnUse");
    this.maskRect = this.mask.appendChild(svgEl("rect"));
    this.maskRect.setAttribute("fill", "white");
    this.holes = this.mask.appendChild(svgEl("g"));
    this.holes.setAttribute("fill", "black");
    const g = this.svg.appendChild(svgEl("g"));
    g.setAttribute("mask", `url(#${maskId})`);
    this.basePath = g.appendChild(svgEl("path"));
    this.basePath.classList.add("cm-list-rail");
    this.accentPath = g.appendChild(svgEl("path"));
    this.accentPath.classList.add("cm-list-rail-accent");
    // Above the text, so the dot covers the caret's bullet.
    this.dotLayer = view.scrollDOM.appendChild(document.createElement("div"));
    this.dotLayer.className = "cm-list-rail-dot-layer";
    this.dotLayer.setAttribute("aria-hidden", "true");
    this.dot = this.dotLayer.appendChild(document.createElement("span"));
    this.dot.className = "cm-list-rail-dot";
    this.measureReq = { read: () => this.measure(), write: (m) => this.draw(m) };
    view.requestMeasure(this.measureReq);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      // Item ids are positions: carry them through the edit, so typing in an
      // item keeps its dot still and Enter onto a new item makes it hop.
      const map = (id: number | null) => (id === null ? null : update.changes.mapPos(id, -1));
      this.dotItem = map(this.dotItem);
      this.hover = map(this.hover);
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      treeChanged(update)
    ) {
      update.view.requestMeasure(this.measureReq);
    } else if (update.selectionSet || update.focusChanged) {
      this.retarget(false);
      this.placeDot();
    }
  }

  setHover(id: number | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.retarget(true);
    this.placeDot();
  }

  destroy(): void {
    this.anim?.stop();
    this.dotAnim?.stop();
    this.dom.remove();
    this.dotLayer.remove();
  }

  private caretItem(): number | null {
    // The editor holding focus, not the window: the dot stays on your place
    // while another app is in front.
    if (this.view.root.activeElement !== this.view.contentDOM) return null;
    return bulletItemAt(this.view.state, this.view.state.selection.main.head);
  }

  private measure(): Measured | null {
    const { view } = this;
    const { from, to } = view.viewport;
    const items = collectItems(view.state, from, to);
    if (items.length === 0) return null;

    const scroller = view.scrollDOM.getBoundingClientRect();
    const sx = view.scaleX;
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * sx;
    const sy = view.scaleY;
    const docTop = (view.documentTop - (scroller.top - view.scrollDOM.scrollTop * sy)) / sy;

    // Layout boxes, never client rects: lines can be mid-animation (Combine
    // flies its lines in with a transform), and a rail measured then would
    // stay where the line was in flight. Offsets ignore transforms and are
    // already in the layer's space (it sits at the scroller's origin).
    const prefixBox = (item: ItemInfo) => {
      if (item.markFrom < from || item.markFrom > to) return null;
      const { node } = view.domAtPos(item.markFrom + 1);
      const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-list-prefix");
      if (!(el instanceof HTMLElement) || el.offsetWidth === 0) return null;
      // Sum offsets while inside the content (where lines may be animated),
      // then place that sum from the first ancestor outside it, which never is.
      let left = 0;
      let top = 0;
      let at: Element | null = el;
      while (at instanceof HTMLElement && at !== view.contentDOM && view.contentDOM.contains(at)) {
        left += at.offsetLeft;
        top += at.offsetTop;
        at = at.offsetParent;
      }
      if (!(at instanceof HTMLElement)) return null;
      const origin = at.getBoundingClientRect();
      const clientX = origin.left + (at.clientLeft - at.scrollLeft + left) * sx;
      const clientY = origin.top + (at.clientTop - at.scrollTop + top) * sy;
      return {
        left: (clientX - baseLeft) / sx,
        top: (clientY - (scroller.top - view.scrollDOM.scrollTop * sy)) / sy,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    };

    // A rendered prefix mark is `(depth + 1) * LIST_UNIT_CH` ch wide and
    // starts at the line's content edge: it gives both the edge and the ch.
    let edge: number | null = null;
    let ch: number | null = null;
    const boxes = new Map<number, NonNullable<ReturnType<typeof prefixBox>>>();
    for (const item of items) {
      const box = prefixBox(item);
      if (!box) continue;
      boxes.set(item.id, box);
      if (ch === null) {
        ch = box.width / ((item.depth + 1) * LIST_UNIT_CH);
        edge = box.left;
      }
    }
    if (ch === null || edge === null) return null;

    const nodes: RailNode[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      const box = boxes.get(item.id);
      const x = (box?.left ?? edge) + (item.depth + 0.5) * LIST_UNIT_CH * ch;
      const y = box
        ? box.top + box.height / 2
        : docTop + view.lineBlockAt(item.markFrom).top + view.defaultLineHeight / 2;
      const node: RailNode = {
        id: item.id,
        parent: item.parent,
        group: item.group,
        x,
        y,
        task: item.task,
      };
      nodes.push(node);
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    const pad = TASK_HOLE_HALF + 2;
    return {
      geo: railGeometry(nodes),
      bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad },
    };
  }

  private draw(m: Measured | null): void {
    this.geo = m?.geo ?? null;
    if (!m) {
      this.basePath.removeAttribute("d");
      this.target = null;
      this.paint([], 0);
      this.placeDot();
      return;
    }
    // The mask and its white field both cover the rails' bounds; a mask in
    // bounding-box units would collapse to nothing around a straight line.
    const { x, y, w, h } = m.bounds;
    for (const el of [this.mask, this.maskRect]) {
      el.setAttribute("x", fmt(x));
      el.setAttribute("y", fmt(y));
      el.setAttribute("width", fmt(w));
      el.setAttribute("height", fmt(h));
    }
    this.holes.replaceChildren(
      ...[...m.geo.nodes.values()].map((n) => {
        if (n.task) {
          const r = svgEl("rect");
          r.setAttribute("x", fmt(n.x - TASK_HOLE_HALF));
          r.setAttribute("y", fmt(n.y - TASK_HOLE_HALF));
          r.setAttribute("width", fmt(2 * TASK_HOLE_HALF));
          r.setAttribute("height", fmt(2 * TASK_HOLE_HALF));
          return r;
        }
        const c = svgEl("circle");
        c.setAttribute("cx", fmt(n.x));
        c.setAttribute("cy", fmt(n.y));
        c.setAttribute("r", fmt(DOT_HOLE_R));
        return c;
      }),
    );
    this.basePath.setAttribute("d", segmentsToPath(m.geo.base));
    // A re-measure is a layout change, not motion: settle at once.
    this.target = null;
    this.retarget(false);
    this.placeDot();
  }

  /** The dot onto the caret's item: a hop when the caret went to another
   *  item, a snap when only the layout moved, gone with no caret item. */
  /** The dot onto the hovered item, else the caret's: a hop when it goes to
   *  another item, a snap when only the layout moved, gone with neither. */
  private placeDot(): void {
    const id = this.hover ?? this.caretItem();
    const node = id === null ? undefined : this.geo?.nodes.get(id);
    if (!node) {
      this.dotItem = null;
      this.dotAnim?.stop();
      this.dotAnim = null;
      this.hopTo = null;
      this.dot.classList.remove("is-visible");
      return;
    }
    const to = {
      x: node.x - (node.task ? DOT_TASK_OFFSET : 0) - DOT_SIZE / 2,
      y: node.y - DOT_SIZE / 2,
    };
    const from = this.dotAt;
    const shown = this.dot.classList.contains("is-visible");
    const moved = id !== this.dotItem;
    this.dotItem = id;
    if (from && from.x === to.x && from.y === to.y && shown) return;
    this.dotAt = to;
    if (!moved && this.hopTo) {
      // Mid-hop, the same item moved (a re-measure): land where it is now.
      this.hopTo.x = to.x;
      this.hopTo.y = to.y;
      return;
    }
    this.dotAnim?.stop();
    this.dotAnim = null;
    this.hopTo = null;
    this.dot.classList.add("is-visible");
    const start = this.dotNow ?? from;
    const dx = start ? to.x - start.x : 0;
    const dy = start ? to.y - start.y : 0;
    const travel = Math.hypot(dx, dy);
    if (!moved || !shown || !start || travel < 1 || prefersReducedMotion()) {
      this.setDot(to);
      return;
    }
    const { x: cx, y: cy } = hopControl(start, to);
    const hopTo = { ...to };
    this.hopTo = hopTo;
    const long = Math.min(1, Math.max(0, (travel - 48) / 120));
    // One spring over the curve's progress (0 → 1000, as motion drives its
    // paths); its overshoot past the end carries on along the curve, which is
    // the landing bounce.
    const anim = animate(0, 1000, {
      type: "spring",
      stiffness: BOUNCE.stiffness - 60 * long,
      damping: BOUNCE.damping + long,
      mass: BOUNCE.mass + 0.15 * long,
      onUpdate: (p) => {
        const t = p / 1000;
        const u = 1 - t;
        this.setDot({
          x: u * u * start.x + 2 * u * t * cx + t * t * hopTo.x,
          y: u * u * start.y + 2 * u * t * cy + t * t * hopTo.y,
        });
      },
      onComplete: () => {
        if (this.dotAnim !== anim) return;
        this.setDot(hopTo);
        this.dotAnim = null;
        this.hopTo = null;
      },
    });
    this.dotAnim = anim;
  }

  private setDot(at: { x: number; y: number }): void {
    this.dotNow = at;
    this.dot.style.transform = `translate(${fmt(at.x)}px, ${fmt(at.y)}px)`;
  }

  /** Point the accent at the hovered item, else the caret's item. */
  private retarget(glide: boolean): void {
    const geo = this.geo;
    const next = this.hover ?? this.caretItem();
    const id = geo && next !== null && geo.nodes.has(next) ? next : null;
    if (id === this.target) return;
    this.target = id;
    this.anim?.stop();
    this.anim = null;
    if (!geo || id === null) {
      this.accentPath.classList.remove("is-visible");
      return;
    }
    const run = accentPath(geo, id);
    const runLen = pathLength(run);
    const wasHidden = !this.accentPath.classList.contains("is-visible");
    this.accentPath.classList.add("is-visible");
    // Coming back from hidden: appear on the item instead of travelling from
    // wherever the run was last parked.
    if (!glide || wasHidden || prefersReducedMotion()) {
      this.paint(run, runLen);
      return;
    }
    // Retract along what is shown to where the two runs part, then grow along
    // the new one: one eased progress over the whole distance.
    const from = this.shown;
    const fromLen = this.shownLen;
    const shared = Math.min(sharedLength(from, run), fromLen);
    const back = fromLen - shared;
    const total = back + (runLen - shared);
    if (total <= 0.5) {
      this.paint(run, runLen);
      return;
    }
    this.anim = animate(0, total, {
      duration: GLIDE_S,
      ease: EASE_OUT,
      onUpdate: (t) => {
        if (t < back) this.paint(from, fromLen - t);
        else this.paint(run, shared + (t - back));
      },
    });
  }

  private paint(run: RailSegment[], len: number): void {
    if (run !== this.shown) {
      this.shown = run;
      this.accentPath.setAttribute("d", segmentsToPath(run));
    }
    this.shownLen = len;
    const full = pathLength(run);
    if (len >= full - 0.01) this.accentPath.style.strokeDasharray = "";
    else this.accentPath.style.strokeDasharray = `${fmt(len)} ${fmt(full + 1)}`;
  }
}

const treeRailPlugin = ViewPlugin.fromClass(TreeRailView, {
  eventHandlers: {
    mousemove(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      this.setHover(pos === null ? null : bulletItemAt(view.state, pos));
    },
    mouseleave() {
      this.setHover(null);
    },
  },
});

const treeRailTheme = EditorView.baseTheme({
  ".cm-list-rail-layer": {
    position: "absolute",
    left: "0",
    top: "0",
    zIndex: "-1",
    pointerEvents: "none",
  },
  ".cm-list-rail-layer svg": {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    overflow: "visible",
  },
  ".cm-list-rail, .cm-list-rail-accent": {
    fill: "none",
    strokeWidth: "1px",
    strokeLinecap: "round",
  },
  ".cm-list-rail": {
    stroke: "var(--line-subtle, currentColor)",
  },
  ".cm-list-rail-accent": {
    stroke: "var(--text-secondary, currentColor)",
    opacity: "0",
    transition: "opacity var(--motion-fast) var(--ease-out)",
  },
  ".cm-list-rail-dot-layer": {
    position: "absolute",
    left: "0",
    top: "0",
    zIndex: "149",
    pointerEvents: "none",
  },
  ".cm-list-rail-dot": {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${DOT_SIZE.toString()}px`,
    height: `${DOT_SIZE.toString()}px`,
    borderRadius: "50%",
    background: "var(--text-primary, currentColor)",
    opacity: "0",
    transition: "opacity var(--motion-fast) var(--ease-out)",
    willChange: "transform",
  },
  ".cm-list-rail-dot.is-visible": {
    opacity: "1",
  },
  ".cm-list-rail-accent.is-visible": {
    opacity: "1",
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-list-rail-accent, .cm-list-rail-dot": { transition: "none" },
  },
});

export const listTreeRail = [treeRailPlugin, treeRailTheme];
