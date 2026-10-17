import {
  EditorSelection,
  type ChangeSet,
  type EditorState,
  type Line,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { BLOCK_ID_AT_END_RE } from "@/lib/block-refs";
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
 *     And never fewer: CodeMirror's history joins a `delete.*` transaction to
 *     the edit before it when the two touch within 500ms, so a delete right
 *     after typing would undo the typing with it. Every delete here is
 *     {@link OWN_UNDO_STEP}.
 *  2. **The target, not the caret.** These never look at `state.selection`.
 *     The handle can be beside a block the caret has never visited. The one
 *     exception is a list item that sits inside a selection of several items:
 *     then the selection names the blocks ({@link selectedListItems}), and
 *     every list-item action except "Copy link to block" takes all of them.
 */

/** Keeps a transaction out of the history's grouping (see rule 1). */
const OWN_UNDO_STEP = isolateHistory.of("full");

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

/* ---------------------------------------------------------------- list items */

/**
 * Each list item is its own block under the grip, the way each line of a
 * paragraph is. A list is one markdown node, but to the reader every bullet is
 * a separate thought — pointing at item 2 and getting a menu that converts the
 * whole list was "the first line controls every bullet".
 *
 * An item's extent stops before its nested list: the children are items of
 * their own, with their own grip, and converting a parent must not drag them
 * along. Moving, deleting, cutting, copying and duplicating are the other way
 * round: the children belong to the item, so those take its whole subtree
 * ({@link ItemSpan}`.end`) — leaving them behind orphaned them under whatever
 * item was above.
 */
const LIST_NODES = new Set(["BulletList", "OrderedList"]);

function itemSpan(doc: Text, item: SyntaxNode): Span {
  for (let c = item.firstChild; c; c = c.nextSibling) {
    if (LIST_NODES.has(c.name)) {
      return { from: item.from, to: Math.max(item.from, doc.lineAt(c.from).from - 1) };
    }
  }
  return { from: item.from, to: item.to };
}

/** The innermost list item whose own lines include `pos`'s line. */
export function listItemAt(
  state: EditorState,
  pos: number,
): { from: number; to: number; name: "ListItem" } | null {
  const doc = state.doc;
  const line = doc.lineAt(Math.min(Math.max(pos, 0), doc.length));
  let hit: Span | undefined;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (n.name !== "ListItem") return;
      const span = itemSpan(doc, n.node);
      // Preorder: a nested item is entered after its parent, so it wins.
      if (span.from <= line.to && span.to >= line.from) hit = span;
    },
  });
  const found = hit as Span | undefined; // assigned in the callback; TS cannot see it
  return found ? { from: found.from, to: found.to, name: "ListItem" } : null;
}

/** Top-level block containing `pos` — the unit the gutter handle drags. */
export interface BlockRef {
  from: number;
  to: number;
  name: string;
}

/** For prose the unit under the grip is the LINE, not the markdown block.
 *
 *  A `Paragraph` is every consecutive non-blank line, so a single Enter leaves
 *  two independent thoughts inside one node. Pointing at the second line and
 *  getting the first is what made "make this a heading" head the line above
 *  the one under the pointer — the grip parks on `block.from`, so it visibly
 *  jumped up a line before the menu even opened.
 *
 *  A list narrows the same way, to the item under the pointer: every bullet
 *  is its own thought, and a grip that addressed the whole list let the first
 *  line's menu convert all of them (`listItemAt`).
 *
 *  A quote or a table is genuinely one thing across its lines, and a picture
 *  with words under it stays whole because the two are a single unit here —
 *  see the `lines` note in `place`. */
