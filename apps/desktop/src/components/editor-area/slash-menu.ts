/**
 * The `/` insert menu.
 *
 * Built on `@codemirror/autocomplete` rather than a hand-rolled panel: the
 * caret-anchored positioning, edge flipping, filtering and arrow-key state
 * machine all come for free, and `wiki-link-extension.ts` already establishes
 * the pattern in this codebase. A second hand-written keyboard layer next to
 * CodeMirror's is how you end up with "Enter sometimes inserts a newline".
 *
 * This module exports a completion *source*, not an `autocompletion()` config.
 * CodeMirror's `override` is winner-takes-all — whichever config supplies it
 * last silences every other source — so all of this editor's sources are
 * registered together in `wiki-link-extension.ts`.
 *
 * Two invariants:
 *  - Block-type entries go through `setBlockType`, the exact function the block
 *    handle's tile grid uses. `/h2` and the handle must produce identical
 *    markdown, or one of them is a bug.
 *  - Every entry commits in **one** dispatch — removing the `/query` and
 *    inserting the content together — so a single Cmd+Z undoes the whole thing.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { type BlockTypeId, setBlockType } from "./markdown-formatting";
import { serializeColumns } from "./columns-model";
import { emptyFence } from "./board/board-model";
import * as tauri from "@/lib/tauri";
import { getParentDir, getRelativePath } from "@/lib/paths";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import * as editorApi from "@/hooks/editor-api";
import "./slash-menu.css";

const svgNS = "http://www.w3.org/2000/svg";

interface SlashItem {
  id: string;
  label: string;
  aliases: string[];
  section: "Basics" | "Blocks" | "Insert";
  paths: string[];
  /** Given the range covering `/query`, perform exactly one dispatch. */
  run: (view: EditorView, from: number, to: number) => void;
}

/* --------------------------------------------------------------- actions */

/** Rewrites the whole line: strips the `/query` and applies the block prefix
 *  in the same transaction. */
function blockTypeRun(id: BlockTypeId) {
  return (view: EditorView, from: number, to: number): void => {
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const after = line.text.slice(to - line.from);
    const stripped = (before + after).trim();
    const next = setBlockType(stripped, id);
    // For a fence the caret belongs on the body line, not after the closing ```.
    const caret = line.from + (id === "code" ? next.indexOf("\n") + 1 : next.length);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: next },
      selection: { anchor: caret },
      userEvent: "input.slash",
    });
  };
}

/** Replaces `/query` with `text`. `caretOffset` is relative to the insertion. */
function insertRun(text: string | (() => string), caretOffset?: number) {
  return (view: EditorView, from: number, to: number): void => {
    const line = view.state.doc.lineAt(from);
    const resolved = typeof text === "function" ? text() : text;
    const queryOnLine = view.state.doc.sliceString(from, to);
    const alone = line.text.trim() === queryOnLine.trim();
    const isBlock = resolved.includes("\n");
    // Block payloads need their own line, unless the slash was already alone.
    const insert = isBlock && !alone ? `\n${resolved}` : resolved;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + (caretOffset ?? insert.length) },
      userEvent: "input.slash",
    });
  };
}

const TABLE = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |";

const COLUMNS = serializeColumns([
  { md: "", grow: 1 },
  { md: "", grow: 1 },
]);

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowStamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Opens the board that `/board` just inserted. The widget only exists after
 * CodeMirror's next measure cycle, so this retries a few frames rather than
 * assuming it is already there — and gives up quietly if it never appears.
 */
function openFreshBoard(view: EditorView, attempt = 0): void {
  const card = view.dom.querySelector(".wr-board-card.is-empty");
  if (card instanceof HTMLElement) {
    card.click();
    return;
  }
  if (attempt >= 6) return;
  requestAnimationFrame(() => openFreshBoard(view, attempt + 1));
}

/**
 * `/html`: pick an `.html` file and insert it as a `![[path]]` embed. The
 * native dialog is modal, so the document cannot move under us while it is
 * open; the `/query` is still removed first so a cancelled pick leaves the
 * line clean (the same as picking the item and typing nothing). The path is
 * workspace-relative when the file lives under the workspace, otherwise
 * relative to the note, which is what the embed resolver probes.
 */
function insertHtmlEmbed(view: EditorView, from: number, to: number): void {
  view.dispatch({ changes: { from, to }, userEvent: "input.slash" });
  void tauri
    .pickFile({ name: "HTML", extensions: ["html", "htm"] })
    .then((picked) => {
      if (!picked) return;
      const target = embedTargetFor(picked);
      const at = view.state.selection.main.head;
      const insert = `![[${target}]]`;
      view.dispatch({
        changes: { from: at, insert },
        selection: { anchor: at + insert.length },
        userEvent: "input.slash",
      });
      view.focus();
    })
    .catch((error) => {
      console.error("[editor] Failed to pick HTML file:", error);
    });
}

