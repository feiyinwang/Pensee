import { titleHash } from "./spaces";
import type { TypedNote } from "./tauri";

// The shape of a book in the Books stack (SPECs/book-stack-spec.md): how thick
// it is and how long its spine runs. Both come from the note, so a book keeps
// its shape wherever it sits in the list.

export const MIN_THICKNESS = 34;
export const MAX_THICKNESS = 64;
const LENGTHS = [560, 576, 592, 608, 624];

/** `Pages:` as a number ("320", "320 pages"), or null when absent or not one. */
export function pageCount(note: TypedNote): number | null {
  const pages = Number.parseInt(note.properties.pages ?? "", 10);
  return Number.isFinite(pages) && pages > 0 ? pages : null;
}

/** Spine height in px: from the page count, else picked by the title hash so
 *  books without one still differ. */
export function bookThickness(note: TypedNote, title: string): number {
  const pages = pageCount(note);
  const raw = pages === null ? 40 + (titleHash(title) % 14) : 24 + pages / 16;
  return Math.round(Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, raw)));
}

/** Spine length in px (the book's height), picked by the title hash. */
export function bookLength(title: string): number {
  return LENGTHS[(titleHash(title) >>> 8) % LENGTHS.length]!;
}
