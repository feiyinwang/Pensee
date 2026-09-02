import { EditorSelection, type Extension, type StateCommand, Prec } from "@codemirror/state";
import { type KeyBinding, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `pos` looking for a syntax node with the given name.
 * Returns the node boundaries or null.
 */
function findEnclosingNode(
  state: import("@codemirror/state").EditorState,
  pos: number,
  name: string,
) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === name) return { from: node.from, to: node.to };
    if (!node.parent) break;
    node = node.parent;
  }
  return null;
}

/**
 * Build a toggle command for an inline wrapper (bold, italic, code, strikethrough).
 *
 * `marker` is the delimiter string (e.g. `**`), `nodeName` is the Lezer syntax
 * node to detect (e.g. `StrongEmphasis`).
 */
function inlineWrapCommand(marker: string, nodeName: string): StateCommand {
  const len = marker.length;

  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      // Check if the caret / selection lives inside an existing wrapper node.
      const existing = findEnclosingNode(state, range.from, nodeName);

      if (existing) {
        // Unwrap: remove closing marker, then opening marker.
        const innerFrom = existing.from + len;
        const innerTo = existing.to - len;
        const inner = state.doc.sliceString(innerFrom, innerTo);

        // Shift the selection to account for removed opening marker.
        const newFrom = Math.max(
          existing.from,
          Math.min(range.from - len, existing.from + inner.length),
        );
        const newTo = Math.max(
          existing.from,
          Math.min(range.to - len, existing.from + inner.length),
        );

        return {
          changes: [{ from: existing.from, to: existing.to, insert: inner }],
          range: EditorSelection.range(
            Math.max(existing.from, newFrom),
            Math.max(existing.from, newTo),
          ),
        };
      }

      // No existing node — wrap.
      if (range.from === range.to) {
        // Empty selection: try to wrap the word under the caret.
        const word = state.wordAt(range.from);
        if (word) {
          const text = state.doc.sliceString(word.from, word.to);
          return {
            changes: [{ from: word.from, to: word.to, insert: `${marker}${text}${marker}` }],
            range: EditorSelection.range(word.from + len, word.from + len + text.length),
          };
        }
        // No word — insert empty delimiters with caret between.
        return {
          changes: [{ from: range.from, insert: `${marker}${marker}` }],
          range: EditorSelection.cursor(range.from + len),
        };
      }

      // Non-empty selection: wrap it.
      const selected = state.doc.sliceString(range.from, range.to);
      return {
        changes: [{ from: range.from, to: range.to, insert: `${marker}${selected}${marker}` }],
        range: EditorSelection.range(range.from + len, range.from + len + selected.length),
      };
    });

    dispatch(state.update(changes, { userEvent: `input.format.${nodeName}` }));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Inline formatting commands
// ---------------------------------------------------------------------------

export const toggleBold: StateCommand = inlineWrapCommand("**", "StrongEmphasis");
export const toggleItalic: StateCommand = inlineWrapCommand("*", "Emphasis");
export const toggleInlineCode: StateCommand = inlineWrapCommand("`", "InlineCode");
export const toggleStrikethrough: StateCommand = inlineWrapCommand("~~", "Strikethrough");

// ---------------------------------------------------------------------------
// Link command
// ---------------------------------------------------------------------------

export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    // If caret is inside an existing Link node, no-op.
    if (findEnclosingNode(state, range.from, "Link")) {
      return { range };
    }

    if (range.from === range.to) {
      // Empty selection: insert [](url) with caret inside the url slot.
      const insert = "[](url)";
      return {
        changes: [{ from: range.from, insert }],
        range: EditorSelection.range(range.from + 3, range.from + 6),
      };
    }

    // Non-empty selection: wrap as [selection](url) with caret selecting "url".
    const selected = state.doc.sliceString(range.from, range.to);
    const insert = `[${selected}](url)`;
    const urlStart = range.from + 1 + selected.length + 2; // after `[selected](`
    return {
      changes: [{ from: range.from, to: range.to, insert }],
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });

  // If every range returned unchanged (all inside Link nodes), return false.
  if (changes.changes.empty) return false;

  dispatch(state.update(changes, { userEvent: "input.format.link" }));
  return true;
};

