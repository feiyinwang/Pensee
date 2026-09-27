// Outline maths for the heading tree, kept free of DOM/Tauri imports so it can
// be unit tested on its own (same split as `section-rail-depth.ts`).

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findHeadingHashEnd, getMarkdownHeadingLevel } from "./heading-decorations";

/** Horizontal distance between tree levels, in px. The toggle circle sits in
 *  the first `TREE_STEP` of a heading's own column and its text starts one step
 *  in, so a child's circle lands exactly under its parent's text. */
export const TREE_STEP = 24;

export interface TreeHeading {
  /** Line start of the heading. */
  from: number;
  /** First heading-text char (after `## `); line start for setext headings. */
  textFrom: number;
  /** Raw `#` count, 1–6. */
  level: number;
  /** Nesting depth, 0-based. Skipped levels collapse to one step (H1 -> H3 is
   *  depth 1), matching `parseDocumentHeadings`, so the tree never grows an
   *  empty column. */
  depth: number;
  /** Outline index of the parent heading, or -1 at the root. */
  parent: number;
}

/** Top-level headings of the document, in order. Only direct children of the
 *  Document node count: a `#` inside a list item or blockquote belongs to that
 *  block, not to the document's section structure. Reads whatever the parser
 *  has committed; headings past the parsed frontier appear once it catches up. */
export function collectOutline(state: EditorState): TreeHeading[] {
  const outline: TreeHeading[] = [];
  const open: number[] = [];
  const cursor = syntaxTree(state).topNode.cursor();
  if (!cursor.firstChild()) return outline;
  do {
    const level = getMarkdownHeadingLevel(cursor.name);
    if (level === null) continue;
    const from = state.doc.lineAt(cursor.from).from;
    const textFrom = cursor.name.startsWith("ATX")
      ? (findHeadingHashEnd(cursor.node) ?? cursor.to)
      : from;
    while (open.length > 0 && outline[open[open.length - 1]].level >= level) open.pop();
    outline.push({
      from,
      textFrom,
      level,
      depth: open.length,
      parent: open.length > 0 ? open[open.length - 1] : -1,
    });
    open.push(outline.length - 1);
  } while (cursor.nextSibling());
  return outline;
}

/** Index of the heading whose section contains `pos` (the last heading
 *  starting at or before it), or -1 for the preamble. */
export function ownerIndexAt(outline: readonly TreeHeading[], pos: number): number {
  let lo = 0;
  let hi = outline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (outline[mid].from <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Left margin, in px, of every line in a section owned by a heading at
 *  `depth`. The heading line and its body share it, like a Reddit comment's
 *  username and body text. */
export function indentForTreeDepth(depth: number): number {
  return (depth + 1) * TREE_STEP;
}

export interface TreeLinks {
  /** Outline indices of headings not hidden inside a collapsed section. */
  visible: number[];
  /** Parent outline index → its last visible child. A parent only draws a
   *  thread line when it has one. */
  lastChild: Map<number, number>;
}

/** Which headings are on screen and where each parent's thread line ends.
 *  `isHidden` is true for headings inside a folded range. A visible child
 *  always has a visible parent: the parent's own fold would cover the child. */
export function treeLinks(
  outline: readonly TreeHeading[],
  isHidden: (heading: TreeHeading) => boolean,
): TreeLinks {
  const visible: number[] = [];
  const lastChild = new Map<number, number>();
  outline.forEach((heading, i) => {
    if (isHidden(heading)) return;
    visible.push(i);
    if (heading.parent >= 0) lastChild.set(heading.parent, i);
  });
  return { visible, lastChild };
}
