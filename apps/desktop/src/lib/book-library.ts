import { getPreference, setPreference } from "./preferences";

// The books added to a workspace (SPECs/book-reader-spec.md#library): every
// book dropped in or opened is recorded here, so search can find books — the
// workspace index is markdown-only. Kept in the app's preferences, per
// workspace, never in the vault. The book file stays the truth: an entry whose
// file is gone is dropped when it is picked.

export interface LibraryBook {
  /** The book file. */
  book: string;
  /** Its book page, when known. */
  note: string | null;
  /** What search matches and shows: the page's name (cleaned of site tags). */
  title: string;
  addedAt: number;
}

const key = (root: string) => `books.library:${root}`;

// Read-modify-write on one store: run edits one at a time so two quick drops
// can't drop each other's entry.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

export function listBooks(root: string): Promise<LibraryBook[]> {
  return getPreference<LibraryBook[]>(key(root), []);
}

/** Record `entry`, replacing an older entry for the same file; newest first. */
export function rememberBook(root: string, entry: Omit<LibraryBook, "addedAt">): Promise<void> {
  return serialize(async () => {
    const books = await listBooks(root);
    const rest = books.filter((b) => b.book !== entry.book);
    const previous = books.find((b) => b.book === entry.book);
    await setPreference(key(root), [
      { ...entry, note: entry.note ?? previous?.note ?? null, addedAt: Date.now() },
      ...rest,
    ]);
  });
}

export function forgetBook(root: string, book: string): Promise<void> {
  return serialize(async () => {
    const books = await listBooks(root);
    await setPreference(
      key(root),
      books.filter((b) => b.book !== book),
    );
  });
}
