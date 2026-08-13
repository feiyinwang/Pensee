import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  IMAGE_BLOCK,
  parseColumns,
  serializeColumns,
  splitBands,
  withBand,
  type BandName,
  type Column,
} from "./columns-model";
import { blockTypeOf, setBlockType, type BlockTypeId } from "./markdown-formatting";

/**
 * Block-level edits, addressed by document position rather than by DOM node.
 *
 * The gutter handle points at three different things — a top-level block, one
 * band of a column, a whole column — and every menu action has to work on all
 * three. DOM references cannot carry that: the first dispatch rebuilds the row
 * widget and every element the menu was holding is gone. So the menu resolves
 * its target to {@link ActionTarget} (offsets and indices, no elements) the
 * moment it opens, and everything below re-reads the document each time.
 *
 * Two rules hold for every exported action:
 *
 *  1. **One dispatch.** `Cmd+Z` returns to the state before the menu item was
 *     clicked, once. An action that writes twice needs two undos, which reads
 *     as a bug even when the end state is right.
 *  2. **The target, not the caret.** These never look at `state.selection`.
 *     The handle can be beside a block the caret has never visited.
 */

/**
 * The slice of `EditorView` these actions actually need. Narrower than the
 * real thing on purpose: an `EditorView` cannot be built without a DOM, and
 * every rule encoded below — where the caret lands, which blank line gets
 * eaten, whether a one-column row unwraps — is worth a test. `EditorView`
 * satisfies this structurally, so callers pass one and notice nothing.
 */
export interface BlockEditor {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
  focus?: () => void;
}

/* ------------------------------------------------------------- row addressing */

export interface RowRef {
  from: number;
  to: number;
  columns: Column[];
}

export function rowRefAt(view: BlockEditor, pos: number): RowRef | null {
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(Math.min(Math.max(pos, 0), doc.length), 1);
  while (node && node.name !== "ColumnRow") node = node.parent;
  if (!node) return null;
  const columns = parseColumns(doc.sliceString(node.from, node.to));
  return columns ? { from: node.from, to: node.to, columns } : null;
}

/** Removing a column may leave a single survivor. A one-column row is not a
 *  row — unwrap it back into a plain block. */
export function rowAfterRemoval(
  ref: RowRef,
  index: number,
): { from: number; to: number; insert: string } {
  const rest = ref.columns.filter((_, i) => i !== index);
  if (rest.length >= 2) {
    return { from: ref.from, to: ref.to, insert: serializeColumns(rest) };
  }
  return { from: ref.from, to: ref.to, insert: (rest[0]?.md ?? "").trim() };
}

/** Take one band out of a column. Emptying the column removes the column, and
 *  a row with one column left is not a row — it delegates both invariants to
 *  {@link rowAfterRemoval} so the two can never disagree. */
export function rowAfterBandRemoval(
  ref: RowRef,
  index: number,
  band: BandName,
): { from: number; to: number; insert: string } | null {
  const column = ref.columns[index];
  if (!column) return null;
  const md = withBand(column.md, band, "").trim();
  if (!md) return rowAfterRemoval(ref, index);
  const columns = ref.columns.map((c, i) => (i === index ? { ...c, md } : c));
  return { from: ref.from, to: ref.to, insert: serializeColumns(columns) };
}

/* ------------------------------------------------------------------- targets */

export type ActionTarget =
  | { kind: "block"; from: number; to: number; name: string }
  | { kind: "band"; rowFrom: number; index: number; band: BandName }
  | { kind: "col"; rowFrom: number; index: number };

/** Node names whose text is not prose: turning one into a heading would put a
 *  `## ` in front of a code fence or a table pipe. The type tiles hide here. */
const OPAQUE_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "CommentBlock",
  "ColumnRow",
  "HorizontalRule",
]);

/** Can this target be turned into a heading, a list, a quote? */
export function acceptsBlockType(view: BlockEditor, target: ActionTarget): boolean {
  if (target.kind === "col") return false;
  const md = targetMarkdown(view, target);
  if (md == null) return false;
  if (IMAGE_BLOCK.test(md.trim())) return false;
  return target.kind !== "block" || !OPAQUE_BLOCKS.has(target.name);
}

/** The markdown the handle is pointing at, or null if the target has gone
 *  stale (the file changed under us, the row was rewritten elsewhere). */