function proseLineAt(state: EditorState, block: BlockRef | null, pos: number): BlockRef | null {
  if (block && (block.name === "BulletList" || block.name === "OrderedList")) {
    return listItemAt(state, pos) ?? block;
  }
  if (!block || block.name !== "Paragraph") return block;
  const clamped = Math.min(Math.max(pos, block.from), block.to);
  const line = state.doc.lineAt(clamped);
  // Already a one-line paragraph: nothing to narrow, and returning the block
  // keeps the identity the drag and move code compares against.
  if (line.from <= block.from && line.to >= block.to) return block;
  if (IMAGE_BLOCK.test(state.doc.sliceString(block.from, block.to).trim())) return block;
  return { from: line.from, to: line.to, name: block.name };
}

/** The unit the grip hands out at `pos` — what a drag SOURCE must be
 *  re-resolved with, or a line or list item would be checked against its
 *  whole paragraph or list and the removal would take all of it. */
export function gripBlockAt(state: EditorState, pos: number): BlockRef | null {
  return proseLineAt(state, topBlockAt(state, pos), pos);
}

/** Blocks whose last line cannot carry a ` ^id` without changing what they
 *  are (a fence, a table row, a column row). */
const UNLINKABLE = new Set([
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "CommentBlock",
  "ColumnRow",
  "HorizontalRule",
]);

/** Whether a block of this kind can end with a ` ^id` (a linked block's or
 *  a video pin's). */
export function canCarryBlockId(name: string): boolean {
  return !UNLINKABLE.has(name);
}

/** The line a block's ` ^id` goes on: a list item or heading carries it on
 *  its own (first) line, a paragraph on its last, so the id covers every line
 *  of it — even when the grip or the caret narrowed the paragraph to one. */
export function blockIdLine(state: EditorState, block: BlockRef) {
  const { doc } = state;
  const firstLineOnly = block.name === "ListItem" || /Heading/.test(block.name);
  const to = block.name === "Paragraph" ? paragraphEnd(state, block.from, block.to) : block.to;
  const end = to > block.from ? to - 1 : to;
  return firstLineOnly ? doc.lineAt(block.from) : doc.lineAt(Math.max(block.from, end));
}

function paragraphEnd(state: EditorState, from: number, to: number): number {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Paragraph") return Math.max(to, node.to);
  }
  return to;
}

export function topBlockAt(state: EditorState, pos: number): BlockRef | null {
  const clamped = Math.min(Math.max(pos, 0), state.doc.length);
  const tree = syntaxTree(state);
  // Both sides matter. At a block's *end* boundary `resolveInner(pos, 1)` looks
  // forward and lands on the Document — so pointing past the end of a short
  // line (very easy to do: the line box spans the whole text column) would
  // report "no block here" and the drop would silently fall back to a gap.
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(clamped, side);
    while (node?.parent?.parent) node = node.parent;
    if (node?.parent) return { from: node.from, to: node.to, name: node.name };
  }
  return null; // genuinely a blank line
}

/** The `ListItem` node starting exactly at `from`. */
function listItemNode(state: EditorState, from: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  while (node && !(node.name === "ListItem" && node.from === from)) node = node.parent;
  return node;
}

/** `- `, `12. ` — the marker and the space after it. */
const ITEM_MARKER = /^(?:[-*+]|\d+[.)])[ \t]?/;
/** The same, plus an unticked box when the item has one: what a new sibling
 *  of a task item should start with. */
const NEW_ITEM_PREFIX = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

const LIST_TYPES = new Set<BlockTypeId>(["bullet", "numbered", "task"]);

type ListItemTarget = Extract<ActionTarget, { kind: "block" }> & { name: "ListItem" };

function isListItem(target: ActionTarget): target is ListItemTarget {
  return target.kind === "block" && target.name === "ListItem";
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
      annotations: OWN_UNDO_STEP,
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
    annotations: OWN_UNDO_STEP,
    scrollIntoView: true,
  });
  return true;
}

/* -------------------------------------------------------------- block shapes */

/** Which tile in the type grid is lit, if any. Across a selection of items,
 *  only the shape every one of them has — so the lit tile is always the one
 *  that clears them all. */
