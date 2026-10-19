import { create } from "zustand";

import { type BookLocation, bookPlace } from "./book-highlights";

// The book readers open in this window (SPECs/book-reader-spec.md). A plain
// registry, not a store: nothing renders from it. The editor asks it to jump
// to a highlight, and the agent asks it for the passage on screen at send time,
// so scrolling a book never does work for either.

export interface BookPassage {
  bookPath: string;
  notePath: string | null;
  /** "page 42", or the chapter's title for an EPUB. */
  where: string;
  text: string;
}

export interface OpenReader {
  bookPath: string;
  notePath: string | null;
  /** The text on screen now; null before the book has loaded. */
  passage: () => Promise<BookPassage | null>;
  /** Scroll to block id `id`'s highlight and flash it. False when the id is
   *  not one of this book's highlights. */
  jump: (id: string) => boolean;
  /** A section's own name (an EPUB chapter's heading), or null. */
  sectionTitle: (section: number) => string | null;
}

const readers = new Set<OpenReader>();

/** Each open book's page, by book path — reactive, so the column strip can
 *  show a book and its page as one pair (SPECs/book-reader-spec.md). */
export const useBookPages = create<{ pages: Record<string, string> }>(() => ({ pages: {} }));
/** Jumps asked for before the book was open (Cmd+click on a highlight of a
 *  closed book), by book page. Taken by the reader as it registers. */
const pendingJumps = new Map<string, string>();

export function registerReader(reader: OpenReader): () => void {
  readers.add(reader);
  if (reader.notePath) {
    const notePath = reader.notePath;
    useBookPages.setState((s) => ({ pages: { ...s.pages, [reader.bookPath]: notePath } }));
  }
  const pending = reader.notePath ? pendingJumps.get(reader.notePath) : undefined;
  if (pending !== undefined) {
    pendingJumps.delete(reader.notePath!);
    reader.jump(pending);
  }
  return () => {
    readers.delete(reader);
    useBookPages.setState((s) => {
      const { [reader.bookPath]: _gone, ...pages } = s.pages;
      return { pages };
    });
  };
}

/** Jump to highlight `id` now if its book is open, else once it opens. */
export function requestJump(notePath: string, id: string): void {
  if (!jumpToHighlight(notePath, id)) pendingJumps.set(notePath, id);
}

/** Scroll the open book whose page is `notePath` to highlight `id`. False
 *  when no such book is open. */
export function jumpToHighlight(notePath: string, id: string): boolean {
  for (const reader of readers) {
    if (reader.notePath === notePath && reader.jump(id)) return true;
  }
  return false;
}

/** Where `location` is in the book of page `notePath`, in words: the
 *  chapter's heading while an EPUB is open, else "page 12" / "section 3". */
export function bookPlaceName(notePath: string, location: BookLocation): string {
  if (location.unit === "s") {
    for (const reader of readers) {
      if (reader.notePath !== notePath) continue;
      const title = reader.sectionTitle(location.section);
      if (title) return title;
    }
  }
  return bookPlace(location);
}

export function isBookOpenFor(notePath: string): boolean {
  for (const reader of readers) if (reader.notePath === notePath) return true;
  return false;
}

/** The passage on screen in every open book, for the agent. */
export async function openBookPassages(): Promise<BookPassage[]> {
  const passages = await Promise.all(
    [...readers].map((reader) =>
      reader.passage().catch((error) => {
        console.error(`[book] Couldn't read the passage of ${reader.bookPath}:`, error);
        return null;
      }),
    ),
  );
  return passages.filter((p): p is BookPassage => p !== null);
}
