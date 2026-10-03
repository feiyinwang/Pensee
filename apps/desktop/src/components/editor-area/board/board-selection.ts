/**
 * What the selection toolbar shows for the current selection — pure, so the
 * rules for which control appears when are testable without a DOM.
 *
 * A control appears when at least one selected element can take it, and shows
 * the value of the first such element. Applying it changes every selected
 * element that can take it and leaves the rest alone (Lark behaves the same).
 */

import { branchColor, isMind, mindParent } from "./board-mind";
import {
  type ArrowHead,
  type BoardEl,
  type BoardScene,
  type MindEl,
  type ColorToken,
  type LinkerShape,
  type ShapeEl,
  type ShapeKind,
  type StickyColor,
  type StrokeDash,
  type TextEl,
  isLinker,
  isShape,
} from "./board-model";

export type Align = "l" | "c" | "r";

export interface SelectionSummary {
  count: number;
  /** Shape kind switcher — shapes only. */
  shapeKind?: ShapeKind;
  /** Fill — shapes. */
  fill?: ColorToken;
  /** Paper colour — sticky notes. */
  sticky?: StickyColor;
  /** Border / line — shapes and connectors. */
  stroke?: ColorToken;
  width?: number;
  dash?: StrokeDash;
  /** Text — text elements and shapes that carry a label. */
  textColor?: ColorToken;
  fontSize?: number;
  align?: Align;
  /** Mind-map topics below the root: the colour of their branch. */
  branch?: ColorToken;
  /** Connectors only. */
  route?: LinkerShape;
  heads?: { s: ArrowHead; e: ArrowHead };
  opacity: number;
}

function hasLabel(el: BoardEl): el is ShapeEl & { lb: NonNullable<ShapeEl["lb"]> } {
  return isShape(el) && Boolean(el.lb?.tx);
}

export function summarizeSelection(els: BoardEl[], scene?: BoardScene): SelectionSummary | null {
  if (!els.length) return null;
  const summary: SelectionSummary = { count: els.length, opacity: els[0].op };

  const topic = scene ? els.find((el) => isMind(el) && el.pa) : undefined;
  if (scene && isMind(topic)) summary.branch = branchColor(scene, topic);

  const shape = els.find(isShape);
  if (shape) {
    summary.shapeKind = shape.t;
    summary.fill = shape.st.f;
  }

  const sticky = els.find((el) => el.t === "sticky");
  if (sticky?.t === "sticky") summary.sticky = sticky.c;

  const stroked = els.find((el) => isShape(el) || isLinker(el) || el.t === "draw") as
    | ShapeEl
    | undefined;
  if (stroked) {
    summary.stroke = stroked.st.s;
    summary.width = stroked.st.w;
    summary.dash = stroked.st.d;
  }

  const text = els.find((el) => el.t === "text") as TextEl | undefined;
  const labelled = els.find(hasLabel);
  if (text) {
    summary.textColor = text.c;
    summary.fontSize = text.sz;
    summary.align = text.al;
  } else if (labelled) {
    summary.textColor = labelled.lb.c ?? "ink";
    summary.fontSize = labelled.lb.sz;
    summary.align = labelled.lb.al;
  }

  const linker = els.find(isLinker);
  if (linker) {
    summary.route = linker.sh;
    summary.heads = { ...linker.hd };
  }

  return summary;
}

/* -------------------------------------------------------------- apply */

/** Recolours the branch `el` sits on: the colour lives on its first-level topic. */
export function applyBranchColor(scene: BoardScene, el: BoardEl, c: ColorToken): void {
  if (!isMind(el) || !el.pa) return;
  let node: MindEl = el;
  for (let parent = mindParent(scene, node); parent?.pa; parent = mindParent(scene, node)) {
    node = parent;
  }
  node.c = c;
}

export function applyTextColor(el: BoardEl, c: ColorToken): void {
  if (el.t === "text") el.c = c;
  else if (hasLabel(el)) {
    if (c === "ink") delete el.lb.c;
    else el.lb.c = c;
  }
}

export function applyFontSize(el: BoardEl, sz: number): void {
  if (el.t === "text") el.sz = sz;
  else if (hasLabel(el)) el.lb.sz = sz;
}

export function applyAlign(el: BoardEl, al: Align): void {
  if (el.t === "text") el.al = al;
  else if (hasLabel(el)) el.lb.al = al;
}