export function currentBlockType(view: BlockEditor, target: ActionTarget): BlockTypeId | null {
  const items = selectedListItems(view.state, target);
  if (items) {
    const [first, ...rest] = items.map((s) => itemType(view.state.doc, s));
    return rest.every((t) => t === first) ? (first ?? null) : null;
  }
  const md = targetMarkdown(view, target);
  return md == null ? null : blockTypeOf(md.trim());
}

/** Convert the target. Picking the shape it already has clears it back to
 *  plain text — a radio group you can switch off, the same as Notion. */
export function applyBlockType(view: BlockEditor, target: ActionTarget, id: BlockTypeId): boolean {
  const items = listItemsFor(view.state, target);
  if (items) return applyToItems(view, items, id);
  const md = targetMarkdown(view, target);
  if (md == null) return false;
  const current = blockTypeOf(md.trim());
  const nextId = current === id ? "text" : id;
  const next = setBlockType(md.trim(), nextId);
  if (next === md.trim()) return false;
  return writeTarget(view, target, next, `input.block.${id}`);
}

/* -------------------------------------------------------- list item shapes */

/** A list item's own lines ({@link itemSpan}) plus where its whole node ends,
 *  nested items included — what has to move sideways when its marker changes
 *  width. */
interface ItemSpan extends Span {
  end: number;
}

/**
 * The items a selection covers, when the grip's own item is one of them.
 *
 * Selecting seven bullets and picking "numbered" beside one of them used to
 * number that one: the selection is the reader saying which blocks they mean,
 * so the grid takes all of them. A grip outside the selection is pointing at
 * something else and converts only itself. Null for fewer than two items.
 */
function selectedListItems(state: EditorState, target: ActionTarget): ItemSpan[] | null {
  if (!isListItem(target)) return null;
  const { doc } = state;
  const sel = state.selection.main;
  if (sel.empty) return null;
  const first = doc.lineAt(sel.from);
  // Dragging down to the start of the next line selects nothing on it.
  const endsAtLineStart = sel.to > first.to && doc.lineAt(sel.to).from === sel.to;
  const last = doc.lineAt(endsAtLineStart ? sel.to - 1 : sel.to);
  if (target.from > last.to || target.to < first.from) return null;
  const items: ItemSpan[] = [];
  syntaxTree(state).iterate({
    from: first.from,
    to: last.to,
    enter: (n) => {
      if (n.name !== "ListItem") return;
      const span = itemSpan(doc, n.node);
      // A parent overlaps the range through its children; only its own lines count.
      if (span.from <= last.to && span.to >= first.from) items.push({ ...span, end: n.to });
    },
  });
  return items.length > 1 ? items : null;
}

/** Whether the grip's item is one of several selected items, so the menu's
 *  actions take all of them. */
export function followsSelection(view: BlockEditor, target: ActionTarget): boolean {
  return selectedListItems(view.state, target) != null;
}

function grippedItem(state: EditorState, target: ActionTarget): ItemSpan[] | null {
  if (!isListItem(target) || target.to > state.doc.length) return null;
  const end = listItemNode(state, target.from)?.to ?? target.to;
  return [{ from: target.from, to: target.to, end }];
}

/** The items the type grid converts: the selection's, or the one item. */
function listItemsFor(state: EditorState, target: ActionTarget): ItemSpan[] | null {
  return selectedListItems(state, target) ?? grippedItem(state, target);
}

/**
 * The items a structural action (move, insert, duplicate, cut, copy, delete)
 * works on, outermost only: a selected child is already inside its selected
 * parent's subtree, and taking it twice would copy or delete it twice.
 * `selected` says the set came from the selection, which decides whether the
 * selection survives the action or the caret goes to the one item.
 */
function itemScope(
  state: EditorState,
  target: ActionTarget,
): { items: ItemSpan[]; selected: boolean } | null {
  const selected = selectedListItems(state, target);
  const items = selected ?? grippedItem(state, target);
  if (!items) return null;
  const outer: ItemSpan[] = [];
  for (const item of items) {
    const parent = outer[outer.length - 1];
    if (!parent || item.from >= parent.end) outer.push(item);
  }
  return { items: outer, selected: selected != null };
}