export function targetMarkdown(view: BlockEditor, target: ActionTarget): string | null {
  if (target.kind === "block") {
    if (target.to > view.state.doc.length) return null;
    return view.state.doc.sliceString(target.from, target.to);
  }
  const column = rowRefAt(view, target.rowFrom)?.columns[target.index];
  if (!column) return null;
  return target.kind === "col" ? column.md : splitBands(column.md)[target.band];
}

/** Replace everything the target covers. Empty text deletes it. */
function writeTarget(
  view: BlockEditor,
  target: ActionTarget,
  md: string,
  userEvent: string,
): boolean {
  const next = md.trim();
  if (target.kind === "block") {
    if (!next) return deleteTarget(view, target);
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: next },
      selection: EditorSelection.cursor(target.from),
      userEvent,
      scrollIntoView: true,
    });
    return true;
  }

  const ref = rowRefAt(view, target.rowFrom);
  const column = ref?.columns[target.index];
  if (!ref || !column) return false;

  let change: { from: number; to: number; insert: string } | null;
  if (target.kind === "col") {
    change = next
      ? {
          from: ref.from,
          to: ref.to,
          insert: serializeColumns(
            ref.columns.map((c, i) => (i === target.index ? { ...c, md: next } : c)),
          ),
        }
      : rowAfterRemoval(ref, target.index);
  } else if (!next) {
    change = rowAfterBandRemoval(ref, target.index, target.band);
  } else {
    const md2 = withBand(column.md, target.band, next);
    change = {
      from: ref.from,
      to: ref.to,
      insert: serializeColumns(
        ref.columns.map((c, i) => (i === target.index ? { ...c, md: md2 } : c)),
      ),
    };
  }
  if (!change) return false;

  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(change.from),
    userEvent,
    scrollIntoView: true,
  });
  return true;
}

/* -------------------------------------------------------------- block shapes */

/** Which tile in the type grid is lit, if any. */
export function currentBlockType(view: BlockEditor, target: ActionTarget): BlockTypeId | null {
  const md = targetMarkdown(view, target);
  return md == null ? null : blockTypeOf(md.trim());
}

/** Convert the target. Picking the shape it already has clears it back to
 *  plain text — a radio group you can switch off, the same as Notion. */
export function applyBlockType(view: BlockEditor, target: ActionTarget, id: BlockTypeId): boolean {
  const md = targetMarkdown(view, target);
  if (md == null) return false;
  const current = blockTypeOf(md.trim());
  const next = setBlockType(md.trim(), current === id ? "text" : id);
  if (next === md.trim()) return false;
  return writeTarget(view, target, next, `input.block.${id}`);
}

/* -------------------------------------------------------------------- moving */

interface Span {
  from: number;
  to: number;
}

/** Every top-level block in document order. This is the list "move up" walks;
 *  it is deliberately the same unit the gutter handle drags, so a block cannot
 *  be draggable to a place it cannot be moved to with the keyboard. */
function topLevelSpans(view: BlockEditor): Span[] {
  const spans: Span[] = [];
  for (let n = syntaxTree(view.state).topNode.firstChild; n; n = n.nextSibling) {
    spans.push({ from: n.from, to: n.to });
  }
  return spans;
}

function spanIndex(spans: Span[], from: number): number {
  return spans.findIndex((s) => s.from === from);
}

/** Is there a block on that side to trade places with? */
export function canMove(view: BlockEditor, target: ActionTarget, dir: -1 | 1): boolean {
  if (target.kind === "band") return false;
  if (target.kind === "col") {
    const ref = rowRefAt(view, target.rowFrom);
    if (!ref) return false;
    const next = target.index + dir;
    return next >= 0 && next < ref.columns.length;
  }
  const spans = topLevelSpans(view);
  const i = spanIndex(spans, target.from);
  return i >= 0 && i + dir >= 0 && i + dir < spans.length;
}

export function moveTarget(view: BlockEditor, target: ActionTarget, dir: -1 | 1): boolean {
  if (target.kind === "band") return false;

  if (target.kind === "col") {
    const ref = rowRefAt(view, target.rowFrom);
    if (!ref) return false;
    const to = target.index + dir;
    const held = ref.columns[target.index];
    const other = ref.columns[to];
    if (!held || !other) return false;
    const columns = ref.columns.slice();
    columns[target.index] = other;
    columns[to] = held;
    view.dispatch({
      changes: { from: ref.from, to: ref.to, insert: serializeColumns(columns) },
      selection: EditorSelection.cursor(ref.from),
      userEvent: "move.column",
      scrollIntoView: true,
    });
    return true;
  }

  const spans = topLevelSpans(view);
  const i = spanIndex(spans, target.from);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= spans.length) return false;
  // Name them by document order, not by which one the user grabbed: the swap
  // is written as one replacement over both, and it needs a stable "first".
  const a = spans[dir < 0 ? j : i]!;
  const b = spans[dir < 0 ? i : j]!;
  const doc = view.state.doc;
  const aText = doc.sliceString(a.from, a.to);
  const bText = doc.sliceString(b.from, b.to);
  const insert = `${bText}\n\n${aText}`;
  const landing = dir < 0 ? a.from : a.from + bText.length + 2;
  view.dispatch({
    changes: { from: a.from, to: b.to, insert },
    selection: EditorSelection.cursor(landing),
    userEvent: "move.block",
    scrollIntoView: true,
  });
  return true;
}

