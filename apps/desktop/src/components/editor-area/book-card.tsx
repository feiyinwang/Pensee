import { useMemo } from "react";
import { BookOpen, PanelRight } from "lucide-react";

import { bookFileOf } from "@/lib/book-highlights";
import { getFileExtension, getFileStem, getParentDir } from "@/lib/paths";
import { useEditorStore } from "@/stores/editor-store";
import "./book-card.css";

/**
 * On a book page whose book is not open, a card under the properties opens it
 * in a column beside the page (SPECs/book-reader-spec.md). Hidden while the
 * book is open, so it only ever offers what isn't already on screen.
 */
export function BookCard({ filePath }: { filePath: string }) {
  const frontmatter = useEditorStore((s) => s.openFiles.get(filePath)?.frontmatter ?? null);
  // Most pages are not books: skip the YAML parse unless a `book` key is there.
  const bookFile = useMemo(
    () => (frontmatter && /^book\s*:/im.test(frontmatter) ? bookFileOf(frontmatter) : null),
    [frontmatter],
  );
  const bookPath = bookFile ? `${getParentDir(filePath)}/${bookFile}` : null;
  const isOpen = useEditorStore((s) =>
    bookPath
      ? s.tabs.some((tab) => tab.location.kind === "book" && tab.location.path === bookPath)
      : false,
  );
  if (!bookPath || isOpen) return null;

  return (
    <button
      type="button"
      className="book-card"
      aria-label={`Open ${bookFile} beside this page`}
      onClick={() =>
        void import("@/lib/book-import").then(({ openBookOfPage }) => openBookOfPage(filePath))
      }
    >
      <BookOpen className="book-card-icon" size={16} aria-hidden />
      <span className="book-card-title">{getFileStem(bookPath)}</span>
      <span className="book-card-kind">{getFileExtension(bookPath).toUpperCase()}</span>
      <span className="book-card-action">
        <PanelRight size={14} aria-hidden />
        Open beside
      </span>
    </button>
  );
}
