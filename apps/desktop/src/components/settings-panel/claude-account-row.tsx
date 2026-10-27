import { useEffect } from "react";
import { agentProvider } from "@/lib/agent-models";
import { useSettingsStore } from "@/stores/settings-store";
import {
  refreshClaudeAccount,
  signInClaudeFromSettings,
  signOutClaude,
  useClaudeSignInStore,
} from "@/stores/claude-sign-in-store";

// Not a schema entry: the sign-in belongs to the chosen CLI on this Mac
// (SPECs/claude-sign-in-spec.md), so this row only borrows a setting's layout.

const BUTTON =
  "h-9 shrink-0 px-3 text-label whitespace-nowrap font-medium transition-colors disabled:opacity-50";

export function ClaudeAccountRow({ isShown }: { isShown: boolean }) {
  const provider = agentProvider(
    useSettingsStore((s) => s.settings["agent.provider"] as string | undefined),
  );
  const account = useClaudeSignInStore((state) => state.accounts[provider.id]);
  const accountError = useClaudeSignInStore((state) => state.accountErrors[provider.id]);
  const signingIn = useClaudeSignInStore(
    (state) => state.open && state.phase === "waiting" && state.provider === provider.id,
  );

  // Checked each time Settings opens, or the CLI changes: the sign-in can
  // change in Terminal too.
  useEffect(() => {
    if (isShown) void refreshClaudeAccount(provider.id);
  }, [isShown, provider.id]);

  const description =
    accountError ??
    (account === "signed-in"
      ? `Signed in. Organize, the pen and the Agent use ${provider.name} on this Mac.`
      : account === "signed-out"
        ? signingIn
          ? "Finish signing in in your browser."
          : "Signed out. Sign in to use Organize, the pen and the Agent."
        : account === "signing-out"
          ? "Signing out…"
          : "Checking…");

  return (
    <div
      data-claude-account={account ?? "unknown"}
      className="flex items-start justify-between gap-4 px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-[var(--text-primary)]">{provider.plan}</div>
        <div
          className="mt-0.5 text-label text-[var(--text-muted)]"
          role={accountError ? "alert" : undefined}
        >
          {description}
        </div>
      </div>
      {account === "signed-in" || account === "signing-out" ? (
        <button
          type="button"
          disabled={account === "signing-out"}
          onClick={() => void signOutClaude(provider.id)}
          className={`${BUTTON} rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)]`}
        >
          Sign out
        </button>
      ) : account === "signed-out" ? (
        <button
          type="button"
          disabled={signingIn}
          onClick={() => signInClaudeFromSettings(provider.id)}
          className={`${BUTTON} rounded-[var(--radius-button)] bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90`}
        >
          {signingIn ? "Waiting…" : "Sign in"}
        </button>
      ) : accountError ? (
        <button
          type="button"
          onClick={() => void refreshClaudeAccount(provider.id)}
          className={`${BUTTON} rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)]`}
        >
          Check again
        </button>
      ) : null}
    </div>
  );
}
