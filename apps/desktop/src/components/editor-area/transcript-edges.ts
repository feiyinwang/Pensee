import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { hasTranscript } from "@/lib/video-transcript";

// A video note's transcript block (`<details>` … `</details>`, drawn as the
// transcript box) stays a block of its own (SPECs/youtube-notes-spec.md#transcript-box).
// Text typed against its edges would break it: before `<details>` on the same
// line the block is no longer recognised and its HTML shows; right under
// `</details>` other Markdown apps read the words as part of the HTML block.
// So typing never lands on its edges, and a note opened at its start puts the
// caret on the line under the box, where the caret is drawn.

interface Block {
  from: number;
  to: number;
}

const DETAILS_LINE = /^\s*<details(?:\s|>|$)/i;

/** The transcript block among the top-level blocks touching `from`…`to`. */
function transcriptTouching(state: EditorState, from: number, to: number, force = false) {
  // `ensureSyntaxTree` hands back the advanced tree; `syntaxTree(state)` only
  // the last committed one, empty right after a note swaps in (docs/editor.md).
  const tree = (force ? ensureSyntaxTree(state, state.doc.length, 50) : null) ?? syntaxTree(state);
  let found: Block | null = null;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === "Document") return undefined;
      if (
        !found &&
        node.name === "HTMLBlock" &&
        hasTranscript(state.doc.sliceString(node.from, Math.min(node.to, node.from + 200)))
      ) {
        found = { from: node.from, to: node.to };
      }
      return false;
    },
  });
  return found as Block | null;
}

const firstLine = (text: string) => text.slice(0, (text + "\n").indexOf("\n"));
const lastLine = (text: string) => text.slice(text.lastIndexOf("\n") + 1);
const blank = (text: string) => !/\S/.test(text);

/** How an insertion of `text` over `fromA`…`toA` is padded so it stays off
 *  the transcript's edges, or null when it doesn't touch one. */
function padding(state: EditorState, fromA: number, toA: number, text: string) {
  const line = state.doc.lineAt(fromA);
  const block = transcriptTouching(state, Math.max(0, line.from - 1), toA);
  if (!block) return null;
  // Before `<details>`: the words go on their own line above the box.
  if (toA === block.from && !blank(lastLine(text))) return { before: "", text, after: "\n\n" };
  // After `</details>` on its line: a blank line, then the words.
  if (fromA === block.to && !blank(text)) {
    return { before: "\n\n", text: text.replace(/^\n+/, ""), after: "" };
  }
  // On the empty line under the box: keep that line blank, the words below it.
  if (line.from === block.to + 1 && toA <= line.to && blank(line.text) && !blank(firstLine(text))) {
    return { before: "\n", text, after: "" };
  }
  return null;
}

const typingGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input") || tr.startState.selection.ranges.length > 1) {
    return tr;
  }
  const changes: { fromA: number; toA: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ fromA, toA, text: inserted.toString() });
  });
  if (changes.length !== 1) return tr;
  const { fromA, toA, text } = changes[0]!;
  const pad = padding(tr.startState, fromA, toA, text);
  if (!pad) return tr;
  // The caret keeps its place in the words (an auto-closed bracket leaves it
  // before the closing one).
  const stripped = text.length - pad.text.length;
  const inWords = Math.min(
    Math.max(tr.newSelection.main.head - fromA - stripped, 0),
    pad.text.length,
  );
  const caret = fromA + pad.before.length + inWords;
  return {
    changes: { from: fromA, to: toA, insert: pad.before + pad.text + pad.after },
    selection: EditorSelection.cursor(caret),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    annotations: [Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!)],
  } satisfies TransactionSpec;
});

/** Where a caret placed at the box's start goes: the line under it. */
const openingCaret = EditorState.transactionFilter.of((tr) => {
  // Clicks, arrow keys and edits place the caret themselves; only placements
  // made for the user (opening the note, entering from the title) move.
  if (!tr.selection || tr.isUserEvent("select") || tr.isUserEvent("input")) return tr;
  if (tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  const { main } = tr.newSelection;
  if (!main.empty || tr.newSelection.ranges.length > 1) return tr;
  const { doc } = tr.state;
  const line = doc.lineAt(main.head);
  if (main.head !== line.from || !DETAILS_LINE.test(line.text)) return tr;
  if (!hasTranscript(doc.sliceString(line.from, line.from + 200))) return tr;
  const block = transcriptTouching(tr.state, main.head, main.head, true);
  if (!block || block.from !== main.head) return tr;
  return [
    tr,
    // Sequential: the position is in the new doc, after a swap's change.
    { selection: EditorSelection.cursor(Math.min(block.to + 1, doc.length)), sequential: true },
  ];
});

export const transcriptEdges: Extension = [typingGuard, openingCaret];
