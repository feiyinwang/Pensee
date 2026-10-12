import { isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from "yaml";

import { blockIdsInText } from "./block-refs";
import { safePageName } from "./wiki-pages";
import { yamlLine } from "./yaml-entries";
import type { AppleBook, AppleBookHighlight } from "@/types/apple-books";

// Apple Books highlights as pages, per SPECs/apple-books-highlights-spec.md.
// Each book is one page marked `Type: Book`, with its cover and the `Book`
// tag; each highlight is a bullet carrying a hidden block id taken from Apple
// Books' own annotation id, so a sync only
// ever appends highlights the page does not have yet. Everything else on the
// page — the writer's own notes, edits to imported highlights, highlights
// moved elsewhere on the page — is left alone. Pure except `syncAppleBooks`,
// whose effects are injected.

export const BOOK_TAG = "Book";
export const BOOK_TYPE = "Book";
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

/** Page names a book can go by, best first: its full title, the title
 *  without bracketed asides (`Skip the Line (James Altucher)` → `Skip the
 *  Line`), then that before a subtitle (`Atomic Habits: An Easy…` → `Atomic
 *  Habits`). The last one is also the name a new page gets. */
export function bookPageNames(title: string): string[] {
  const full = safePageName(title);
  const unbracketed = title.replace(/\s*[([（][^()[\]（）]*[)\]）]/g, "");
  const bare = safePageName(unbracketed);
  const short = safePageName(unbracketed.split(/[:：]| [-–—] /)[0] ?? "");
  return [...new Set([full, bare, short].filter(Boolean))];
}

/** One line of running text: highlights span paragraphs, a bullet does not.
 *  A leading marker that would turn the bullet into something else (heading,
 *  quote, nested list) is escaped. */
export function inlineText(text: string): string {
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

/** A frontmatter value that says nothing: missing, null or blank. */
function isBlank(node: unknown): boolean {
  if (node === undefined || node === null) return true;
  return isScalar(node) && (node.value === null || String(node.value).trim() === "");
}

/** The pair whose key is `name`, ignoring case (`Type`, `type`). */
function findPair(map: YAMLMap, name: string): Pair | undefined {
  return map.items.find(
    (pair) => isScalar(pair.key) && String(pair.key.value).toLowerCase() === name,
  );
}

/** Whether `frontmatter` already has a cover, so none needs saving. */
export function hasCover(frontmatter: string | null): boolean {
  if (!frontmatter?.trim()) return false;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) return true; // Left alone anyway.
  return !isBlank(findPair(doc.contents, "cover")?.value);
}

/**
 * `frontmatter` marked as a book, the way the writer's own book pages are:
 * `Type: Book` (only when it has no type yet), `Cover: <cover>` (only when
 * `cover` is given and it has no cover yet — a link the writer chose is never
 * replaced), `Author: <author>` and `Book: <book>` (the same, for the book the
 * reader opens) and `Book` in its `tags` (an existing list, or Obsidian's
 * space/comma-separated string, gets it appended once). Keys are matched
 * ignoring case. Missing keys are added as lines — `Type`/`Cover` at the top,
 * `tags` at the end — so the rest stays byte-for-byte; filling a blank key or
 * extending a tag list re-serializes. Returns the input when nothing changes
 * or the YAML cannot be read safely.
 */
export function withBookProperties(
  frontmatter: string | null,
  {
    cover = null,
    book = null,
    author = null,
  }: { cover?: string | null; book?: string | null; author?: string | null } = {},
): string | null {
  const top: string[] = [];
  const typeLine = yamlLine("Type", BOOK_TYPE);
  const coverLine = cover ? yamlLine("Cover", cover) : null;
  const bookLine = book ? yamlLine("Book", book) : null;
  const authorLine = author ? yamlLine("Author", author) : null;
  const tagLines = `tags:\n  - ${BOOK_TAG}`;
  if (frontmatter === null || !frontmatter.trim()) {
    return [typeLine, coverLine, authorLine, bookLine, tagLines].filter(Boolean).join("\n");
  }

  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) {
    console.error("[apple-books] Left unreadable frontmatter unchanged");
    return frontmatter;
  }
  const map = doc.contents;
  let reserialize = false;

  const type = findPair(map, "type");
  if (!type) top.push(typeLine);
  else if (isBlank(type.value)) {
    type.value = doc.createNode(BOOK_TYPE);
    reserialize = true;
  }

  if (coverLine) {
    const existing = findPair(map, "cover");
    if (!existing) top.push(coverLine);
    else if (isBlank(existing.value)) {
      existing.value = doc.createNode(cover);
      reserialize = true;
    }
  }

  // The book's author and file, for the reader (SPECs/book-reader-spec.md).
  if (authorLine) {
    const existing = findPair(map, "author");
    if (!existing) top.push(authorLine);
    else if (isBlank(existing.value)) {
      existing.value = doc.createNode(author);
      reserialize = true;
    }
  }
  if (bookLine) {
    const existing = findPair(map, "book");
    if (!existing) top.push(bookLine);
    else if (isBlank(existing.value)) {
      existing.value = doc.createNode(book);
      reserialize = true;
    }
  }

  let bottom: string | null = null;
  const isBook = (value: unknown) =>
    String(value).replace(/^#/, "").toLowerCase() === BOOK_TAG.toLowerCase();
  const tagsPair = findPair(map, "tags");
  const tags = tagsPair?.value;
  if (!tagsPair) bottom = tagLines;
  else if (isBlank(tags)) {
    tagsPair.value = doc.createNode([BOOK_TAG]);
    reserialize = true;
  } else if (isSeq(tags)) {
    if (!tags.items.some((item) => isBook(isScalar(item) ? item.value : item))) {
      tags.add(doc.createNode(BOOK_TAG));
      reserialize = true;
    }
  } else if (isScalar(tags)) {
    const existing = String(tags.value)
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!existing.some(isBook)) {
      tagsPair.value = doc.createNode([...existing, BOOK_TAG]);
      reserialize = true;
    }
  } else {
    console.error("[apple-books] Left a `tags` value of an unexpected shape alone");
  }

  if (!reserialize && !top.length && !bottom) return frontmatter;
  const middle = (reserialize ? doc.toString() : frontmatter).replace(/\n+$/, "");
  return [...top, middle, bottom].filter((part) => part !== null).join("\n");
}