/** An item's whole lines, children included: from its line start (its
 *  indentation) to the end of its subtree. */
function subtreeLines(doc: Text, item: ItemSpan): Span {
  return { from: doc.lineAt(item.from).from, to: item.end };
}

/** The markdown of several items in document order. Items of one list keep
 *  the gap between them (a loose list stays loose); items of two different
 *  lists get a blank line, or the copies would merge into one list. */
function itemsText(doc: Text, items: ItemSpan[]): string {
  let out = "";
  items.forEach((item, i) => {
    const { from, to } = subtreeLines(doc, item);
    if (i > 0) {
      const gap = doc.sliceString(items[i - 1]!.end, from);
      out += gap.trim() ? "\n\n" : gap;
    }
    out += doc.sliceString(from, to);
  });
  return out;
}

/** A copy must not carry its original's ` ^id`: two blocks with one id make
 *  every link and embed of it ambiguous. */
function withoutBlockIds(md: string): string {
  return md
    .split("\n")
    .map((line) => line.replace(BLOCK_ID_AT_END_RE, ""))
    .join("\n");
}

/* ---------------------------------------------------------- list numbering */

type Change = { from: number; to?: number; insert?: string };

/** One prefix rewrite on an item: `old` (at `item.from`) becomes `next`. */
interface PrefixEdit {
  item: ItemSpan;
  old: string;
  next: string;
}

/** Rewrite each prefix. When one changes width (`- ` → `1. `, `9.` → `10.`),
 *  every line under that item shifts by the difference: a child indented less
 *  than its parent's text is no longer its child and falls out as a sibling. */