// ---------------------------------------------------------------------------
// Block-prefix helpers
// ---------------------------------------------------------------------------

/**
 * For every line touched by each selection range, apply `transform`.
 * `transform` receives the full line text and returns the replacement text.
 */
function lineCommand(
  transform: (line: string, lineIndex: number, allLines: string[]) => string,
  userEvent: string,
): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const fromLine = state.doc.lineAt(range.from);
      const toLine = state.doc.lineAt(range.to);

      // Collect all lines in the range.
      const lines: string[] = [];
      for (let i = fromLine.number; i <= toLine.number; i++) {
        lines.push(state.doc.line(i).text);
      }

      const transformed = lines.map((l, idx) => transform(l, idx, lines));

      const insert = transformed.join("\n");
      const newFrom = fromLine.from;
      const newTo = fromLine.from + insert.length;

      return {
        changes: [{ from: fromLine.from, to: toLine.to, insert }],
        range: EditorSelection.range(Math.min(newFrom, newFrom + insert.length), newTo),
      };
    });

    dispatch(state.update(changes, { userEvent }));
    return true;
  };
}

const HEADING_RE = /^(#{1,6})\s/;
const BULLET_RE = /^- /;
const NUMBERED_RE = /^\d+\.\s/;
const BLOCKQUOTE_RE = /^> /;
const TASK_RE = /^- \[[ x]\] /;

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

/**
 * The nine block shapes the editor can put a block into.
 *
 * Two callers, two different verbs, one implementation. The keyboard commands
 * below **toggle**: `Cmd+Shift+8` on a quoted line adds a bullet and leaves the
 * quote alone, because that is what a toggle means. The block handle menu
 * **converts**: its tiles are a radio group, so picking "Bulleted list" has to
 * clear whatever prefix was there first or the block ends up wearing two.
 * {@link setBlockType} is that second verb, kept here beside the first so the
 * prefixes can never be spelled two ways.
 */
export type BlockTypeId =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "numbered"
  | "bullet"
  | "task"
  | "code"
  | "quote";

const FENCE_RE = /^\s*```/;

/** Strip every block prefix this editor knows how to add. */
function clearBlockPrefix(line: string): string {
  return line
    .replace(HEADING_RE, "")
    .replace(TASK_RE, "")
    .replace(BULLET_RE, "")
    .replace(NUMBERED_RE, "")
    .replace(BLOCKQUOTE_RE, "");
}

/** Unwrap a fenced block. Anything else comes back untouched. */
function unfence(md: string): string {
  const lines = md.split("\n");
  if (lines.length >= 2 && FENCE_RE.test(lines[0] ?? "") && (lines.at(-1) ?? "").trim() === "```") {
    return lines.slice(1, -1).join("\n");
  }
  return md;
}

/** What shape is this block already in? `null` when it is none of the nine —
 *  an h4, a table, a picture — so the menu can show no tile as active rather
 *  than lying about it. */
export function blockTypeOf(md: string): BlockTypeId | null {
  const first = md.split("\n", 1)[0] ?? "";
  if (FENCE_RE.test(first)) return "code";
  const heading = HEADING_RE.exec(first);
  if (heading) {
    const level = heading[1]?.length ?? 0;
    return level <= 3 ? (`h${level}` as BlockTypeId) : null;
  }
  if (TASK_RE.test(first)) return "task";
  if (BULLET_RE.test(first)) return "bullet";
  if (NUMBERED_RE.test(first)) return "numbered";
  if (BLOCKQUOTE_RE.test(first)) return "quote";
  return "text";
}

