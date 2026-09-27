import {
  Decoration,
  type DecorationSet,
  EditorView,
  layer,
  type LayerMarker,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  codeFolding,
  foldable,
  foldedRanges,
  foldEffect,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { useSettingsStore } from "@/stores/settings-store";
import {
  TREE_STEP,
  type TreeHeading,
  collectOutline,
  indentForTreeDepth,
  ownerIndexAt,
  treeLinks,
} from "./heading-tree-model";
import "./heading-tree.css";

// Reddit-style heading tree. Every section is indented one `TREE_STEP` per
// nesting level; each heading gets a toggle circle in the step to the left of
// its text, and a parent's thread line runs down from its circle and curves
// into each child's circle. The circle collapses the section with CodeMirror's
// fold state (the markdown language's `headerIndent` fold service supplies the
// section range), so a collapsed section is a real fold: the caret, search and
// copy all treat it the way they treat any other fold.
//
// Indentation is a `margin-left` line decoration rather than padding: list and
// blockquote lines already own their padding, and a margin shifts the whole
// line box (hanging hash included) without touching either.
//
// Lines and circles are drawn on a layer, not in the lines, because a thread
// spans many lines and must pass over blank lines and block widgets whose DOM
// the tree does not own.

const SETTING_KEY = "editor.heading-tree";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Toggle circle radius. Its left edge sits at the start of the heading's
 *  column, so its centre is `CIRCLE_R` in. */
const CIRCLE_R = 8;
/** Radius of the curve where a thread turns into a child. */
const ELBOW_R = 10;
/** Gap between a circle's edge and the thread leaving it. */
const THREAD_GAP = 3;

function readSetting(): boolean {
  const value = useSettingsStore.getState().settings[SETTING_KEY];
  return typeof value === "boolean" ? value : true;
}

const setTreeEnabled = StateEffect.define<boolean>();

const treeEnabledField = StateField.define<boolean>({
  create: readSetting,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setTreeEnabled)) value = effect.value;
    return value;
  },
});

const EMPTY_OUTLINE: readonly TreeHeading[] = [];

const outlineField = StateField.define<readonly TreeHeading[]>({
  create: (state) => (state.field(treeEnabledField) ? collectOutline(state) : EMPTY_OUTLINE),
  update(value, tr) {
    const enabled = tr.state.field(treeEnabledField);
    if (!enabled) return EMPTY_OUTLINE;
    const toggled = enabled !== tr.startState.field(treeEnabledField);
    if (toggled || tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return collectOutline(tr.state);
    }
    return value;
  },
});

function treeInputsChanged(update: ViewUpdate): boolean {
  return (
    update.state.field(outlineField) !== update.startState.field(outlineField) ||
    foldedRanges(update.state) !== foldedRanges(update.startState)
  );
}

// ---------- Setting sync ----------

// Mirrors the setting into the editor state. Turning the tree off also opens
// every collapsed section: the circles are the only way to reopen them, and
// leaving text folded behind a control that no longer exists would hide it.
const settingSync = ViewPlugin.define((view) => {
  const unsubscribe = useSettingsStore.subscribe(() => {
    const next = readSetting();
    if (next === view.state.field(treeEnabledField)) return;
    const effects: StateEffect<unknown>[] = [setTreeEnabled.of(next)];
    if (!next) {
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        effects.push(unfoldEffect.of({ from, to }));
      });
    }
    view.dispatch({ effects });
  });
  return { destroy: unsubscribe };
});

const treeAttributes = EditorView.editorAttributes.of((view) =>
  view.state.field(treeEnabledField) ? { class: "cm-heading-tree" } : null,
);

// ---------- Indentation ----------

const indentDecos = new Map<number, Decoration>();
function indentDeco(px: number): Decoration {
  let deco = indentDecos.get(px);
  if (!deco) {
    deco = Decoration.line({ attributes: { style: `margin-left: ${px}px` } });
    indentDecos.set(px, deco);
  }
  return deco;
}