function rewritePrefixes(doc: Text, edits: PrefixEdit[]): Change[] {
  const shift = new Map<number, number>(); // line number → columns to add
  const out: Change[] = [];
  for (const { item, old, next } of edits) {
    if (next === old) continue;
    out.push({ from: item.from, to: item.from + old.length, insert: next });
    const delta = next.length - old.length;
    if (!delta) continue;
    for (let n = doc.lineAt(item.from).number + 1; n <= doc.lineAt(item.end).number; n++) {
      shift.set(n, (shift.get(n) ?? 0) + delta);
    }
  }
  for (const [n, delta] of shift) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    if (delta > 0) {
      out.push({ from: line.from, insert: " ".repeat(delta) });
    } else {
      const cut = Math.min(-delta, /^ */.exec(line.text)![0].length);
      if (cut) out.push({ from: line.from, to: line.from + cut });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

const ITEM_NUMBER = /^\d+/;

/** Each ordered list `changes` touches, keyed by where it starts once they
 *  are applied, with the number it started at before. Deleting `1.` must
 *  leave the list starting at 1, not at the `2.` that is now first. */
function listStarts(state: EditorState, changes: ChangeSet): Map<number, number> {
  const starts = new Map<number, number>();
  const tree = syntaxTree(state);
  changes.iterChangedRanges((fromA, toA) => {
    tree.iterate({
      from: fromA,
      to: toA,
      enter: (n) => {
        if (n.name !== "OrderedList") return;
        const first = n.node.getChild("ListItem");
        const num = first && ITEM_NUMBER.exec(state.doc.sliceString(first.from, first.to));
        if (num) starts.set(changes.mapPos(n.from, -1), Number(num[0]));
      },
    });
  });
  return starts;
}

/** Number every ordered list that `changes` touched in sequence, from the
 *  number it started at. Positions are in `state`, the document after the
 *  changes. */
function renumberLists(
  state: EditorState,
  changes: ChangeSet,
  starts: Map<number, number>,
): Change[] {
  const { doc } = state;
  const edits: PrefixEdit[] = [];
  const seen = new Set<number>();
  changes.iterChangedRanges((_a, _b, fromB, toB) => {
    const tree = ensureSyntaxTree(state, toB, 50) ?? syntaxTree(state);
    tree.iterate({
      from: fromB,
      to: toB,
      enter: (n) => {
        if (n.name !== "OrderedList" || seen.has(n.from)) return;
        seen.add(n.from);
        let next = starts.get(n.from);
        for (let c = n.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== "ListItem") continue;
          const old = ITEM_NUMBER.exec(doc.sliceString(c.from, c.to))?.[0];
          if (!old) continue;
          next ??= Number(old);
          edits.push({ item: { ...itemSpan(doc, c), end: c.to }, old, next: String(next++) });
        }
      },
    });
  });
  return rewritePrefixes(doc, edits);
}

/**
 * Dispatch a list edit and renumber the lists it touched, as one transaction:
 * a duplicated `2.` makes the copy `3.` and pushes the rest down, a deleted
 * one closes the gap. `selection` is in the coordinates after `changes`
 * (before renumbering); without one the current selection is mapped.
 */
function dispatchListEdit(
  view: BlockEditor,
  changes: Change[],
  selection: EditorSelection | null,
  userEvent: string,
): void {
  const { state } = view;
  const set = state.changes(changes);
  const starts = listStarts(state, set);
  const after = state.update({ changes: set }).state;
  const numbers = after.changes(renumberLists(after, set, starts));
  view.dispatch({
    changes: set.compose(numbers),
    ...(selection && { selection: selection.map(numbers) }),
    userEvent,
    annotations: OWN_UNDO_STEP,
    scrollIntoView: true,
  });
}

function itemType(doc: Text, item: Span): BlockTypeId | null {
  return blockTypeOf(doc.sliceString(item.from, item.to).trim());
}

/** Convert every item in one dispatch. Clearing is all-or-nothing: only when
 *  every item already has the picked shape do they all go back to text. */
function applyToItems(view: BlockEditor, items: ItemSpan[], id: BlockTypeId): boolean {
  const { doc } = view.state;
  const nextId = items.every((s) => itemType(doc, s) === id) ? "text" : id;
  const out = !LIST_TYPES.has(nextId);
  const changes = out ? itemsOut(doc, items, nextId) : remarkItems(doc, items, nextId);
  if (!changes.length) return false;
  const one = items.length === 1 ? items[0] : undefined;
  view.dispatch({
    changes,
    // One item: the caret goes to it, as with any other block. Several: the
    // selection stays over them, so the next pick converts the same items.
    ...(one && {
      selection: EditorSelection.cursor(
        out ? changes[0]!.from + (changes[0]!.insert?.startsWith("\n") ? 1 : 0) : one.from,
      ),
      scrollIntoView: true,
    }),
    userEvent: `input.block.${id}`,
  });
  return true;
}

/** `- `, `1. `, `- [x] ` — the whole prefix a list item's text sits behind. */
const ITEM_PREFIX = /^(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]*/;

/**
 * List shape to list shape rewrites the marker and nothing else, so a wrapped
 * item's second line and its children stay where they are. Two things follow
 * from a marker changing:
 *
 *  - **Numbers run.** Each new number continues from the sibling above it —
 *    including a numbered item just above the selection — and starts at 1
 *    under a new parent or after a bullet.
 *  - **Children move with the marker.** `1. ` is wider than `- `, and a child
 *    indented less than its parent's text is no longer its child: it falls out
 *    as a sibling. Every line under a re-marked item shifts by the difference.
 */
function remarkItems(doc: Text, items: ItemSpan[], id: BlockTypeId): Change[] {
  const numbers = new Map<number, number>(); // line number → its new number
  const edits: PrefixEdit[] = [];
  for (const item of items) {
    const line = doc.lineAt(item.from);
    const old = ITEM_PREFIX.exec(doc.sliceString(item.from, line.to))?.[0] ?? "";
    let marker: string;
    if (id === "numbered") {
      const n = previousNumber(doc, line, item.from - line.from, numbers) + 1;
      numbers.set(line.number, n);
      marker = `${n}. `;
    } else if (id === "task") {
      const box = /\[([ xX])\]/.exec(old)?.[1];
      marker = `- [${box && box !== " " ? "x" : " "}] `;
    } else {
      marker = "- ";
    }
    edits.push({ item, old, next: marker });
  }
  return rewritePrefixes(doc, edits);
}

/** The number the item before this one (same depth, same list) ends up with,
 *  or 0 when there is none to continue from. */
function previousNumber(
  doc: Text,
  line: Line,
  indent: number,
  numbers: Map<number, number>,
): number {
  for (let n = line.number - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    const body = text.trimStart();
    if (!body) continue; // a loose list's blank line
    const at = text.length - body.length;
    if (at > indent) continue; // an earlier sibling's child, or its wrapped text
    if (at < indent) return 0; // the parent: this is its first child
    return numbers.get(n) ?? Number(/^(\d+)[.)][ \t]/.exec(body)?.[1] ?? 0);
  }
  return 0;
}

