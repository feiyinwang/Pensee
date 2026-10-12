import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

// A PDF or EPUB dropped anywhere on the window is imported beside its book
// page and opened (SPECs/book-reader-spec.md). Rust forwards every drop that
// isn't "open this markdown file or folder" as `editor:file-drop`; pictures in
// it are the editor's, books are ours. The import flow loads only on a drop.
export function useBookDrop(): void {
  useEffect(() => {
    const unlisten = listen<{ paths?: string[] }>("editor:file-drop", (event) => {
      const paths = (event.payload?.paths ?? []).filter((path) => /\.(pdf|epub)$/i.test(path));
      if (!paths.length) return;
      void import("@/lib/book-import").then(({ importBooks }) => importBooks(paths));
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
}
