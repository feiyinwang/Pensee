import { useSetting } from "@/hooks/use-settings";
import { useOpenSettingsTab } from "@/hooks/use-tabs";
import { connectX, syncXBookmarksNow, useXBookmarksStore } from "@/hooks/use-x-bookmarks-sync";
import { formatRelativeTime } from "@/lib/relative-time";
import styles from "./spaces.module.css";

// The Bookmarks tab's line about X (SPECs/x-bookmarks-spec.md): how the sync
// is doing, with one action, or what to do when X isn't connected.

/** Connect straight away when there's a Client ID; otherwise Settings, where
 *  it goes. */
function useConnect(): () => void {
  const clientId = useSetting("x-bookmarks.client-id") ?? "";
  const openSettings = useOpenSettingsTab();
  return () => (clientId ? void connectX() : openSettings());
}

export function XSyncBar() {
  const account = useXBookmarksStore((state) => state.account);
  const connecting = useXBookmarksStore((state) => state.connecting);
  const progress = useXBookmarksStore((state) => state.progress);
  const lastSyncedAt = useXBookmarksStore((state) => state.lastSyncedAt);
  const error = useXBookmarksStore((state) => state.error);
  const connect = useConnect();

  if (account === undefined) return null;

  if (!account) {
    return (
      <div className={styles.coverBar}>
        <span>{connecting ? "Finish signing in to X in your browser." : "Not connected to X"}</span>
        {!connecting && (
          <button type="button" className={styles.coverBarButton} onClick={connect}>
            Connect X
          </button>
        )}
      </div>
    );
  }

  if (progress) {
    return (
      <div className={styles.coverBar}>
        <span>
          Saving bookmarks · {progress.done} of {progress.total}
        </span>
      </div>
    );
  }

  const synced = lastSyncedAt ? formatRelativeTime(Math.floor(lastSyncedAt / 1000)) : null;
  return (
    <div className={styles.coverBar}>
      <span className={error ? styles.coverBarError : undefined}>
        {error ?? (synced ? `Synced with X ${synced}` : `Connected as @${account.username}`)}
      </span>
      <button
        type="button"
        className={styles.coverBarButton}
        onClick={() => void syncXBookmarksNow(true)}
      >
        Sync now
      </button>
    </div>
  );
}

/** The empty Bookmarks tab: what it's for and how to start. */
export function XBookmarksEmpty() {
  const account = useXBookmarksStore((state) => state.account);
  const connecting = useXBookmarksStore((state) => state.connecting);
  const connect = useConnect();
  const connected = Boolean(account);
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>
        {connected ? "No bookmarks yet" : "Bring in your X bookmarks"}
      </div>
      <div className={styles.emptyText}>
        {connected
          ? "Bookmark a post on X and it shows up here at the next sync."
          : "Every post you bookmark on X shows up here as a note, with its thread, photos and videos saved."}
      </div>
      {!connected && (
        <button
          type="button"
          className={styles.emptyAction}
          disabled={connecting || account === undefined}
          onClick={connect}
        >
          {connecting ? "Waiting for X…" : "Connect X"}
        </button>
      )}
    </div>
  );
}
