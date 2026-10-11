import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { blockIdsInText } from "./block-refs";
import { safePageName } from "./wiki-pages";
import type { AppleBook, AppleBookHighlight } from "@/types/apple-books";

// Apple Books highlights as pages, per SPECs/apple-books-highlights-spec.md.
// Each book is one page tagged `Book`; each highlight is a bullet carrying a
// hidden block id taken from Apple Books' own annotation id, so a sync only
// ever appends highlights the page does not have yet. Everything else on the
// page — the writer's own notes, edits to imported highlights, highlights
// moved elsewhere on the page — is left alone. Pure except `syncAppleBooks`,
// whose effects are injected.

export const BOOK_TAG = "Book";
export const HIGHLIGHTS_HEADING = "## Highlights";

const HIGHLIGHTS_HEADING_RE = /^##[ \t]+Highlights[ \t]*$/;

/** The block id a highlight is stored under: `bk-` and the first twelve hex
 *  digits of its Apple Books UUID. */
export function highlightBlockId(highlight: Pick<AppleBookHighlight, "id">): string {
  return `bk-${highlight.id
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 12)
    .toLowerCase()}`;
}

/** Page names a book can go by, best first: its full title, then the title
 *  before a subtitle (`Atomic Habits: An Easy…` → `Atomic Habits`). The last
 *  one is also the name a new page gets. */
export function bookPageNames(title: string): string[] {
  const full = safePageName(title);
  const short = safePageName(title.split(/[:：]| [-–—] /)[0] ?? "");
  return [...new Set([full, short].filter(Boolean))];
}

/** One line of running text: highlights span paragraphs, a bullet does not.
 *  A leading marker that would turn the bullet into something else (heading,
 *  quote, nested list) is escaped. */