/** Convert a whole block to `id`. Exclusive: the old prefix goes first. */
export function setBlockType(md: string, id: BlockTypeId): string {
  const body = unfence(md);
  // Code is the one type whose content is not prose — clearing "prefixes"
  // there would eat the first character of a shell command.
  if (id === "code") return "```\n" + body + "\n```";
  const lines = body.split("\n");

  // A heading is one line. Mapping the prefix over every line the way the list
  // shapes do turns one block into N headings, and a markdown paragraph is
  // every consecutive non-blank line — so "make this a heading" was stamping a
  // `#` onto the next line's content as well. Only the first line, the one the
  // grip is parked beside, becomes the heading; whatever follows is pushed off
  // as its own block, keeping the shape it already had.
  if (id === "h1" || id === "h2" || id === "h3") {
    const head = "#".repeat(Number(id.slice(1))) + " " + clearBlockPrefix(lines[0] ?? "");
    const rest = lines.slice(1).join("\n").trim();
    return rest ? `${head}\n\n${rest}` : head;
  }

  const cleared = lines.map(clearBlockPrefix);
  switch (id) {
    case "text":
      return cleared.join("\n");
    case "bullet":
      return cleared.map((l) => `- ${l}`).join("\n");
    case "numbered":
      return cleared.map((l, i) => `${i + 1}. ${l}`).join("\n");
    case "task":
      return cleared.map((l) => `- [ ] ${l}`).join("\n");
    case "quote":
      return cleared.map((l) => `> ${l}`).join("\n");
  }
}

// ---------------------------------------------------------------------------
// Heading commands
// ---------------------------------------------------------------------------

export function setHeading(level: number): StateCommand {
  const prefix = "#".repeat(level) + " ";
  return lineCommand((line) => {
    const match = HEADING_RE.exec(line);
    if (match) return prefix + line.slice(match[0].length);
    return prefix + line;
  }, `input.format.heading${level}`);
}

export const setParagraph: StateCommand = lineCommand(
  (line) => clearBlockPrefix(line),
  "input.format.paragraph",
);

// ---------------------------------------------------------------------------
// List / blockquote / task commands
// ---------------------------------------------------------------------------

export const toggleBulletList: StateCommand = lineCommand((line, _idx, allLines) => {
  const allHave = allLines.every((l) => BULLET_RE.test(l));
  if (allHave) return line.replace(BULLET_RE, "");
  if (BULLET_RE.test(line)) return line;
  return `- ${line}`;
}, "input.format.bulletList");

export const toggleNumberedList: StateCommand = lineCommand((line, idx, allLines) => {
  const allHave = allLines.every((l) => NUMBERED_RE.test(l));
  if (allHave) return line.replace(NUMBERED_RE, "");
  if (NUMBERED_RE.test(line)) return line;
  return `${idx + 1}. ${line}`;
}, "input.format.numberedList");

export const toggleBlockquote: StateCommand = lineCommand((line, _idx, allLines) => {
  const allHave = allLines.every((l) => BLOCKQUOTE_RE.test(l));
  if (allHave) return line.replace(BLOCKQUOTE_RE, "");
  if (BLOCKQUOTE_RE.test(line)) return line;
  return `> ${line}`;
}, "input.format.blockquote");

export const toggleTaskList: StateCommand = lineCommand((line, _idx, allLines) => {
  const allHave = allLines.every((l) => TASK_RE.test(l));
  if (allHave) return line.replace(TASK_RE, "");
  if (TASK_RE.test(line)) return line;
  return `- [ ] ${line}`;
}, "input.format.taskList");

// ---------------------------------------------------------------------------
// Clear inline formatting
// ---------------------------------------------------------------------------

export const clearInlineFormatting: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    if (range.from === range.to) return { range };
    let text = state.doc.sliceString(range.from, range.to);
    // Strip inline markers: **, *, ~~, `
    text = text.replace(/\*\*(.+?)\*\*/g, "$1");
    text = text.replace(/\*(.+?)\*/g, "$1");
    text = text.replace(/~~(.+?)~~/g, "$1");
    text = text.replace(/`(.+?)`/g, "$1");
    return {
      changes: [{ from: range.from, to: range.to, insert: text }],
      range: EditorSelection.range(range.from, range.from + text.length),
    };
  });
  if (changes.changes.empty) return false;
  dispatch(state.update(changes, { userEvent: "input.format.clearFormatting" }));
  return true;
};

