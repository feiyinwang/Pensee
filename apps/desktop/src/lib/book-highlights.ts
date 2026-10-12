import { isMap, isScalar, parseDocument } from "yaml";

import { appendToHighlights, inlineText, withBookProperties } from "./apple-books";
import { blockIdsInText, findBlock } from "./block-refs";

// Book reader highlights, per SPECs/book-reader-spec.md. The book page is the
// one record: each highlight is a bullet whose hidden block id *is* its place
// in the book, so the reader draws highlights straight from the page and
// deleting the bullet deletes the highlight. Pure.

/** Where a highlight sits: a PDF page (`p`, 1-based) or an EPUB spine
 *  section (`s`, 0-based), and character offsets into that page's text. */
export interface BookLocation {
  unit: "p" | "s";
  section: number;
  start: number;
  end: number;
}

export interface BookHighlight {
  id: string;
  location: BookLocation;
}

const BOOK_ID_RE = /^bk-([ps])(\d+)-(\d+)-(\d+)$/;
const HIGHLIGHTS_HEADING_RE = /^##[ \t]+Highlights[ \t]*$/;
const TOP_ITEM_ID_RE = /^[-*+][ \t].*[ \t]\^([A-Za-z0-9-]+)[ \t]*$/gm;

export function bookHighlightId({ unit, section, start, end }: BookLocation): string {
  return `bk-${unit}${section}-${start}-${end}`;
}

/** The location a block id stands for, or null for any other id (Apple Books
 *  highlights included: `bk-` followed by hex). */
export function parseBookHighlightId(id: string): BookLocation | null {
  const match = BOOK_ID_RE.exec(id);
  if (!match) return null;
  const [, unit, section, start, end] = match;
  const location = {
    unit: unit as "p" | "s",
    section: Number(section),
    start: Number(start),
    end: Number(end),
  };
  return location.end > location.start ? location : null;
}

/** Reading order. */
export function compareLocations(a: BookLocation, b: BookLocation): number {
  return a.section - b.section || a.start - b.start || a.end - b.end;
}

/** Every reader highlight on the page, in reading order. */
export function bookHighlightsIn(body: string): BookHighlight[] {
  const highlights: BookHighlight[] = [];
  for (const id of blockIdsInText(body)) {
    const location = parseBookHighlightId(id);
    if (location) highlights.push({ id, location });
  }
  return highlights.sort((a, b) => compareLocations(a.location, b.location));
}

/** `body` with a bullet for the passage `text` at `location`, in reading
 *  order among the page's reader highlights: before the first one after it,
 *  else after the last one (and what is nested under it). With none yet, it
 *  goes at the end of a `## Highlights` section the writer made, or at the
 *  end of the page; no heading is ever added. Unchanged when the highlight is
 *  already there. */
export function withBookHighlight(body: string, text: string, location: BookLocation): string {
  const id = bookHighlightId(location);
  if (blockIdsInText(body).includes(id)) return body;
  const item = `- ${inlineText(text)} ^${id}`;

  let after: number | null = null;
  for (const match of body.matchAll(TOP_ITEM_ID_RE)) {
    const other = parseBookHighlightId(match[1]!);
    if (!other) continue;
    if (compareLocations(location, other) < 0) {
      return `${body.slice(0, match.index)}${item}\n${body.slice(match.index)}`;
    }
    after = findBlock(body, match[1]!)?.to ?? after;
  }
  if (after !== null) return `${body.slice(0, after)}\n${item}${body.slice(after)}`;
  if (body.split("\n").some((line) => HIGHLIGHTS_HEADING_RE.test(line))) {
    return appendToHighlights(body, item);
  }
  const base = body.trimEnd();
  return `${base ? `${base}\n\n` : ""}${item}\n`;
}

/** `body` without highlight `id`'s bullet and everything nested under it. */
export function withoutBookHighlight(body: string, id: string): string {
  const range = findBlock(body, id);
  if (!range) return body;
  const to = body[range.to] === "\n" ? range.to + 1 : range.to;
  return body.slice(0, range.from) + body.slice(to);
}

/** Download-site tags in a book's file name ("(z-library.sk, 1lib.sk,
 *  z-lib.sk)"), whole bracketed groups or bare domains. */
const SITE_GROUP_RE = /\s*[([][^()[\]]*\b(?:z-?library|z-?lib|1lib)\b[^()[\]]*[)\]]/gi;
const SITE_DOMAIN_RE = /\s*\b(?:z-?library|z-?lib|1lib)\.[a-z]{2,}\b[,;]?/gi;

/** A book's title from its file name, without download-site tags. */
export function cleanBookTitle(stem: string): string {
  return stem.replace(SITE_GROUP_RE, "").replace(SITE_DOMAIN_RE, "").replace(/\s+/g, " ").trim();
}

/** A text property of the page (key matched ignoring case), or null. */
function pageProperty(frontmatter: string | null, name: string): string | null {
  if (!frontmatter?.trim()) return null;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const pair = doc.contents.items.find(
    (p) => isScalar(p.key) && String(p.key.value).toLowerCase() === name,
  );
  const value = pair && isScalar(pair.value) ? pair.value.value : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The `Book` frontmatter value: the book file, relative to the page. */
export function bookFileOf(frontmatter: string | null): string | null {
  return pageProperty(frontmatter, "book");
}

/** The page's `Cover`: a path relative to the page, or a web address. */
export function coverOf(frontmatter: string | null): string | null {
  return pageProperty(frontmatter, "cover");
}

/** The page's `Author`. */
export function authorOf(frontmatter: string | null): string | null {
  return pageProperty(frontmatter, "author");
}

/** The author in a download's file name, the first bracketed group after the
 *  title once site tags are gone (`Skip the Line (James Altucher James
 *  Altucher )` → `James Altucher`). A name the site wrote twice is kept once.
 *  Null when there is no group or it is a year or edition. */
export function authorFromFileName(stem: string): string | null {
  const group = /\(([^()]+)\)/.exec(cleanBookTitle(stem))?.[1]?.trim();
  if (!group || /^\d|\bed(ition)?\b/i.test(group)) return null;
  const words = group.split(/\s+/);
  const half = words.length / 2;
  if (Number.isInteger(half) && words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
    return words.slice(0, half).join(" ");
  }
  return group;
}

function nameTokens(author: string): Set<string> {
  return new Set(
    author
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

/** Whether two author values name the same people, whatever the order or
 *  punctuation (`Altucher, James` = `James Altucher`); one listing a subset of
 *  the other's names (a co-author left off) still counts. */
export function sameAuthor(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.size || !y.size) return false;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((token) => large.has(token));
}

/** The whole text of a new book page for the book file `bookFile`: only its
 *  properties. Headings are the writer's to add. */
export function newBookNote(bookFile: string, author: string | null = null): string {
  return `---\n${withBookProperties(null, { book: bookFile, author })}\n---\n`;
}
