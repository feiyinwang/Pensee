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
/** A task box sits left of the bullet column: prosemark-theme.css centres its
 *  18px box in a 28px slot, so its centre is (28 - 18) / 2 px left. */
const TASK_X_SHIFT = -5;
// Matches --motion-settle and --ease-out (docs/motion.md): the run glides like
// a settle, and a retarget restarts from what is on screen, so it stays
// interruptible.
const GLIDE_S = 0.18;
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

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
 *  that item is a bullet or task. */
export function bulletItemAt(state: EditorState, pos: number): number | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "ListItem") return isBulletItem(node, state) ? node.from : null;
  }
  return null;
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
    this.measureReq = { read: () => this.measure(), write: (m) => this.draw(m) };
    view.requestMeasure(this.measureReq);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      treeChanged(update)
    ) {
      update.view.requestMeasure(this.measureReq);
    } else if (update.selectionSet || update.focusChanged) {
      this.retarget(false);
    }
  }

  setHover(id: number | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.retarget(true);
  }

  destroy(): void {
    this.anim?.stop();
    this.dom.remove();
  }

  private caretItem(): number | null {
    if (!this.view.hasFocus) return null;
    return bulletItemAt(this.view.state, this.view.state.selection.main.head);
  }

  private measure(): Measured | null {
    const { view } = this;
    const { from, to } = view.viewport;
    const items = collectItems(view.state, from, to);
    if (items.length === 0) return null;

    const scroller = view.scrollDOM.getBoundingClientRect();
    const sx = view.scaleX;
    const sy = view.scaleY;
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * sx;
    const baseTop = scroller.top - view.scrollDOM.scrollTop * sy;

    // A rendered prefix mark is `(depth + 1) * LIST_UNIT_CH` ch wide and
    // starts at the line's content edge: it gives both the edge and the ch.
    const prefixRect = (item: ItemInfo): DOMRect | null => {
      if (item.markFrom < from || item.markFrom > to) return null;
      const { node } = view.domAtPos(item.markFrom + 1);
      const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-list-prefix");
      return el ? el.getBoundingClientRect() : null;
    };

    let edge: number | null = null;
    let ch: number | null = null;
    const rects = new Map<number, DOMRect>();
    for (const item of items) {
      const rect = prefixRect(item);
      if (!rect || rect.width === 0) continue;
      rects.set(item.id, rect);
      if (ch === null) {
        ch = rect.width / ((item.depth + 1) * LIST_UNIT_CH);
        edge = rect.left;
      }
    }
    if (ch === null || edge === null) return null;

    const nodes: RailNode[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      const rect = rects.get(item.id);
      const left = rect?.left ?? edge;
      const x = left + (item.depth + 0.5) * LIST_UNIT_CH * ch + (item.task ? TASK_X_SHIFT * sx : 0);
      let y: number;
      const coords = rect ? view.coordsAtPos(item.markFrom, 1) : null;
      if (coords) y = (coords.top + coords.bottom) / 2;
      else {
        const block = view.lineBlockAt(item.markFrom);
        y = view.documentTop + (block.top + view.defaultLineHeight / 2) * sy;
      }
      const node: RailNode = {
        id: item.id,
        parent: item.parent,
        group: item.group,
        x: (x - baseLeft) / sx,
        y: (y - baseTop) / sy,
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
  ".cm-list-rail-accent.is-visible": {
    opacity: "1",
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-list-rail-accent": { transition: "none" },
  },
});

export const listTreeRail = [treeRailPlugin, treeRailTheme];
