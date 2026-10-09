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
  /** End of the block's last line (children included for a list item). */
  to: number;
  /** The ` ^id` marker, which sits inside [from, to). */
  idFrom: number;
  idTo: number;
  /** The id ends the block's first line (a list item with children), not
   *  its last. */
  idOnFirstLine: boolean;
}

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])(?:[ \t]|$)/;

function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * Where block `id` sits in `text`.
 *
 * - **A list item** is its line plus everything nested under it: the
 *   following lines indented deeper than its marker, blank lines between them
 *   included. Its id ends its first line, so the whole subtree is one block —
 *   copying a bullet copies what hangs under it, as in RemNote.
 * - **A paragraph** is the id line plus the lines above it, up to a blank line
 *   or a line that starts a block of its own.
 * - **A heading** is its own line.
 */
export function findBlock(text: string, id: string): BlockRange | null {
  const marker = new RegExp(`[ \\t]\\^${escapeRegExp(id)}[ \\t]*$`, "m");
  const match = marker.exec(text);
  if (!match) return null;
  const idFrom = match.index;
  const idTo = match.index + match[0].length;
  let from = text.lastIndexOf("\n", idFrom - 1) + 1;
  const idLine = text.slice(from, idTo);

  const item = LIST_ITEM_RE.exec(idLine);
  if (item) {
    const own = indentOf(idLine);
    let to = idTo;
    let at = idTo;
    while (at < text.length) {
      const next = at + 1;
      const nl = text.indexOf("\n", next);
      const lineEnd = nl === -1 ? text.length : nl;
      const line = text.slice(next, lineEnd);
      if (line.trim()) {
        if (indentOf(line) <= own) break;
        to = lineEnd;
      }
      at = lineEnd;
      if (nl === -1) break;
    }
    return { from, to, idFrom, idTo, idOnFirstLine: to > idTo };
  }

  // Walk up through the paragraph: stop at a blank line, at a line that starts
  // its own block, or when this line itself starts one.
  while (from > 0 && !BLOCK_START_RE.test(lineAt(text, from))) {
    const prevFrom = text.lastIndexOf("\n", from - 2) + 1;
    const prev = text.slice(prevFrom, from - 1);
    if (!prev.trim() || /^\s*(?:#{1,6}[ \t]|```|~~~)/.test(prev)) break;
    from = prevFrom;
  }
  return { from, to: idTo, idFrom, idTo, idOnFirstLine: false };
}

/** The block's markdown without its ` ^id`. */
export function bodyOf(text: string, range: BlockRange): string {
  return text.slice(range.from, range.idFrom) + text.slice(range.idTo, range.to);
}

/** `body` with the id `marker` put back where such a block keeps it: a list
 *  item at the end of its first line (its children follow), anything else at
 *  the end. Decided by the new body, so a bullet that just gained a child
 *  keeps its id on the bullet. */
export function withIdMarker(body: string, marker: string): string {
  const nl = body.indexOf("\n");
  if (nl === -1 || !LIST_ITEM_RE.test(body.slice(0, nl))) return body + marker;
  return body.slice(0, nl) + marker + body.slice(nl);
}

/** The block's markdown without its ` ^id`, or null when the id is gone. */
export function blockText(text: string, id: string): string | null {
  const range = findBlock(text, id);
  return range ? bodyOf(text, range) : null;
}

/** `text` with block `id`'s body replaced, its id kept; null when the id is
 *  gone. */
export function replaceBlock(text: string, id: string, body: string): string | null {
  const range = findBlock(text, id);
  if (!range) return null;
  const marker = text.slice(range.idFrom, range.idTo);
  return text.slice(0, range.from) + withIdMarker(body, marker) + text.slice(range.to);
}

/** Whether `body` written back as block `id` is still exactly one block —
 *  nothing it holds would fall outside the block once its id is in place. */
export function bodyStaysOneBlock(body: string, id: string): boolean {
  const text = withIdMarker(body, ` ^${id}`);
  const range = findBlock(text, id);
  return !!range && range.from === 0 && range.to === text.length && bodyOf(text, range) === body;
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

/** The clipboard holds exactly one block reference (`[[Page#^id]]` or
 *  `![[Page#^id]]`, as Copy reference writes it): the embed form of it, else
 *  null. */
export function referenceFromClipboard(text: string): string | null {
  const match = /^!?\[\[([^\]\n]+)\]\]$/.exec(text.trim());
  if (!match || !parseBlockEmbedTarget(match[1]!)) return null;
  return `![[${match[1]}]]`;
}

/** How Paste as reference puts `embed` next to the caret's line: in place of
 *  a blank line, as a new sibling item under a list item, else as its own
 *  paragraph below the line. */
export function referenceInsertion(
  line: string,
  embed: string,
): { replaceLine: boolean; text: string } {
  if (!line.trim()) return { replaceLine: true, text: embed };
  const item = /^(\s*)(?:([-*+])|(\d+)([.)]))[ \t]+/.exec(line);
  if (item) {
    const marker = item[2] ?? `${Number(item[3]) + 1}${item[4]}`;
    return { replaceLine: false, text: `\n${item[1]}${marker} ${embed}` };
  }
  return { replaceLine: false, text: `\n\n${embed}` };
}

function lineAt(text: string, from: number): string {
  const nl = text.indexOf("\n", from);
  return text.slice(from, nl === -1 ? text.length : nl);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
