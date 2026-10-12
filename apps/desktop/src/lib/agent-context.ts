/**
 * The hidden system prompt appended to every agent message. Rebuilt per
 * message so it carries every open tab's current text and "this" always means
 * the tab in front of the user at send time.
 */

export interface AgentOpenFile {
  path: string;
  /** The text on screen (frontmatter + body), already flushed to disk. */
  text: string;
}

export interface AgentContext {
  root: string;
  openFiles: AgentOpenFile[];
  focusedPath: string | null;
}

/** Caps keep the prompt well under the OS argument limit (~1 MB) and the
 *  model's attention on the pages, not on one huge file. */
export const MAX_FILE_CHARS = 20_000;
export const MAX_TOTAL_CHARS = 120_000;

function fileBlock(file: AgentOpenFile, budget: number): string {
  const limit = Math.min(MAX_FILE_CHARS, budget);
  const truncated = file.text.length > limit;
  const text = truncated ? file.text.slice(0, limit) : file.text;
  const note = truncated ? "\n[…truncated; read the file for the rest]" : "";
  return `<open_file path="${file.path}">\n${text}${note}\n</open_file>`;
}

export function buildAgentSystemPrompt({ root, openFiles, focusedPath }: AgentContext): string {
  const lines = [
    "You are the assistant inside Writer, a desktop markdown editor. The user is chatting with you from a small side panel.",
    `Workspace: ${root}`,
    "",
    "Every tab the user has open is included below with its current text. Questions can be about any of them: work out from the question which page it means, and search all open pages before saying something isn't there.",
  ];

  if (focusedPath) {
    lines.push(
      `The tab in front of the user is: ${focusedPath}`,
      '"This", "here", "this page", "this doc" and "it" mean that tab, and it breaks ties when a question could fit several pages. It is not the only page that matters.',
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
    if (budget <= 0) {
      omitted.push(file.path);
      continue;
    }
    blocks.push(fileBlock(file, budget));
    budget -= Math.min(file.text.length, MAX_FILE_CHARS);
  }
  if (blocks.length > 0) lines.push("", ...blocks);
  if (omitted.length > 0) {
    lines.push(
      "",
      "Also open (not included for length; read when relevant):",
      ...omitted.map((p) => `- ${p}`),
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