/* ----------------------------------------------------------------- inserting */

/** A new empty block beside this one, with the caret in it. Only plain blocks:
 *  bands are derived from a column's blocks, so an empty band would be trimmed
 *  away the moment it was written. */
export function canInsert(target: ActionTarget): boolean {
  return target.kind === "block";
}

export function insertBlock(
  view: BlockEditor,
  target: ActionTarget,
  where: "above" | "below",
): boolean {
  if (target.kind !== "block") return false;
  const at = where === "above" ? target.from : target.to;
  const caret = where === "above" ? at : at + 2;
  view.dispatch({
    changes: { from: at, insert: "\n\n" },
    selection: EditorSelection.cursor(caret),
    userEvent: `input.block.insert.${where}`,
    scrollIntoView: true,
  });
  view.focus?.();
  return true;
}

/* ---------------------------------------------------------------- duplicating */

export function duplicateTarget(view: BlockEditor, target: ActionTarget): boolean {
  const md = targetMarkdown(view, target)?.trim();
  if (!md) return false;

  if (target.kind === "block") {
    view.dispatch({
      changes: { from: target.to, insert: `\n\n${md}` },
      selection: EditorSelection.cursor(target.to + 2),
      userEvent: "input.block.duplicate",
      scrollIntoView: true,
    });
    return true;
  }

  if (target.kind === "band") {
    return writeTarget(view, target, `${md}\n\n${md}`, "input.block.duplicate");
  }

  const ref = rowRefAt(view, target.rowFrom);
  const column = ref?.columns[target.index];
  if (!ref || !column) return false;
  const columns = ref.columns.slice();
  columns.splice(target.index + 1, 0, { ...column });
  view.dispatch({
    changes: { from: ref.from, to: ref.to, insert: serializeColumns(columns) },
    selection: EditorSelection.cursor(ref.from),
    userEvent: "input.block.duplicate",
    scrollIntoView: true,
  });
  return true;
}

/* ------------------------------------------------------------------ deleting */

export function deleteTarget(view: BlockEditor, target: ActionTarget): boolean {
  if (target.kind !== "block") return writeTarget(view, target, "", "delete.block");

  const doc = view.state.doc;
  let from = target.from;
  let to = Math.min(target.to, doc.length);
  // Take the blank line with it, or deleting the middle block of three leaves
  // a two-line gap behind. Trailing side first; only eat backwards when there
  // is nothing after, or the block below would jump up into the one above.
  while (to < doc.length && doc.sliceString(to, to + 1) === "\n") to++;
  if (to >= doc.length) {
    while (from > 0 && doc.sliceString(from - 1, from) === "\n") from--;
  }
  const anchor = Math.min(from, doc.length - (to - from));
  view.dispatch({
    changes: { from, to },
    selection: EditorSelection.cursor(Math.max(0, anchor)),
    userEvent: "delete.block",
    scrollIntoView: true,
  });
  return true;
}

/** How many blocks a column delete would take with it — the number the
 *  confirmation says out loud, because "delete column" hides the size. */
export function columnBlockCount(view: BlockEditor, target: ActionTarget): number {
  if (target.kind !== "col") return 1;
  const md = targetMarkdown(view, target);
  if (!md) return 0;
  return md.split(/\n\s*\n/).filter((b) => b.trim()).length;
}

/* ----------------------------------------------------------------- clipboard */

/** Markdown source, never rendered text: pasting it back has to reproduce the
 *  block exactly, pictures and math included. */
export function copyTarget(view: BlockEditor, target: ActionTarget): boolean {
  const md = targetMarkdown(view, target)?.trim();
  if (!md) return false;
  void writeText(md);
  return true;
}

export function cutTarget(view: BlockEditor, target: ActionTarget): boolean {
  return copyTarget(view, target) && deleteTarget(view, target);
}
