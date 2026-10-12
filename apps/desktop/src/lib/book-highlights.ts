import { isMap, isScalar, parseDocument } from "yaml";

import {
  HIGHLIGHTS_HEADING,
  appendToHighlights,
  inlineText,
  withBookProperties,
} from "./apple-books";
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
const TOP_ITEM_ID_RE = /^[-*+][ \t].*[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;

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

/** `body` with a bullet for the passage `text` at `location`, placed in
 *  reading order among the reader highlights of its `## Highlights` section
 *  (at the section's end when none comes after it). Unchanged when the
 *  highlight is already there. */
export function withBookHighlight(body: string, text: string, location: BookLocation): string {
  const id = bookHighlightId(location);
  if (blockIdsInText(body).includes(id)) return body;
  const item = `- ${inlineText(text)} ^${id}`;

  const lines = body.split("\n");
  const heading = lines.findIndex((line) => HIGHLIGHTS_HEADING_RE.test(line));
  if (heading !== -1) {
    for (let i = heading + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^#{1,2}[ \t]/.test(line)) break;
      const other = TOP_ITEM_ID_RE.exec(line)?.[1];
      const otherLocation = other ? parseBookHighlightId(other) : null;
      if (otherLocation && compareLocations(location, otherLocation) < 0) {
        lines.splice(i, 0, item);
        return lines.join("\n");
      }
    }
  }
  return appendToHighlights(body, item);
}

/** `body` without highlight `id`'s bullet and everything nested under it. */
export function withoutBookHighlight(body: string, id: string): string {
  const range = findBlock(body, id);
  if (!range) return body;
  const to = body[range.to] === "\n" ? range.to + 1 : range.to;
  return body.slice(0, range.from) + body.slice(to);
}

/** The `Book` frontmatter value: the book file, relative to the page. */
export function bookFileOf(frontmatter: string | null): string | null {
  if (!frontmatter?.trim()) return null;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const pair = doc.contents.items.find(
    (p) => isScalar(p.key) && String(p.key.value).toLowerCase() === "book",
  );
  const value = pair && isScalar(pair.value) ? pair.value.value : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The whole text of a new book page for the book file `bookFile`. */
export function newBookNote(name: string, bookFile: string): string {
  const frontmatter = withBookProperties(null, { book: bookFile });
  return `---\n${frontmatter}\n---\n# ${name}\n\n${HIGHLIGHTS_HEADING}\n\n`;
}
