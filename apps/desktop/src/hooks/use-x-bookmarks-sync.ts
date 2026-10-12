import { useEffect } from "react";
import { create } from "zustand";

import { resolveDailyNoteFile } from "@/lib/daily-note";
import { getParentDir } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import {
  DEFAULT_BOOKMARKS_FOLDER,
  syncXBookmarks,
  TWEET_TYPE,
  type XAccount,
  type XSyncResult,
} from "@/lib/x-bookmarks";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Binds the X bookmarks sync (`lib/x-bookmarks.ts`) to the app, per
// SPECs/x-bookmarks-spec.md: on launch and every 15 minutes while X is
// connected, and on demand from Library and Settings.

const SYNC_INTERVAL_MS = 15 * 60_000;

interface XBookmarksState {
  /** undefined until the Keychain has been read. */
  account: XAccount | null | undefined;
  connecting: boolean;
  /** Bookmarks saved so far in the running sync, or null when idle. */
  progress: { done: number; total: number } | null;
  lastSyncedAt: number | null;
  /** Why the last sync stopped, until one succeeds. */
  error: string | null;
}

export const useXBookmarksStore = create<XBookmarksState>(() => ({
  account: undefined,
  connecting: false,
  progress: null,
  lastSyncedAt: null,
  error: null,
}));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function loadXAccount(): Promise<void> {
  try {
    useXBookmarksStore.setState({ account: await tauri.xAccount() });
  } catch (error) {
    console.error("[x-bookmarks] Couldn't read the X sign-in:", error);
    useXBookmarksStore.setState({ account: null, error: message(error) });
  }
}

export async function connectX(): Promise<void> {
  const clientId = useSettingsStore.getState().getSetting("x-bookmarks.client-id") ?? "";
  useXBookmarksStore.setState({ connecting: true });
  try {
    const account = await tauri.xConnect(clientId);
    useXBookmarksStore.setState({ account, error: null });
  } catch (error) {
    showEditorNotice(message(error));
    return;
  } finally {
    useXBookmarksStore.setState({ connecting: false });
  }
  void syncXBookmarksNow(true);
}

export async function disconnectX(): Promise<void> {
  try {
    await tauri.xDisconnect();
    useXBookmarksStore.setState({ account: null, error: null, lastSyncedAt: null });
  } catch (error) {
    showEditorNotice(message(error));
  }
}

let running: Promise<void> | null = null;

async function run(root: string, manual: boolean): Promise<void> {
  const folderSetting =
    useSettingsStore.getState().getSetting("x-bookmarks.folder") || DEFAULT_BOOKMARKS_FOLDER;
  // The folder rules are the daily-note folder's: a folder outside the
  // workspace is refused rather than rewritten.
  const anchor = resolveDailyNoteFile(root, folderSetting, "_.md");
  if (!anchor.ok) {
    showEditorNotice(
      `X Bookmarks: Bookmarks Folder "${folderSetting}" is outside the workspace. Pick a folder inside it in Settings.`,
    );
    return;
  }

  let result: XSyncResult;
  try {
    result = await syncXBookmarks({
      folder: getParentDir(anchor.path),
      knownIds: async () =>
        (await tauri.listTypedNotes([TWEET_TYPE]))
          .map((note) => note.properties.id?.replace(/^"|"$/g, ""))
          .filter((id): id is string => Boolean(id)),
      listNew: (known) => tauri.xListNewBookmarks(root, known),
      expand: tauri.xExpandThread,
      saveMedia: tauri.xSaveMedia,
      fileExists: tauri.fileExists,
      createNote: async (path, content) => {
        await tauri.createFile(path);
        await tauri.writeFile(path, content);
      },
      markSaved: (ids) => tauri.xMarkSaved(root, ids),
      today,
      onProgress: (done, total) =>
        useXBookmarksStore.setState({ progress: total ? { done, total } : null }),
      isCurrent: () => useWorkspaceStore.getState().root === root,
    });
  } catch (error) {
    console.error("[x-bookmarks] Sync failed:", error);
    const text = message(error);
    // An automatic sync reports a failure once, not every 15 minutes.
    if (manual || useXBookmarksStore.getState().error !== text) {
      showEditorNotice(`X Bookmarks: ${text}`);
    }
    useXBookmarksStore.setState({ error: text, progress: null });
    return;
  }
  useXBookmarksStore.setState({ error: null, progress: null, lastSyncedAt: Date.now() });
  if (result.missingMedia) {
    showEditorNotice(
      `X Bookmarks: ${result.missingMedia} photo${result.missingMedia === 1 ? "" : "s"} or video${result.missingMedia === 1 ? "" : "s"} didn't download. The notes link to the posts instead.`,
    );
  } else if (manual && !result.saved) {
    showEditorNotice("X bookmarks are up to date.");
  }
}

/** Sync now. Overlapping calls share the run already going. */
export function syncXBookmarksNow(manual = true): Promise<void> {
  const { root } = useWorkspaceStore.getState();
  if (!root || !useXBookmarksStore.getState().account) return Promise.resolve();
  running ??= run(root, manual).finally(() => {
    running = null;
  });
  return running;
}

/** Keeps the Bookmarks folder in step with X while X is connected. Waits for
 *  the file index so notes already in the vault are known. */
export function useXBookmarksSync(): void {
  const connected = useXBookmarksStore((state) => Boolean(state.account));
  const root = useWorkspaceStore((state) => state.root);
  const isIndexing = useWorkspaceStore((state) => state.isIndexing);

  useEffect(() => {
    void loadXAccount();
  }, []);

  useEffect(() => {
    if (!connected || !root || isIndexing) return;
    void syncXBookmarksNow(false);
    const timer = window.setInterval(() => void syncXBookmarksNow(false), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, root, isIndexing]);
}