function embedTargetFor(absolutePath: string): string {
  const root = getWorkspaceRoot();
  const normalized = absolutePath.replace(/\\/g, "/");
  if (root) {
    const relative = getRelativePath(normalized, root);
    if (relative !== normalized) return relative;
  }
  const note = editorApi.getActiveFilePath();
  return note ? relativeTo(getParentDir(note), normalized) : normalized;
}

/** `to` expressed relative to directory `base` with `..` segments. */
function relativeTo(base: string, to: string): string {
  const baseParts = base.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  let shared = 0;
  while (
    shared < baseParts.length &&
    shared < toParts.length &&
    baseParts[shared] === toParts[shared]
  ) {
    shared++;
  }
  const ups = baseParts.slice(shared).map(() => "..");
  return [...ups, ...toParts.slice(shared)].join("/");
}

/* ----------------------------------------------------------------- icons */

const I: Record<string, string[]> = {
  text: ["M5 6h14", "M12 6v13", "M9 19h6"],
  h1: ["M5 5v14", "M13 5v14", "M5 12h8", "M17 9l2-1v11"],
  h2: ["M4 5v14", "M12 5v14", "M4 12h8", "M16 9a2 2 0 113.6 1.2L16 19h4"],
  h3: ["M4 5v14", "M12 5v14", "M4 12h8", "M16 8h4l-2.4 3.4A2.8 2.8 0 1116 17"],
  numbered: ["M4 7h1v4", "M4 17h2.4L4 20h2.6", "M10 7h10", "M10 12h10", "M10 17h10"],
  bullet: ["M5 7h.01", "M5 12h.01", "M5 17h.01", "M10 7h10", "M10 12h10", "M10 17h10"],
  task: ["M4 6.5h5v5H4z", "M5 9l1.2 1.2L8 8", "M13 9h7", "M4 15h5v4H4z", "M13 17h7"],
  code: ["M9 7l-5 5 5 5", "M15 7l5 5-5 5"],
  quote: ["M8 8H5v5h3c0 2-1 3-3 3", "M18 8h-3v5h3c0 2-1 3-3 3"],
  divider: ["M4 12h16"],
  link: [
    "M10.5 13.5a4 4 0 005.7 0l2.3-2.3a4 4 0 10-5.7-5.7L11.5 6.8",
    "M13.5 10.5a4 4 0 00-5.7 0L5.5 12.8a4 4 0 105.7 5.7l1.3-1.3",
  ],
  table: ["M4 5h16v14H4z", "M4 10h16", "M4 15h16", "M10 5v14", "M16 5v14"],
  board: ["M4 6h16v10H4z", "M9 16l-2 4", "M15 16l2 4", "M8 9.5h3.5", "M8 12.5h6"],
  mermaid: ["M5 5h5v4H5z", "M14 15h5v4h-5z", "M7.5 9v3.5h9V15"],
  columns: ["M4 5h6v14H4z", "M14 5h6v14h-6z"],
  today: ["M5 6h14v13H5z", "M5 10h14", "M9 4v4", "M15 4v4"],
  now: ["M20 12a8 8 0 11-16 0 8 8 0 0116 0z", "M12 8v4l2.5 2"],
  html: ["M4 5h16v14H4z", "M4 9h16", "M9 13l-2 2 2 2", "M15 13l2 2-2 2"],
};

/* ----------------------------------------------------------------- items */

