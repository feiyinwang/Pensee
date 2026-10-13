import { useSetting } from "@/hooks/use-settings";
import {
  connectX,
  disconnectX,
  syncXBookmarksNow,
  useXBookmarksStore,
} from "@/hooks/use-x-bookmarks-sync";

// Not a schema entry: the X sign-in lives in the Keychain
// (SPECs/x-bookmarks-spec.md), so this row only borrows a setting's layout.

const BUTTON =
  "h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium transition-colors disabled:opacity-50";

export function XAccountRow() {
  const account = useXBookmarksStore((state) => state.account);
  const connecting = useXBookmarksStore((state) => state.connecting);
  const syncing = useXBookmarksStore((state) => state.progress !== null);
  const clientId = useSetting("x-bookmarks.client-id") ?? "";

  const description = account
    ? `Connected as @${account.username}. Bookmarks are checked every 15 minutes while Pensée is open.`
    : connecting
      ? "Finish signing in to X in your browser."
      : clientId
        ? "Opens X in your browser to let Pensée read your bookmarks."
        : "Paste your app's Client ID above first.";

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">Account</div>
        <div className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</div>
      </div>
      {account ? (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={syncing}
            onClick={() => void syncXBookmarksNow(true)}
            className={`${BUTTON} text-[var(--text-secondary)] hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)]`}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={() => void disconnectX()}
            className={`${BUTTON} text-[var(--text-secondary)] hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)]`}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!clientId || connecting || account === undefined}
          onClick={() => void connectX()}
          className={`${BUTTON} bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90`}
        >
          {connecting ? "Waiting for X…" : "Connect X"}
        </button>
      )}
    </div>
  );
}