function inlineText(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/^(#{1,6}|>|[-*+]|\d+[.)])(?=\s|$)/, "\\$1");
}

/** The markdown for one highlight: a bullet with its id, and its note (if
 *  any) as a child bullet. */
export function highlightMarkdown(highlight: AppleBookHighlight): string {
  const line = `- ${inlineText(highlight.text)} ^${highlightBlockId(highlight)}`;
  return highlight.note ? `${line}\n    - ${inlineText(highlight.note)}` : line;
}

/** `frontmatter` with `Book` in its `tags`. A missing `tags` key is added as a
 *  line at the end, so the rest stays byte-for-byte; an existing list (or
 *  Obsidian's space/comma-separated string) gets `Book` appended. Returns the
 *  input when the tag is already there or the YAML cannot be read safely. */
export function withBookTag(frontmatter: string | null): string | null {
  const tagLines = `tags:\n  - ${BOOK_TAG}`;
  if (frontmatter === null || !frontmatter.trim()) return tagLines;

  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) {
    console.error("[apple-books] Left unreadable frontmatter untagged");
    return frontmatter;
  }
  const tags = doc.get("tags", true);
  if (tags === undefined || (isScalar(tags) && (tags.value === null || tags.value === ""))) {
    if (tags === undefined) return `${frontmatter.replace(/\n+$/, "")}\n${tagLines}`;
    doc.set("tags", [BOOK_TAG]);
    return doc.toString().replace(/\n+$/, "");
  }

  const isBook = (value: unknown) =>
    String(value).replace(/^#/, "").toLowerCase() === BOOK_TAG.toLowerCase();
  if (isSeq(tags)) {
    if (tags.items.some((item) => isBook(isScalar(item) ? item.value : item))) return frontmatter;
    tags.add(doc.createNode(BOOK_TAG));
  } else if (isScalar(tags)) {
    const existing = String(tags.value)
      .split(/[\s,]+/)
      .filter(Boolean);
    if (existing.some(isBook)) return frontmatter;
    doc.set("tags", [...existing, BOOK_TAG]);
  } else {
    console.error("[apple-books] Left frontmatter with an unexpected `tags` shape untagged");
    return frontmatter;
  }
  return doc.toString().replace(/\n+$/, "");
}

/** `body` with `items` added at the end of its `## Highlights` section, or in
 *  a new such section at the end of the page when it has none. */
function appendToHighlights(body: string, items: string): string {
  const lines = body.split("\n");
  const heading = lines.findIndex((line) => HIGHLIGHTS_HEADING_RE.test(line));
  if (heading === -1) {
    const base = body.trimEnd();
    return `${base ? `${base}\n\n` : ""}${HIGHLIGHTS_HEADING}\n\n${items}\n`;
  }
  // The section runs to the next heading of the same or a higher level.
  let end = lines.findIndex((line, i) => i > heading && /^#{1,2}[ \t]/.test(line));
  if (end === -1) end = lines.length;
  let last = end;
  while (last > heading + 1 && lines[last - 1]!.trim() === "") last--;
  const before = lines.slice(0, last);
  const after = lines.slice(end);
  const gap = last === heading + 1 ? [""] : [];
  const tail = after.length ? ["", ...after] : [""];
  return [...before, ...gap, ...items.split("\n"), ...tail].join("\n");
}

export interface MergeResult {
  frontmatter: string | null;
  body: string;
  added: number;
}

/** A page with `book` merged in: tagged, and with every highlight it does not
 *  already carry (by block id, anywhere on the page) appended. */
export function mergeBook(
  page: { frontmatter: string | null; body: string },
  book: AppleBook,
): MergeResult {
  const frontmatter = withBookTag(page.frontmatter);
  const present = new Set(blockIdsInText(page.body));
  const fresh = book.highlights.filter((h) => !present.has(highlightBlockId(h)));
  if (!fresh.length) return { frontmatter, body: page.body, added: 0 };
  const items = fresh.map(highlightMarkdown).join("\n");
  return { frontmatter, body: appendToHighlights(page.body, items), added: fresh.length };
}

/** The whole text of a new page for `book`, named `name`. */
export function newBookPage(book: AppleBook, name: string): string {
  const author = book.author ? `\nauthor: ${JSON.stringify(book.author)}` : "";
  const items = book.highlights.map(highlightMarkdown).join("\n");
  return `---\ntags:\n  - ${BOOK_TAG}${author}\n---\n# ${name}\n\n${HIGHLIGHTS_HEADING}\n\n${items}\n`;
}

export interface AppleBooksSyncDeps {
  readHighlights: () => Promise<AppleBook[]>;
  /** The existing page called `name`, found the way a `[[name]]` click finds it. */
  findPage: (name: string) => Promise<string | null>;
  /** Where a new page called `name` goes. */
  newPagePath: (name: string) => string;
  /** Create `path` with `content`; fails if it exists. */
  createPage: (path: string, content: string) => Promise<void>;
  editPage: (
    path: string,
    edit: (page: { frontmatter: string | null; body: string }) => {
      frontmatter: string | null;
      body: string;
    },
  ) => Promise<void>;
  /** False once the workspace the sync started in is gone. */
  isCurrent: () => boolean;
}

export interface AppleBooksSyncResult {
  pagesCreated: number;
  highlightsAdded: number;
  failures: string[];
}

/** Bring every book's highlights into its page. One book failing does not
 *  stop the rest; failures come back by title for the caller to report. */
export async function syncAppleBooks(deps: AppleBooksSyncDeps): Promise<AppleBooksSyncResult> {
  const books = await deps.readHighlights();
  const result: AppleBooksSyncResult = { pagesCreated: 0, highlightsAdded: 0, failures: [] };
  for (const book of books) {
    if (!deps.isCurrent()) break;
    const names = bookPageNames(book.title);
    if (!names.length || !book.highlights.length) continue;
    try {
      let path: string | null = null;
      for (const name of names) {
        path = await deps.findPage(name);
        if (path) break;
      }
      if (!deps.isCurrent()) break;
      if (path) {
        let added = 0;
        await deps.editPage(path, (page) => {
          const merged = mergeBook(page, book);
          added = merged.added;
          return { frontmatter: merged.frontmatter, body: merged.body };
        });
        result.highlightsAdded += added;
      } else {
        const name = names[names.length - 1]!;
        await deps.createPage(deps.newPagePath(name), newBookPage(book, name));
        result.pagesCreated++;
        result.highlightsAdded += book.highlights.length;
      }
    } catch (error) {
      result.failures.push(
        `${book.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