function buildIndent(view: EditorView): DecorationSet {
  const outline = view.state.field(outlineField);
  if (outline.length === 0) return Decoration.none;
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      // A visible range that starts right after a fold begins mid-line: that
      // line's start is folded away and its visible tail belongs to the
      // heading line, which already carries the margin.
      if (line.from >= from) {
        const owner = ownerIndexAt(outline, line.from);
        if (owner >= 0) {
          builder.add(line.from, line.from, indentDeco(indentForTreeDepth(outline[owner].depth)));
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const indentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildIndent(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || treeInputsChanged(update)) {
        this.decorations = buildIndent(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- Collapse ----------

function foldAtLine(state: EditorState, lineTo: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) found = { from, to };
  });
  return found;
}

/** Collapse or expand the section under the heading starting at `lineFrom`. */
export function toggleHeadingSection(view: EditorView, lineFrom: number): boolean {
  const { state } = view;
  const line = state.doc.lineAt(lineFrom);
  const existing = foldAtLine(state, line.to);
  if (existing) {
    view.dispatch({ effects: unfoldEffect.of(existing) });
    return true;
  }
  const range = foldable(state, line.from, line.to);
  if (!range) return false;
  // A caret left inside the folded text would type into text nobody can see.
  const caretInside = state.selection.ranges.some((r) => r.head > range.from && r.head <= range.to);
  view.dispatch({
    effects: foldEffect.of(range),
    selection: caretInside ? { anchor: range.from } : undefined,
  });
  return true;
}

// ---------- Layer ----------

type ToggleState = "open" | "collapsed" | "leaf";

class ThreadMarker implements LayerMarker {
  constructor(readonly path: string) {}

  draw() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cm-heading-tree-threads");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", this.path);
    svg.appendChild(path);
    return svg as unknown as HTMLElement;
  }

  update(dom: HTMLElement, prev: LayerMarker) {
    if (!(prev instanceof ThreadMarker)) return false;
    dom.firstElementChild?.setAttribute("d", this.path);
    return true;
  }

  eq(other: LayerMarker): boolean {
    return other instanceof ThreadMarker && other.path === this.path;
  }
}

class ToggleMarker implements LayerMarker {
  constructor(
    readonly lineFrom: number,
    readonly left: number,
    readonly top: number,
    readonly toggle: ToggleState,
  ) {}

  draw() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-heading-tree-toggle";
    button.tabIndex = -1;
    this.apply(button);
    return button;
  }

  update(dom: HTMLElement, prev: LayerMarker) {
    if (!(prev instanceof ToggleMarker)) return false;
    this.apply(dom as HTMLButtonElement);
    return true;
  }

  eq(other: LayerMarker): boolean {
    return (
      other instanceof ToggleMarker &&
      other.lineFrom === this.lineFrom &&
      other.left === this.left &&
      other.top === this.top &&
      other.toggle === this.toggle
    );
  }

  private apply(button: HTMLButtonElement) {
    button.style.left = `${this.left}px`;
    button.style.top = `${this.top}px`;
    button.dataset.lineFrom = String(this.lineFrom);
    button.dataset.state = this.toggle;
    button.disabled = this.toggle === "leaf";
    button.title =
      this.toggle === "collapsed"
        ? "Expand section"
        : this.toggle === "open"
          ? "Collapse section"
          : "";
  }
}

const round = (n: number) => Math.round(n * 2) / 2;

