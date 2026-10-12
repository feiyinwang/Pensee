import { getFileName } from "@/lib/paths";
import { definePageKind } from "./types";

/** `note`: the book page it was opened with, a hint only — the reader checks
 *  it still exists (SPECs/book-reader-spec.md). */
export type BookLocation = { kind: "book"; path: string; note?: string };

// A PDF or EPUB in the reader (SPECs/book-reader-spec.md). No primary path:
// `activeFilePath` stays markdown-only, so nothing that reads the active file
// as text ever reads a book. The view is registered in `./views`.
export const bookKind = definePageKind<"book", BookLocation>({
  kind: "book",
  title: (l) => getFileName(l.path),
  description: "Read a book",
  keepAlive: true,
  fromPayload: (data) =>
    typeof data.path === "string"
      ? {
          kind: "book",
          path: data.path,
          note: typeof data.note === "string" ? data.note : undefined,
        }
      : null,
  paths: (l) => [l.path],
  rewritePath: (l, from, to) => (l.path === from ? { ...l, path: to } : l),
  removePath: (l, path) => (l.path === path ? null : l),
  serialize: (l) => ({ path: l.path, ...(l.note ? { note: l.note } : {}) }),
});
