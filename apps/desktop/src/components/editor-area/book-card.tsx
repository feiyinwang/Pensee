import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BookOpen, PanelRight } from "lucide-react";

import { authorOf, bookFileOf, coverOf } from "@/lib/book-highlights";
import { getFileExtension, getFileStem, getParentDir } from "@/lib/paths";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import "./book-card.css";

/** The page's `Cover` as an image URL: a web address as is, a path from the
 *  page's folder through the asset protocol. */
function coverSrc(cover: string, pagePath: string): string {
  return /^https?:\/\//i.test(cover) ? cover : convertFileSrc(`${getParentDir(pagePath)}/${cover}`);
}

/** The cover the book file carries (what Apple Books shows), falling back to
 *  the page's `Cover` while it loads or when the book has none. The book
 *  comes first: a saved `Cover` can be stale or broken (an Apple Books cache
 *  image that converted to black). */
function useBookCover(bookPath: string | null, fromPage: string | null): string | null {
  const [fromBook, setFromBook] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!bookPath) return;
    let current = true;
    void import("@/components/book-reader/book-cover")
      .then(({ bookCoverUrl }) => bookCoverUrl(bookPath))
      .then((url) => {
        if (current) setFromBook({ path: bookPath, url });
      });
    return () => {
      current = false;
    };
  }, [bookPath]);
  const own = fromBook?.path === bookPath ? fromBook.url : null;
  return own ?? fromPage;
}

/**
 * On a book page whose book is not open, a card under the properties shows
 * the book (its own cover, title, author) and opens it in the column beside the
 * page (SPECs/book-reader-spec.md). Hidden while the book is open, so it only
 * ever offers what isn't already on screen.
 */
export function BookCard({ filePath }: { filePath: string }) {
  const frontmatter = useEditorStore((s) => s.openFiles.get(filePath)?.frontmatter ?? null);
  // Most pages are not books: skip the YAML parse unless a `book` key is there.
  const page = useMemo(() => {
    if (!frontmatter || !/^book\s*:/im.test(frontmatter)) return null;
    const book = bookFileOf(frontmatter);
    if (!book) return null;
    const cover = coverOf(frontmatter);
    return {
      bookPath: `${getParentDir(filePath)}/${book}`,
      author: authorOf(frontmatter),
      cover: cover ? coverSrc(cover, filePath) : null,
    };
  }, [frontmatter, filePath]);
  const bookPath = page?.bookPath ?? null;
  const isOpen = useEditorStore((s) =>
    bookPath
      ? s.tabs.some((tab) => tab.location.kind === "book" && tab.location.path === bookPath)
      : false,
  );
  const cover = useBookCover(isOpen ? null : bookPath, page?.cover ?? null);
  const [coverFailed, setCoverFailed] = useState<string | null>(null);
  if (!page || !bookPath || isOpen) return null;

  const open = () => {
    void import("@/lib/book-import")
      .then(({ openBookOfPage }) => openBookOfPage(filePath))
      .catch((error: unknown) => {
        console.error("[book] Couldn't open the book:", error);
        showEditorNotice(
          `Couldn't open the book: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };
  const title = getFileStem(bookPath);
  const showCover = cover && coverFailed !== cover;

  return (
    <button
      type="button"
      className="book-card"
      aria-label={`Open ${title} beside this page`}
      onClick={open}
    >
      <span className="book-card-cover" aria-hidden>
        {showCover ? (
          <img src={cover} alt="" draggable={false} onError={() => setCoverFailed(cover)} />
        ) : (
          <BookOpen size={16} />
        )}
      </span>
      <span className="book-card-text">
        <span className="book-card-title">{title}</span>
        <span className="book-card-meta">
          {[page.author, getFileExtension(bookPath).toUpperCase()].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="book-card-action">
        <PanelRight size={14} aria-hidden />
        Open beside
      </span>
    </button>
  );
}