// ---------------------------------------------------------------------------
// Fenced code block
// ---------------------------------------------------------------------------

export const toggleFencedCodeBlock: StateCommand = ({ state, dispatch }) => {
  const fromLine = state.doc.lineAt(state.selection.main.from);
  const toLine = state.doc.lineAt(state.selection.main.to);
  const text = state.doc.sliceString(fromLine.from, toLine.to);

  // Check if already in a code block (first line is ``` and last line is ```)
  const lines = text.split("\n");
  if (lines[0]?.trimEnd().startsWith("```") && lines[lines.length - 1]?.trimEnd() === "```") {
    // Unwrap: remove first and last lines
    const inner = lines.slice(1, -1).join("\n");
    dispatch(
      state.update({
        changes: { from: fromLine.from, to: toLine.to, insert: inner },
        userEvent: "input.format.codeBlock",
      }),
    );
    return true;
  }

  // Wrap in code fences
  const insert = "```\n" + text + "\n```";
  dispatch(
    state.update({
      changes: { from: fromLine.from, to: toLine.to, insert },
      userEvent: "input.format.codeBlock",
    }),
  );
  return true;
};

// ---------------------------------------------------------------------------
// Insert commands
// ---------------------------------------------------------------------------

export const insertTable: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const table = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |";
  // Place caret in first empty body cell (after the "| " on the third line)
  const caretOffset = table.lastIndexOf("|  |  |  |") + 2;
  dispatch(
    state.update({
      changes: { from: pos, insert: table },
      selection: { anchor: pos + caretOffset },
      userEvent: "input.format.table",
    }),
  );
  return true;
};

export const insertHorizontalRule: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  // If current line is non-empty, add a newline before the rule
  const prefix = line.text.trim() ? "\n" : "";
  const insert = prefix + "---\n";
  dispatch(
    state.update({
      changes: { from: pos, insert },
      userEvent: "input.format.horizontalRule",
    }),
  );
  return true;
};

export const insertToday: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  dispatch(
    state.update({
      changes: { from: pos, insert: date },
      userEvent: "input.format.today",
    }),
  );
  return true;
};

export const insertNow: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  dispatch(
    state.update({
      changes: { from: pos, insert: time },
      userEvent: "input.format.now",
    }),
  );
  return true;
};

// ---------------------------------------------------------------------------
// Registry and keymap
// ---------------------------------------------------------------------------

export const formattingCommands = {
  "format.bold": { run: toggleBold, chord: "Mod-b" },
  "format.italic": { run: toggleItalic, chord: "Mod-i" },
  "format.link": { run: insertLink, chord: "Mod-k" },
  "format.code": { run: toggleInlineCode, chord: "Mod-e" },
  "format.strikethrough": { run: toggleStrikethrough, chord: "Mod-Shift-x" },
  "format.bulletList": { run: toggleBulletList, chord: "Mod-Shift-8" },
  "format.numberedList": { run: toggleNumberedList, chord: "Mod-Shift-7" },
  "format.blockquote": { run: toggleBlockquote, chord: "Mod-Shift-." },
  "format.taskList": { run: toggleTaskList, chord: "Mod-Shift-Enter" },
  "format.heading1": { run: setHeading(1), chord: "Mod-Alt-1" },
  "format.heading2": { run: setHeading(2), chord: "Mod-Alt-2" },
  "format.heading3": { run: setHeading(3), chord: "Mod-Alt-3" },
  "format.heading4": { run: setHeading(4), chord: "Mod-Alt-4" },
  "format.heading5": { run: setHeading(5), chord: "Mod-Alt-5" },
  "format.heading6": { run: setHeading(6), chord: "Mod-Alt-6" },
  "format.paragraph": { run: setParagraph, chord: "Mod-Alt-0" },
} as const;

const formattingKeymap: KeyBinding[] = Object.values(formattingCommands).map((c) => ({
  key: c.chord,
  run: c.run,
}));

export const markdownFormatting: Extension = Prec.high(keymap.of(formattingKeymap));
