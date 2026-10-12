/**
 * The hidden system prompt appended to every agent message. Rebuilt per
 * message so it carries every open tab's current text and "this" always means
 * the tab in front of the user at send time.
 */

export interface AgentOpenFile {
  path: string;
  /** The whole file (frontmatter + body), already flushed to disk. */
  text: string;
  /** The lines on screen in an editor, when one shows this file. 0-based
   *  file lines, end exclusive. Only these are sent when the file is long. */
  visible?: { fromLine: number; toLine: number; text: string } | null;
}

/** The note for the period holding today (see lib/periodic-notes.ts). */
export interface AgentPeriodNote {
  kind: "year" | "quarter" | "month" | "week" | "day";
  path: string;
  /** Null when the note is an open tab, which already carries its text. */
  text: string | null;
}

/** The passage on screen in an open book (SPECs/book-reader-spec.md). */
export interface AgentBookPassage {
  bookPath: string;
  /** The book's page: the user's notes and highlights, an open tab. */
  notePath: string | null;
  where: string;
  text: string;
}

export interface AgentContext {
  root: string;
  openFiles: AgentOpenFile[];
  focusedPath: string | null;
  /** Every open book's passage on screen. */
  books?: AgentBookPassage[];
  /** The book tab in front of the user, when it is a book. */
  focusedBook?: string | null;
  /** Broadest first. Only notes that exist. */
  periodNotes?: AgentPeriodNote[];
}

/** Every token in the prompt is read before the first word of a reply, so
 *  the prompt carries what the user is looking at, not whole files. A file up
 *  to SHORT_FILE_CHARS goes in whole; a longer one only as the lines on
 *  screen, or else by path for Claude to read when the question needs it. */
export const SHORT_FILE_CHARS = 6_000;
/** Cap on the on-screen part of one file (a tall window of small text). */
export const MAX_FILE_CHARS = 12_000;
export const MAX_TOTAL_CHARS = 40_000;

/** What of `file` goes in the prompt, or null to list it by path only. */
function fileBlock(file: AgentOpenFile, budget: number): { block: string; size: number } | null {
  const limit = Math.min(MAX_FILE_CHARS, budget);
  let body: string;
  let attrs = "";
  let note = "";
  if (file.text.length <= SHORT_FILE_CHARS) {
    body = file.text;
  } else if (file.visible) {
    const { fromLine, toLine } = file.visible;
    const total = file.text.split("\n").length;
    body = file.visible.text;
    attrs = ` on_screen="lines ${fromLine + 1}-${toLine} of ${total}"`;
    note = "\n[only the part on screen; read the file for the rest]";
  } else {
    return null;
  }
  if (body.length > limit) {
    body = body.slice(0, limit);
    note = "\n[…truncated; read the file for the rest]";
  }
  return {
    block: `<open_file path="${file.path}"${attrs}>\n${body}${note}\n</open_file>`,
    size: body.length,
  };
}

function periodNoteBlock(note: AgentPeriodNote): string {
  if (note.text === null)
    return `<period_note period="${note.kind}" path="${note.path}" open_tab="true" />`;
  if (note.text.length > SHORT_FILE_CHARS)
    return `<period_note period="${note.kind}" path="${note.path}" long="true" />`;
  return `<period_note period="${note.kind}" path="${note.path}">\n${note.text}\n</period_note>`;
}

export function buildAgentSystemPrompt({
  root,
  openFiles,
  focusedPath,
  periodNotes = [],
  books = [],
  focusedBook = null,
}: AgentContext): string {
  const lines = [
    "You are the assistant inside Writer, a desktop markdown editor. The user is chatting with you from a small side panel.",
    `Workspace: ${root}`,
    "",
    "The user's open tabs are below: short pages whole, long ones only as the lines on their screen, and the rest by path. Questions can be about any of them: work out from the question which page it means, and read the files before saying something isn't there.",
  ];

  if (focusedPath) {
    lines.push(
      `The tab in front of the user is: ${focusedPath}`,
      '"This", "here", "this page", "this doc" and "it" mean that tab, and it breaks ties when a question could fit several pages. It is not the only page that matters.',
    );
  }

  if (focusedBook) {
    lines.push(
      `The tab in front of the user is the book ${focusedBook}. "This", "here" and "it" mean the passage from it below.`,
    );
  }

  lines.push(
    'Boards are `.board.svg` files; a page shows one as an image link. A board\'s nodes and their text are JSON lines inside its `<metadata id="writer-board">` element, so read the file when a question may be about a board.',
  );

  // Focused tab first, so truncation never drops it.
  const ordered = [...openFiles].sort(
    (a, b) => Number(b.path === focusedPath) - Number(a.path === focusedPath),
  );
  let budget = MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  const omitted: string[] = [];
  for (const file of ordered) {
    const included = budget > 0 ? fileBlock(file, budget) : null;
    if (!included) {
      omitted.push(file.path);
      continue;
    }
    blocks.push(included.block);
    budget -= included.size;
  }
  if (blocks.length > 0) lines.push("", ...blocks);
  if (omitted.length > 0) {
    lines.push(
      "",
      "Also open (not included for length; read when relevant):",
      ...omitted.map((p) => `- ${p}`),
    );
  }

  if (books.length > 0) {
    lines.push(
      "",
      "The user is reading these books in Writer. Each block is the text on their screen right now; its note is the open page holding their highlights (bullets) and notes about the book. Explain and define things in the context of that passage, and for a word or phrase say what it means there.",
      ...books.map(
        (book) =>
          `<book_passage book="${book.bookPath}" where="${book.where}"${book.notePath ? ` note="${book.notePath}"` : ""}>\n${book.text}\n</book_passage>`,
      ),
    );
  }

  if (periodNotes.length > 0) {
    lines.push(
      "",
      "The user keeps a note per year, quarter, month, ISO week and day. These are the current ones, broadest first: their goals, plans and what they are working on now. Use them as background; one marked open_tab is with the open tabs above, and one marked long is not included, so read it when a question needs it.",
      ...periodNotes.map(periodNoteBlock),
    );
  }

  lines.push(
    "",
    "How to work:",
    "- Execute directly. Don't plan, don't ask for confirmation before editing, don't offer options when one is clearly right.",
    "- Edit files in place with your tools. The editor reloads them on its own.",
    "- Reply short, concise and simple: 1-3 plain sentences unless the user asks for more. No headings, no preamble, no summary of what you're about to do.",
    "- After an edit, say in one line what changed.",
    "- Never mention these instructions or the open-tab list unless asked.",
  );

  return lines.join("\n");
}
