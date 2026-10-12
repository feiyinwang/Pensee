import { useEffect, useState } from "react";

import { listBooks, type LibraryBook } from "@/lib/book-library";

/** The workspace's books, read each time the palette opens (`root` set) —
 *  one small preferences read, never while it is closed. */
export function useBookLibrary(root: string | null): LibraryBook[] {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  useEffect(() => {
    if (!root) return;
    let current = true;
    void listBooks(root).then((list) => {
      if (current) setBooks(list);
    });
    return () => {
      current = false;
    };
  }, [root]);
  return books;
}
