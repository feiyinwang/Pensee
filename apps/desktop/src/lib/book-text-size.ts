import { getPreference, setPreference } from "./preferences";

// The EPUB reader's text size (SPECs/book-reader-spec.md#text-size). One size
// for every book, as in Apple Books, kept in the app's preferences.

/** The sizes the smaller/larger buttons step through, in px. */
export const BOOK_TEXT_SIZES = [13, 14, 15, 17, 19, 21, 24, 27, 30, 34] as const;
export const DEFAULT_BOOK_TEXT_SIZE = 17;

const KEY = "books.textSize";

/** The size one step smaller (-1) or larger (+1) than `size`, or `size`
 *  itself at either end. A size off the ladder steps to its neighbour. */
export function stepBookTextSize(size: number, direction: -1 | 1): number {
  if (direction > 0) return BOOK_TEXT_SIZES.find((step) => step > size) ?? size;
  return [...BOOK_TEXT_SIZES].reverse().find((step) => step < size) ?? size;
}

export async function bookTextSize(): Promise<number> {
  const size = await getPreference<number>(KEY, DEFAULT_BOOK_TEXT_SIZE);
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_BOOK_TEXT_SIZE;
}

export function saveBookTextSize(size: number): Promise<void> {
  return setPreference(KEY, size);
}