const ITEMS: SlashItem[] = [
  {
    id: "text",
    label: "Text",
    aliases: ["paragraph", "body", "p"],
    section: "Basics",
    paths: I.text,
    run: blockTypeRun("text"),
  },
  {
    id: "h1",
    label: "Heading 1",
    aliases: ["h1", "title"],
    section: "Basics",
    paths: I.h1,
    run: blockTypeRun("h1"),
  },
  {
    id: "h2",
    label: "Heading 2",
    aliases: ["h2"],
    section: "Basics",
    paths: I.h2,
    run: blockTypeRun("h2"),
  },
  {
    id: "h3",
    label: "Heading 3",
    aliases: ["h3"],
    section: "Basics",
    paths: I.h3,
    run: blockTypeRun("h3"),
  },
  {
    id: "numbered",
    label: "Numbered list",
    aliases: ["ol", "list", "1."],
    section: "Basics",
    paths: I.numbered,
    run: blockTypeRun("numbered"),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    aliases: ["ul", "list", "-"],
    section: "Basics",
    paths: I.bullet,
    run: blockTypeRun("bullet"),
  },
  {
    id: "task",
    label: "To-do list",
    aliases: ["todo", "task", "checkbox"],
    section: "Basics",
    paths: I.task,
    run: blockTypeRun("task"),
  },
  {
    id: "code",
    label: "Code block",
    aliases: ["code", "fence"],
    section: "Basics",
    paths: I.code,
    run: blockTypeRun("code"),
  },
  {
    id: "quote",
    label: "Quote",
    aliases: ["blockquote", "cite"],
    section: "Basics",
    paths: I.quote,
    run: blockTypeRun("quote"),
  },
  {
    id: "divider",
    label: "Divider",
    aliases: ["hr", "rule"],
    section: "Basics",
    paths: I.divider,
    run: insertRun("---\n"),
  },
  {
    id: "link",
    label: "Link",
    aliases: ["url", "href"],
    section: "Basics",
    paths: I.link,
    run: insertRun("[]()", 1),
  },
  {
    id: "table",
    label: "Table",
    aliases: ["grid", "sheet"],
    section: "Blocks",
    paths: I.table,
    run: insertRun(TABLE, TABLE.lastIndexOf("|  |  |  |") + 2),
  },
  {
    id: "board",
    label: "Board",
    aliases: ["draw", "canvas", "whiteboard", "sketch"],
    section: "Blocks",
    paths: I.board,
    run: (view, from, to) => {
      insertRun(emptyFence() + "\n")(view, from, to);
      openFreshBoard(view);
    },
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    aliases: ["flowchart", "graph", "sequence"],
    section: "Blocks",
    paths: I.mermaid,
    run: insertRun("```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n"),
  },
  {
    id: "columns",
    label: "Columns",
    aliases: ["row", "split", "side by side"],
    section: "Blocks",
    paths: I.columns,
    run: insertRun(COLUMNS + "\n"),
  },
  {
    id: "html",
    label: "HTML file",
    aliases: ["html", "iframe", "embed", "web"],
    section: "Insert",
    paths: I.html,
    run: insertHtmlEmbed,
  },
  {
    id: "today",
    label: "Today",
    aliases: ["date"],
    section: "Insert",
    paths: I.today,
    run: insertRun(todayStamp),
  },
  {
    id: "now",
    label: "Now",
    aliases: ["time", "clock"],
    section: "Insert",
    paths: I.now,
    run: insertRun(nowStamp),
  },
];

const SECTIONS = {
  Basics: { name: "Basics", rank: 0 },
  Blocks: { name: "Blocks", rank: 1 },
  Insert: { name: "Insert", rank: 2 },
} as const;

const ICON_BY_TYPE = new Map(ITEMS.map((item) => [`slash-${item.id}`, item.paths]));

function iconNode(paths: string[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "wr-slash-icon";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  wrap.append(svg);
  return wrap;
}

/** Registered via `addToOptions`, which is the only supported hook for custom
 *  per-option content. Returns null for non-slash options (wiki links). */
export const slashOptionIcon = {
  position: 15,
  render: (completion: Completion): Node | null => {
    const paths = completion.type ? ICON_BY_TYPE.get(completion.type) : undefined;
    return paths ? iconNode(paths) : null;
  },
};

/* --------------------------------------------------------------- trigger */

const BLOCKED_NODES = new Set([
  "FencedCode",
  "CodeText",
  "CodeBlock",
  "CodeMark",
  "InlineCode",
  "Table",
  "TableRow",
  "TableCell",
  "TableDelimiter",
  "FrontMatter",
  "Frontmatter",
  "YAMLFrontMatter",
  "MathBlock",
  "InlineMath",
  "BlockMath",
  "HTMLBlock",
  "CommentBlock",
  "URL",
  "Link",
]);

function inBlockedContext(context: CompletionContext): boolean {
  const tree = syntaxTree(context.state);
  let node: { name: string; parent: unknown } | null = tree.resolveInner(context.pos, -1);
  while (node) {
    if (BLOCKED_NODES.has(node.name)) return true;
    node = node.parent as typeof node;
  }
  return false;
}

function matches(item: SlashItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (item.label.toLowerCase().startsWith(q)) return true;
  if (item.label.toLowerCase().includes(q)) return true;
  return item.aliases.some((a) => a.toLowerCase().startsWith(q));
}

function toCompletion(item: SlashItem): Completion {
  return {
    label: item.label,
    type: `slash-${item.id}`,
    section: SECTIONS[item.section],
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      item.run(view, from, to);
    },
  };
}

/**
 * The source. `/` only opens the menu at the start of a line or after
 * whitespace/an opening bracket — without that rule, `./notes/a.md`, `8/13` and
 * `http://` all pop the panel on every keystroke.
 */
export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|[\s([{])\/[^\s/]*/);
  if (!before) return null;

  const raw = context.state.doc.sliceString(before.from, before.to);
  const slashAt = before.from + raw.indexOf("/");
  const query = context.state.doc.sliceString(slashAt + 1, context.pos);
  if (/\s/.test(query)) return null;
  if (inBlockedContext(context)) return null;

  const options = ITEMS.filter((item) => matches(item, query)).map(toCompletion);
  // No match closes the panel rather than showing an empty box: most of the
  // time a stray `/` really is just a slash.
  if (!options.length) return null;

  return {
    from: slashAt,
    to: context.pos,
    options,
    // We already filtered (aliases are not part of `label`), so tell
    // CodeMirror to leave the list alone and re-query on every keystroke.
    filter: false,
  };
}
