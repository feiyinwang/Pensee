import { useEffect } from "react";

import { syncAppleBooks, type AppleBooksSyncResult } from "@/lib/apple-books";
import { resolveDailyNoteFile } from "@/lib/daily-note";
import * as tauri from "@/lib/tauri";
import { getFileStem, getParentDir } from "@/lib/paths";
import { findWikiPage, newPagePath } from "@/lib/wiki-pages";
import { editPage, readPageParts } from "@/components/editor-area/linked-block-sync";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { tauriWikiPageDeps } from "@/components/editor-area/wiki-pages-extension";
import { useBooleanSetting } from "@/hooks/use-settings";
import { openFullDiskAccessGuide } from "@/stores/full-disk-access-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { IS_MAC } from "@/lib/platform";

// Binds the Apple Books import (`lib/apple-books.ts`) to the stores, per
// SPECs/apple-books-highlights-spec.md: on a schedule while the
// `apple-books.sync` setting is on, and on demand from the command palette.

const SYNC_INTERVAL_MS = 10 * 60_000;

let running: Promise<void> | null = null;
/** An automatic sync reports a failure once, not every ten minutes. */
let failureShown = false;
/** Without Full Disk Access the guide opens once a session, not every ten minutes. */
let accessGuideShown = false;

function summary(result: AppleBooksSyncResult): string {
  const { highlightsAdded: added, pagesCreated: created } = result;
  if (!added && !created) return "Apple Books highlights are up to date.";
  const highlights = `${added} new highlight${added === 1 ? "" : "s"}`;
  const pages = created ? `, ${created} new book page${created === 1 ? "" : "s"}` : "";
  return `Apple Books: ${highlights}${pages}.`;
}

async function run(root: string, manual: boolean): Promise<void> {
  // macOS asks "access data from other apps" on every read of Books' data and
  // never keeps the answer, so an automatic sync without Full Disk Access
  // would ask at every launch. It waits and shows where to give Full Disk
  // Access instead; a manual import still reads.
  if (!manual && !(await tauri.hasFullDiskAccess())) {
    if (!accessGuideShown) {
      accessGuideShown = true;
      openFullDiskAccessGuide();
    }
    return;
  }

  const folder = useSettingsStore.getState().getSetting("apple-books.folder") ?? "";
  // The folder rules are the daily-note folder's: blank is the root, and a
  // folder outside the workspace is refused rather than rewritten.
  const anchor = resolveDailyNoteFile(root, folder, "_.md");
  if (!anchor.ok) {
    showEditorNotice(
      `Apple Books: New Book Pages Folder "${folder}" is outside the workspace. Pick a folder inside it, or clear the setting.`,
    );
    return;
  }

  let result: AppleBooksSyncResult;
  try {
    result = await syncAppleBooks({
      readHighlights: tauri.readAppleBooksHighlights,
      findPage: (name) => findWikiPage(name, root, anchor.path, tauriWikiPageDeps),
      newPagePath: (name) => newPagePath(name, root, anchor.path),
      readPage: readPageParts,
      saveCover: async (book, pagePath) => {
        // Beside the page in its `<stem>-assets` folder, like a pasted picture.
        const cover = `${getFileStem(pagePath)}-assets/cover.jpg`;
        const saved = await tauri.saveAppleBooksCover(
          book.assetId,
          `${getParentDir(pagePath)}/${cover}`,
        );
        return saved ? cover : null;
      },
      createPage: async (path, content) => {
        await tauri.createFile(path);
        await tauri.writeFile(path, content);
      },
      editPage,
      isCurrent: () => useWorkspaceStore.getState().root === root,
    });
  } catch (error) {
    console.error("[apple-books] Sync failed:", error);
    if (manual || !failureShown) {
      failureShown = true;
      showEditorNotice(
        `Couldn't read Apple Books highlights: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  if (result.failures.length) {
    console.error("[apple-books] Some books failed to sync:", result.failures);
    showEditorNotice(
      `Apple Books: ${result.failures.length} book${result.failures.length === 1 ? "" : "s"} couldn't be updated (${result.failures[0]}).`,
    );
    return;
  }
  failureShown = false;
  if (manual || result.highlightsAdded || result.pagesCreated) showEditorNotice(summary(result));
}

/** Sync now. Overlapping calls share the run already going. */
export function syncAppleBooksNow(manual = true): Promise<void> {
  // Apple Books and Full Disk Access exist only on macOS.
  if (!IS_MAC) return Promise.resolve();
  const { root } = useWorkspaceStore.getState();
  if (!root) return Promise.resolve();
  running ??= run(root, manual).finally(() => {
    running = null;
  });
  return running;
}

/** Keeps the workspace in step with Apple Books while the setting is on. Waits
 *  for the file index: until it is built, a book's existing page would not be
 *  found and a duplicate would be made. */
export function useAppleBooksSync(): void {
  const enabled = useBooleanSetting("apple-books.sync", false);
  const root = useWorkspaceStore((state) => state.root);
  const isIndexing = useWorkspaceStore((state) => state.isIndexing);

  useEffect(() => {
    if (!IS_MAC || !enabled || !root || isIndexing) return;
    void syncAppleBooksNow(false);
    const timer = window.setInterval(() => void syncAppleBooksNow(false), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, root, isIndexing]);
}