function buildMarkers(view: EditorView): readonly LayerMarker[] {
  const { state } = view;
  const outline = state.field(outlineField);
  if (outline.length === 0) return [];

  const folds = foldedRanges(state);
  const isHidden = (heading: TreeHeading) => {
    let hidden = false;
    folds.between(heading.from, heading.from, (from, to) => {
      if (heading.from > from && heading.from <= to) hidden = true;
    });
    return hidden;
  };
  const { visible, lastChild } = treeLinks(outline, isHidden);
  if (visible.length === 0) return [];

  // Layer coordinates: relative to the scroller's content origin, the same
  // base CodeMirror's own RectangleMarker uses.
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const baseLeft = scrollRect.left - view.scrollDOM.scrollLeft;
  const baseTop = scrollRect.top - view.scrollDOM.scrollTop;
  const contentRect = view.contentDOM.getBoundingClientRect();
  const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
  const originX = contentRect.left + padLeft - baseLeft;
  const columnX = (depth: number) => originX + depth * TREE_STEP;

  // Circle centre y, per heading. Rendered headings are measured; the rest
  // (off-screen ends of a long thread) are placed from the height map with the
  // offset a measured heading showed, so the thread is continuous either way.
  const { from: viewFrom, to: viewTo } = view.viewport;
  const inViewport = (h: TreeHeading) => h.from >= viewFrom && h.from <= viewTo;
  const blockTop = (h: TreeHeading) => view.documentTop + view.lineBlockAt(h.from).top - baseTop;
  const centers = new Map<number, number>();
  let offset: number | null = null;
  for (const i of visible) {
    const heading = outline[i];
    if (!inViewport(heading)) continue;
    const coords = view.coordsAtPos(heading.textFrom, 1) ?? view.coordsAtPos(heading.textFrom, -1);
    if (!coords) continue;
    const y = (coords.top + coords.bottom) / 2 - baseTop;
    centers.set(i, y);
    offset ??= y - blockTop(heading);
  }
  const fallbackOffset = offset ?? 16 + view.defaultLineHeight / 2;
  const centerY = (i: number) => centers.get(i) ?? blockTop(outline[i]) + fallbackOffset;

  const markers: LayerMarker[] = [];
  let path = "";

  for (const i of visible) {
    const heading = outline[i];
    const last = lastChild.get(i);
    // Thread down from this heading's circle to where its last child's elbow
    // begins. Drawn whenever any part of it can be on screen.
    if (last !== undefined && heading.from <= viewTo && outline[last].from >= viewFrom) {
      const x = round(columnX(heading.depth) + CIRCLE_R);
      const top = round(centerY(i) + CIRCLE_R + THREAD_GAP);
      const bottom = round(centerY(last) - ELBOW_R);
      if (bottom > top) path += `M${x} ${top}V${bottom}`;
    }
    // Elbow from the parent's thread into this heading's circle.
    if (heading.parent >= 0 && inViewport(heading)) {
      const x = round(columnX(outline[heading.parent].depth) + CIRCLE_R);
      const y = round(centerY(i));
      const end = round(columnX(heading.depth) - THREAD_GAP);
      path += `M${x} ${y - ELBOW_R}A${ELBOW_R} ${ELBOW_R} 0 0 0 ${x + ELBOW_R} ${y}H${end}`;
    }
  }
  if (path) markers.push(new ThreadMarker(path));

  // While the caret or selection is on a heading line, its hanging `#` marks
  // show in exactly the circle's spot; the circle steps aside for them.
  const onHeadingLine = (h: TreeHeading) => {
    const lineTo = state.doc.lineAt(h.from).to;
    return state.selection.ranges.some((r) => r.from <= lineTo && r.to >= h.from);
  };

  for (const i of visible) {
    const heading = outline[i];
    if (!inViewport(heading) || onHeadingLine(heading)) continue;
    const line = state.doc.lineAt(heading.from);
    const toggle: ToggleState = foldAtLine(state, line.to)
      ? "collapsed"
      : foldable(state, line.from, line.to)
        ? "open"
        : "leaf";
    markers.push(
      new ToggleMarker(
        heading.from,
        round(columnX(heading.depth)),
        round(centerY(i) - CIRCLE_R),
        toggle,
      ),
    );
  }
  return markers;
}

const treeLayer = layer({
  above: true,
  class: "cm-heading-tree-layer",
  markers: buildMarkers,
  update: (update) =>
    update.docChanged || update.viewportChanged || update.selectionSet || treeInputsChanged(update),
  mount(dom, view) {
    dom.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".cm-heading-tree-toggle");
      if (!button || button.disabled) return;
      // Keep focus and the caret in the editor.
      event.preventDefault();
      event.stopPropagation();
      toggleHeadingSection(view, Number(button.dataset.lineFrom));
    });
  },
});

export const headingTree: Extension = [
  treeEnabledField,
  outlineField,
  settingSync,
  treeAttributes,
  codeFolding({ placeholderText: "…" }),
  indentPlugin,
  treeLayer,
];