/** `body` with `items` added at the end of its `## Highlights` section, or in
 *  a new such section at the end of the page when it has none. */
export function appendToHighlights(body: string, items: string): string {
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

/** A page with `book` merged in: marked as a book (with `cover` when it has
 *  none), and with every highlight it does not already carry (by block id,
 *  anywhere on the page) appended. */
export function mergeBook(
  page: { frontmatter: string | null; body: string },
  book: AppleBook,
  cover: string | null = null,
): MergeResult {
  const frontmatter = withBookProperties(page.frontmatter, { cover });
  const present = new Set(blockIdsInText(page.body));
  const fresh = book.highlights.filter((h) => !present.has(highlightBlockId(h)));
  if (!fresh.length) return { frontmatter, body: page.body, added: 0 };
  const items = fresh.map(highlightMarkdown).join("\n");
  return { frontmatter, body: appendToHighlights(page.body, items), added: fresh.length };
}

/** The whole text of a new page for `book`, named `name`. */
export function newBookPage(book: AppleBook, name: string, cover: string | null = null): string {
  const lines = [
    yamlLine("Type", BOOK_TYPE),
    cover ? yamlLine("Cover", cover) : null,
    book.author ? yamlLine("Author", book.author) : null,
    `tags:\n  - ${BOOK_TAG}`,
  ].filter(Boolean);
  const items = book.highlights.map(highlightMarkdown).join("\n");
  return `---\n${lines.join("\n")}\n---\n# ${name}\n\n${HIGHLIGHTS_HEADING}\n\n${items}\n`;
}

export interface AppleBooksSyncDeps {
  readHighlights: () => Promise<AppleBook[]>;
  /** The existing page called `name`, found the way a `[[name]]` click finds it. */
  findPage: (name: string) => Promise<string | null>;
  /** Where a new page called `name` goes. */
  newPagePath: (name: string) => string;
  /** The page's frontmatter and body as they are now (open or on disk). */
  readPage: (path: string) => Promise<{ frontmatter: string | null; body: string }>;
  /** Save `book`'s cover for the page at `pagePath`; the `Cover` value that
   *  points at it, or null when Apple Books has no cover for the book. */
  saveCover: (book: AppleBook, pagePath: string) => Promise<string | null>;
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

/** A missing cover is not worth failing the book's highlights over: logged,
 *  and tried again on the next sync since the page still has no cover. */
async function coverFor(
  deps: AppleBooksSyncDeps,
  book: AppleBook,
  pagePath: string,
): Promise<string | null> {
  try {
    return await deps.saveCover(book, pagePath);
  } catch (error) {
    console.error(`[apple-books] Couldn't save the cover of ${book.title}:`, error);
    return null;
  }
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
        const current = await deps.readPage(path);
        const cover = hasCover(current.frontmatter) ? null : await coverFor(deps, book, path);
        let added = 0;
        await deps.editPage(path, (page) => {
          const merged = mergeBook(page, book, cover);
          added = merged.added;
          return { frontmatter: merged.frontmatter, body: merged.body };
        });
        result.highlightsAdded += added;
      } else {
        const name = names[names.length - 1]!;
        const newPath = deps.newPagePath(name);
        const cover = await coverFor(deps, book, newPath);
        await deps.createPage(newPath, newBookPage(book, name, cover));
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