/** Items that stop being list items have to leave the list: written in place,
 *  a paragraph line between two items is read as a lazy continuation of the
 *  item above, and the item below folds into the paragraph. Blank lines split
 *  the list around them — but not between two items converted together, which
 *  stay one run of lines (one quote, consecutive headings). */
function itemsOut(
  doc: Text,
  items: ItemSpan[],
  id: BlockTypeId,
): { from: number; to: number; insert: string }[] {
  // From the line start: a nested item's indentation goes too, or the
  // paragraph would sit indented under nothing.
  const starts = new Set(items.map((s) => doc.lineAt(s.from).from));
  const ends = new Set(items.map((s) => s.to));
  return items.map(({ from: at, to }) => {
    const from = doc.lineAt(at).from;
    const md = setBlockType(doc.sliceString(at, to).trim(), id);
    const before = from > 0 && !ends.has(from - 1) && doc.lineAt(from - 1).text.trim() ? "\n" : "";
    const after =
      to < doc.length && !starts.has(to + 1) && doc.lineAt(to + 1).text.trim() ? "\n" : "";
    return { from, to, insert: `${before}${md}${after}` };
  });
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
  const doc = view.state.doc;
  const spans: Span[] = [];
  for (let n = syntaxTree(view.state).topNode.firstChild; n; n = n.nextSibling) {
    // A multi-line `Paragraph` is one node but several blocks to the reader,
    // and the gutter grip addresses each of its lines separately. This list is
    // deliberately the same unit the grip drags, so it has to split the same
    // way — otherwise "move up" vanishes from the menu for every line but the
    // first, because the target's offset matches no span here.
    const first = doc.lineAt(n.from);
    if (n.name === "Paragraph" && first.to < n.to) {
      for (let i = first.number; i <= doc.lineAt(n.to).number; i++) {
        const line = doc.line(i);
        spans.push({ from: line.from, to: line.to });
      }
      continue;
    }
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
  if (isListItem(target)) {
    const run = movableRun(view.state, target);
    return !!run && (dir < 0 ? run.lo > 0 : run.hi < run.siblings.length - 1);
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

  if (isListItem(target)) return moveListItem(view, target, dir);

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
  // Whatever separated them, not a hardcoded blank line: two lines of one
  // paragraph are `\n` apart, and rebuilding them `\n\n` apart would split the
  // paragraph as a side effect of reordering it.
  const gap = doc.sliceString(a.to, b.from);
  const insert = `${bText}${gap}${aText}`;
  const landing = dir < 0 ? a.from : a.from + bText.length + gap.length;
  view.dispatch({
    changes: { from: a.from, to: b.to, insert },
    selection: EditorSelection.cursor(landing),
    userEvent: "move.block",
    scrollIntoView: true,
  });
  return true;
}

/**
 * What "move" moves: the item, or the selected items as one run, among their
 * siblings only — never out to the paragraph next to the list, never into a
 * different depth. Each sibling span covers the whole item, nested children
 * included, so they travel with it. A selection whose outermost items are not
 * siblings of one list (it starts inside one item's children and ends below
 * it) has no single place to move to: null, and the menu hides Move.
 */
function movableRun(
  state: EditorState,
  target: ActionTarget,
): { siblings: Span[]; lo: number; hi: number; selected: boolean } | null {
  const scope = itemScope(state, target);
  if (!scope) return null;
  const list = listItemNode(state, scope.items[0]!.from)?.parent;
  if (!list) return null;
  const siblings: Span[] = [];
  for (let c = list.firstChild; c; c = c.nextSibling) {
    if (c.name === "ListItem") siblings.push({ from: c.from, to: c.to });
  }
  const lo = spanIndex(siblings, scope.items[0]!.from);
  const hi = spanIndex(siblings, scope.items[scope.items.length - 1]!.from);
  if (lo < 0 || hi < 0 || hi - lo + 1 !== scope.items.length) return null;
  return { siblings, lo, hi, selected: scope.selected };
}

/** Rotate the run past its neighbour, moving the bodies and leaving every
 *  marker in its slot: carrying `1.` and `2.` along with the text would number
 *  the list `2, 1`, which markdown renders as a list starting at 2. */
function moveListItem(view: BlockEditor, target: ActionTarget, dir: -1 | 1): boolean {
  const run = movableRun(view.state, target);
  if (!run) return false;
  const { siblings, lo, hi } = run;
  const a = dir < 0 ? lo - 1 : lo;
  const b = dir < 0 ? hi : hi + 1;
  if (a < 0 || b >= siblings.length) return false;
  const runIdx = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  const order = dir < 0 ? [...runIdx, lo - 1] : [hi + 1, ...runIdx];
  const doc = view.state.doc;
  const text = (s: Span) => doc.sliceString(s.from, s.to);
  const marker = (s: Span) => ITEM_MARKER.exec(text(s))?.[0] ?? "";
  const from = siblings[a]!.from;
  let insert = "";
  const slotStart: number[] = [];
  const slotEnd: number[] = [];
  for (let k = a; k <= b; k++) {
    const body = siblings[order[k - a]!]!;
    slotStart.push(from + insert.length);
    insert += marker(siblings[k]!) + text(body).slice(marker(body).length);
    slotEnd.push(from + insert.length);
    if (k < b) insert += doc.sliceString(siblings[k]!.to, siblings[k + 1]!.from);
  }
  // The run lands in the first slots going up, the last ones going down.
  const first = dir < 0 ? 0 : 1;
  const last = first + hi - lo;
  view.dispatch({
    changes: { from, to: siblings[b]!.to, insert },
    // One item: the caret goes with it. A selected run stays selected, so a
    // second "move" takes the same items further.
    selection: run.selected
      ? EditorSelection.single(slotStart[first]!, slotEnd[last]!)
      : EditorSelection.cursor(slotStart[first]!),
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
  const scope = itemScope(view.state, target);
  if (scope) {
    // A new sibling, not a blank line: `\n\n` inside a list makes it loose.
    // Above the first selected item or below the last one; below means after
    // its children, or they would end up under the new item.
    const item = where === "above" ? scope.items[0]! : scope.items[scope.items.length - 1]!;
    const doc = view.state.doc;
    const indent = doc.sliceString(doc.lineAt(item.from).from, item.from);
    const prefix = NEW_ITEM_PREFIX.exec(doc.sliceString(item.from, item.to))?.[0] ?? "- ";
    const marker = prefix.replace(/\[[xX]\]/, "[ ]");
    const insert = where === "above" ? `${marker}\n${indent}` : `\n${indent}${marker}`;
    const at = where === "above" ? item.from : item.end;
    // The marker is the neighbour's (`3. `); renumbering makes it the next one.
    dispatchListEdit(
      view,
      [{ from: at, insert }],
      EditorSelection.single(at + (where === "above" ? marker.length : insert.length)),
      `input.block.insert.${where}`,
    );
    view.focus?.();
    return true;
  }
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
  const scope = itemScope(view.state, target);
  if (scope) {
    // The copies go after the last item's children, as siblings, with their
    // own children: duplicating a parent copies what is under it. Several
    // items copy as one run below the run, the copies selected (the way a
    // file manager selects what it just duplicated).
    const doc = view.state.doc;
    const { items } = scope;
    const md = withoutBlockIds(itemsText(doc, items));
    const at = items[items.length - 1]!.end;
    const start = at + 1;
    const indent = doc.sliceString(doc.lineAt(items[0]!.from).from, items[0]!.from);
    dispatchListEdit(
      view,
      [{ from: at, insert: `\n${md}` }],
      scope.selected
        ? EditorSelection.single(start, start + md.length)
        : EditorSelection.single(start + indent.length),
      "input.block.duplicate",
    );
    return true;
  }

  const md = targetMarkdown(view, target)?.trim();
  if (!md) return false;
  const copy = withoutBlockIds(md);

  if (target.kind === "block") {
    view.dispatch({
      changes: { from: target.to, insert: `\n\n${copy}` },
      selection: EditorSelection.cursor(target.to + 2),
      userEvent: "input.block.duplicate",
      scrollIntoView: true,
    });
    return true;
  }

  if (target.kind === "band") {
    return writeTarget(view, target, `${md}\n\n${copy}`, "input.block.duplicate");
  }

  const ref = rowRefAt(view, target.rowFrom);
  const column = ref?.columns[target.index];
  if (!ref || !column) return false;
  const columns = ref.columns.slice();
  columns.splice(target.index + 1, 0, { ...column, md: withoutBlockIds(column.md) });
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
  const scope = itemScope(view.state, target);
  if (scope) {
    // Each item's lines, children and indentation included, and one newline —
    // eating the blank line after the last item would glue the paragraph
    // below onto the list. Items separated only by blank lines go as one
    // range, so a loose list does not leave its gaps behind.
    const ranges: Span[] = [];
    for (const item of scope.items) {
      const lines = subtreeLines(doc, item);
      const prev = ranges[ranges.length - 1];
      if (prev && !doc.sliceString(prev.to, lines.from).trim()) prev.to = lines.to;
      else ranges.push(lines);
    }
    const last = ranges[ranges.length - 1]!;
    if (last.to < doc.length) last.to++;
    else if (last.from > 0) last.from--;
    for (const r of ranges.slice(0, -1)) r.to++;
    const removed = ranges.reduce((n, r) => n + r.to - r.from, 0);
    dispatchListEdit(
      view,
      ranges,
      EditorSelection.single(Math.min(ranges[0]!.from, doc.length - removed)),
      "delete.block",
    );
    return true;
  }
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
    annotations: OWN_UNDO_STEP,
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
  const md = clipboardMarkdown(view, target);
  if (!md) return false;
  void writeText(md);
  return true;
}

/** What Copy and Cut put on the clipboard. List items come with their
 *  children, every selected item when the grip is in a selection, shifted
 *  left so the outermost one starts at column 0: a nested item pasted at the
 *  top of a note would otherwise land as an indented code block. */
export function clipboardMarkdown(view: BlockEditor, target: ActionTarget): string | null {
  const scope = itemScope(view.state, target);
  if (!scope) return targetMarkdown(view, target)?.trim() || null;
  const doc = view.state.doc;
  const lines = itemsText(doc, scope.items).split("\n");
  const indent = Math.min(...scope.items.map((s) => s.from - doc.lineAt(s.from).from));
  return lines
    .map((line) => line.slice(Math.min(indent, /^[ \t]*/.exec(line)![0].length)))
    .join("\n")
    .trimEnd();
}

export function cutTarget(view: BlockEditor, target: ActionTarget): boolean {
  return copyTarget(view, target) && deleteTarget(view, target);
}
