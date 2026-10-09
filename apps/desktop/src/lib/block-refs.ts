// Block references: a block in one page shown — and edited — in another.
//
// Storage is Obsidian's, so the files stay portable markdown: the source block
// ends with ` ^id` and the page that shows it holds `![[Page#^id]]`. Pure text
// functions only; the editor wiring lives in `block-embed.ts` and
// `linked-block-sync.ts`.

/** A block id at the end of a line: ` ^abc123`. Group 1 is the id. */
export const BLOCK_ID_AT_END_RE = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;

const BLOCK_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Six base-36 characters: 2 billion ids, short enough to read in source. */
export function newBlockId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 6; i++) id += BLOCK_ID_CHARS[Math.floor(random() * BLOCK_ID_CHARS.length)];
  return id;
}

export interface BlockEmbedTarget {
  /** The page part, as written (may be empty: `![[#^id]]` means this page). */
  page: string;
  id: string;
}

/** `Page#^id` → its parts; null for anything that is not a block reference. */
export function parseBlockEmbedTarget(inner: string): BlockEmbedTarget | null {
  const bar = inner.indexOf("|");
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const match = /^(.*)#\^([A-Za-z0-9-]+)$/.exec(target);
  if (!match) return null;
  return { page: match[1]!.trim(), id: match[2]! };
}

/** Lines that always begin a block of their own: a paragraph never extends
 *  up through one of these. */
const BLOCK_START_RE = /^\s*(?:[-*+][ \t]|\d+[.)][ \t]|#{1,6}[ \t]|>|```|~~~)/;

export interface BlockRange {
  /** Start of the block's first line. */
  from: number;
  /** End of the block's text, before the ` ^id`. */
  to: number;
  /** End of the id line (after the id). */
  end: number;
}

/**
 * Where block `id` sits in `text`. The block is the line carrying the id plus,
 * for a paragraph, the lines above it up to a blank line. A list item or a
 * heading is its own line: its id goes on that line, and the item's children
 * are blocks of their own.
 */
export function findBlock(text: string, id: string): BlockRange | null {
  const marker = new RegExp(`[ \\t]\\^${escapeRegExp(id)}[ \\t]*$`, "m");
  const match = marker.exec(text);
  if (!match) return null;
  const to = match.index;
  const end = match.index + match[0].length;

  let from = text.lastIndexOf("\n", to - 1) + 1;
  // Walk up through the paragraph: stop at a blank line, at a line that starts
  // its own block, or when this line itself starts one.
  while (from > 0 && !BLOCK_START_RE.test(lineAt(text, from))) {
    const prevFrom = text.lastIndexOf("\n", from - 2) + 1;
    const prev = text.slice(prevFrom, from - 1);
    if (!prev.trim() || /^\s*(?:#{1,6}[ \t]|```|~~~)/.test(prev)) break;
    from = prevFrom;
  }
  return { from, to, end };
}

/** The block's markdown without its ` ^id`, or null when the id is gone. */
export function blockText(text: string, id: string): string | null {
  const range = findBlock(text, id);
  return range ? text.slice(range.from, range.to) : null;
}

/** `text` with block `id`'s body replaced, its id kept; null when the id is
 *  gone. */
export function replaceBlock(text: string, id: string, body: string): string | null {
  const range = findBlock(text, id);
  if (!range) return null;
  return text.slice(0, range.from) + body + text.slice(range.to);
}

/** The id already on this line, if any. */
export function blockIdOnLine(line: string): string | null {
  return BLOCK_ID_AT_END_RE.exec(line)?.[1] ?? null;
}

/** The smallest single change turning `a` into `b`: shared prefix and suffix
 *  kept, so carets and decorations outside the edit stay put. */
export function minimalChange(
  a: string,
  b: string,
): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** The link text for a page: its stem at the workspace root, else its
 *  workspace-relative path — which `resolveWikiLink` reads directly, so a
 *  stem shared by two folders still finds the right page. */
export function blockLinkPage(filePath: string, workspaceRoot: string | null): string {
  const withoutExt = filePath.replace(/\.(?:md|markdown)$/i, "");
  const root = workspaceRoot?.replace(/\/$/, "");
  if (root && withoutExt.startsWith(`${root}/`)) return withoutExt.slice(root.length + 1);
  return withoutExt.slice(withoutExt.lastIndexOf("/") + 1);
}

/** Every block id defined in `text` (the ` ^id` line endings). */
export function blockIdsInText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/gm)) ids.add(match[1]!);
  return [...ids];
}

export interface TextReference {
  id: string;
  /** 1-based. */
  line: number;
  text: string;
}

/** References to any of `ids` in `text`: `[[...#^id]]` or `![[...#^id|...]]`.
 *  The same rule as the Rust scan (`find_block_references`), for open pages
 *  whose newest text is not on disk yet. */
export function referencesInText(text: string, ids: ReadonlySet<string>): TextReference[] {
  if (!text.includes("#^")) return [];
  const out: TextReference[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("#^") || !line.includes("[[")) continue;
    const seen = new Set<string>();
    for (const match of line.matchAll(/#\^([A-Za-z0-9-]+)(?=[\]|])/g)) {
      const id = match[1]!;
      if (!ids.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, line: i + 1, text: line.trim() });
    }
  }
  return out;
}

function lineAt(text: string, from: number): string {
  const nl = text.indexOf("\n", from);
  return text.slice(from, nl === -1 ? text.length : nl);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
