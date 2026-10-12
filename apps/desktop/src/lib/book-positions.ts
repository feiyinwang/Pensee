import { getPreference, setPreference } from "./preferences";

// Where each book was left (SPECs/book-reader-spec.md): the section (PDF page
// or EPUB chapter) at the middle of the reader and how far into it, so the
// book reopens at the same place. In the app's preferences, by book file.

export interface ReadingPlace {
  unit: "p" | "s";
  section: number;
  /** 0–1 down the section. */
  fraction: number;
}

const key = (bookPath: string) => `books.place:${bookPath}`;

export function readingPlace(bookPath: string): Promise<ReadingPlace | null> {
  return getPreference<ReadingPlace | null>(key(bookPath), null);
}

export function saveReadingPlace(bookPath: string, place: ReadingPlace): Promise<void> {
  return setPreference(key(bookPath), place);
}
