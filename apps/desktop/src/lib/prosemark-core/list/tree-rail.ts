import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { treeChanged } from "../utils";

// Indent guides for bullet and task lists (SPECs/list-tree-rail-spec.md): one
// straight hairline per nested list, dropping from under the parent's bullet
// to the end of its last child's subtree. The guide of the list holding the
// hovered item (or, with no hover, the caret's item) is a shade darker, so you
// can tell which level you are on.
//
// Everything is drawn in one SVG behind the text, in the editor's scroll
// space, so it never enters the contenteditable DOM or its hit-testing.

/** Must match `LIST_UNIT_CH` in `./index.ts`: one indent step / marker slot. */
const LIST_UNIT_CH = 3;
/** Gap from a bullet's centre to the top of its guide, in px. */
const DOT_GAP = 10;
/** Gap from a task box's centre: half its 18px side plus the bullet's gap. */
const TASK_GAP = 14;
/** How far a guide stops above the bottom of the last child's last line. */
const END_INSET = 8;

export interface RailNode {
  /** `ListItem.from`; stable for the item while the doc is unchanged. */
  id: number;
  /** Parent bullet/task item, or null for a list's top-level items. */
  parent: number | null;
  /** Marker centre in layer px. */
  x: number;
  y: number;
  /** Bottom of the item's last line (its own or its last descendant's). */
  bottom: number;
  task: boolean;
}

export interface Guide {
  /** The item whose children this guide joins. */
  parent: number;
  x: number;
  y0: number;
  y1: number;
}

/** One guide per nested list, at its parent's bullet column. */
export function guideGeometry(list: readonly RailNode[]): Guide[] {
  const nodes = new Map(list.map((n) => [n.id, n]));
  const lastChild = new Map<number, RailNode>();
  for (const n of list) {
    if (n.parent === null) continue;
    const prev = lastChild.get(n.parent);
    if (!prev || n.y > prev.y) lastChild.set(n.parent, n);
  }
  const guides: Guide[] = [];
  for (const [id, last] of lastChild) {
    const parent = nodes.get(id);
    if (!parent) continue;
    const y0 = parent.y + (parent.task ? TASK_GAP : DOT_GAP);
    const y1 = Math.max(last.y, last.bottom - END_INSET);
    if (y1 > y0) guides.push({ parent: id, x: parent.x, y0, y1 });
  }
  return guides;
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

export const guidePath = (g: Guide): string => `M${fmt(g.x)} ${fmt(g.y0)}V${fmt(g.y1)}`;

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

/** The outermost list around `pos`, so a guide that crosses the viewport is
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
  depth: number;
  markFrom: number;
  /** A position on the item's last line (its own, or its last descendant's). */
  lastPos: number;
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
      // Step back off a trailing newline so the position stays on the item.
      const lastPos =
        node.to > node.from && state.doc.sliceString(node.to - 1, node.to) === "\n"
          ? node.to - 1
          : node.to;
      items.push({
        id: node.from,
        parent: up && isBulletItem(up, state) ? up.from : null,
        depth: itemDepth(node),
        markFrom: mark?.from ?? node.from,
        lastPos,
        task: mark?.nextSibling?.name === "Task",
      });
    },
  });
  return items;
}

// ---------------------------------------------------------------------------
// View

const SVG_NS = "http://www.w3.org/2000/svg";

interface Measured {
  guides: Guide[];
  /** Each measured item's parent, to find the list an item sits in. */
  parents: Map<number, number | null>;
}

class TreeRailView {
  private readonly dom: HTMLDivElement;
  private readonly group: SVGGElement;
  private readonly measureReq: { read: () => Measured | null; write: (m: Measured | null) => void };
  private parents = new Map<number, number | null>();
  private paths = new Map<number, SVGPathElement>();
  private hover: number | null = null;
  private active: SVGPathElement | null = null;

  constructor(private readonly view: EditorView) {
    this.dom = view.scrollDOM.appendChild(document.createElement("div"));
    this.dom.className = "cm-list-rail-layer";
    this.dom.setAttribute("aria-hidden", "true");
    const svg = this.dom.appendChild(document.createElementNS(SVG_NS, "svg"));
    this.group = svg.appendChild(document.createElementNS(SVG_NS, "g"));
    this.measureReq = { read: () => this.measure(), write: (m) => this.draw(m) };
    view.requestMeasure(this.measureReq);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      // Item ids are positions: carry the hovered one through the edit.
      if (this.hover !== null) this.hover = update.changes.mapPos(this.hover, -1);
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      treeChanged(update)
    ) {
      update.view.requestMeasure(this.measureReq);
    } else if (update.selectionSet || update.focusChanged) {
      this.highlight();
    }
  }

  setHover(id: number | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.highlight();
  }

  destroy(): void {
    this.dom.remove();
  }

  private caretItem(): number | null {
    // The editor holding focus, not the window: your level stays marked while
    // another app is in front.
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
    // flies its lines in with a transform), and a guide measured then would
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

    const nodes: RailNode[] = items.map((item) => {
      const box = boxes.get(item.id);
      return {
        id: item.id,
        parent: item.parent,
        x: (box?.left ?? edge) + (item.depth + 0.5) * LIST_UNIT_CH * ch,
        y: box
          ? box.top + box.height / 2
          : docTop + view.lineBlockAt(item.markFrom).top + view.defaultLineHeight / 2,
        bottom: docTop + view.lineBlockAt(item.lastPos).bottom,
        task: item.task,
      };
    });
    return {
      guides: guideGeometry(nodes),
      parents: new Map(items.map((i) => [i.id, i.parent])),
    };
  }

  private draw(m: Measured | null): void {
    this.parents = m?.parents ?? new Map();
    this.paths = new Map(
      (m?.guides ?? []).map((g) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.classList.add("cm-list-guide");
        path.setAttribute("d", guidePath(g));
        return [g.parent, path];
      }),
    );
    this.group.replaceChildren(...this.paths.values());
    this.active = null;
    this.highlight();
  }

  /** Darken the guide of the list holding the hovered item, else the caret's. */
  private highlight(): void {
    const id = this.hover ?? this.caretItem();
    const parent = id === null ? null : this.parents.get(id);
    const next = parent == null ? null : (this.paths.get(parent) ?? null);
    if (next === this.active) return;
    this.active?.classList.remove("is-active");
    next?.classList.add("is-active");
    this.active = next;
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
  ".cm-list-guide": {
    fill: "none",
    strokeWidth: "1px",
    strokeLinecap: "round",
    stroke: "var(--color-border-subtle, currentColor)",
    transition: "stroke var(--motion-hover) var(--ease-out)",
  },
  ".cm-list-guide.is-active": {
    stroke: "var(--color-text-faint, currentColor)",
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-list-guide": { transition: "none" },
  },
});

export const listTreeRail = [treeRailPlugin, treeRailTheme];
