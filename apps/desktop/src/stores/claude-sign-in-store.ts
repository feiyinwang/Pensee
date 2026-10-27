import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isSignedOutText } from "@/lib/agent-stream";
import { agentProvider, type AgentProviderId } from "@/lib/agent-models";
import { useSettingsStore } from "@/stores/settings-store";

// The sign-in popup and the account row in Settings
// (SPECs/claude-sign-in-spec.md, SPECs/codex-spec.md). Owns the sign-in IPC:
// `claude_sign_in` runs `claude auth login` or `codex login`, which opens the
// browser and resolves once the writer approved there. Every call is for one
// CLI; left out, it is the one chosen in Settings → Agent.

export type SignInPhase = "idle" | "waiting" | "failed" | "done";

/** A CLI's sign-in on this Mac, as Settings shows it. `null` while it hasn't
 *  been checked yet. */
export type ClaudeAccount = "signed-in" | "signed-out" | "signing-out" | null;

/** How long "Signed in" stays before the popup closes by itself. */
const DONE_CLOSE_MS = 1500;

interface ClaudeSignInState {
  open: boolean;
  phase: SignInPhase;
  /** Why the last sign-in failed, in plain words. */
  error: string | null;
  /** The sign-in page, for when the browser didn't open. */
  url: string | null;
  /** Opened from Settings rather than by a failed request: nothing to run again. */
  fromSettings: boolean;
  /** The CLI the popup signs in to. */
  provider: AgentProviderId;
  accounts: Record<AgentProviderId, ClaudeAccount>;
  /** Why each CLI's last status check or sign-out failed, in plain words. */
  accountErrors: Record<AgentProviderId, string | null>;
}

export const useClaudeSignInStore = create<ClaudeSignInState>(() => ({
  open: false,
  phase: "idle",
  error: null,
  url: null,
  fromSettings: false,
  provider: "claude",
  accounts: { claude: null, codex: null },
  accountErrors: { claude: null, codex: null },
}));

/** The CLI chosen in Settings → Agent. */
export function activeProvider(): AgentProviderId {
  return agentProvider(useSettingsStore.getState().getSetting("agent.provider")).id;
}

function setAccount(
  provider: AgentProviderId,
  account: ClaudeAccount,
  accountError: string | null,
): void {
  useClaudeSignInStore.setState((state) => ({
    accounts: { ...state.accounts, [provider]: account },
    accountErrors: { ...state.accountErrors, [provider]: accountError },
  }));
}

/** Bumped by every sign-in and close, so a stale `claude_sign_in` settling
 *  late (cancelled, replaced) changes nothing. */
let run = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** Bumped by every status check and sign-out, so only each CLI's latest lands. */
const accountRuns: Record<AgentProviderId, number> = { claude: 0, codex: 0 };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureListener(): void {
  if (listening) return;
  listening = true;
  void listen<{ url: string }>("claude-sign-in:url", ({ payload }) => {
    if (useClaudeSignInStore.getState().phase === "waiting") {
      useClaudeSignInStore.setState({ url: payload.url });
    }
  });
}

/** A pen or Agent request failed with this error: a signed-out one opens the
 *  popup, for the CLI that ran it. Only requests the writer made call this,
 *  never warm-ups. */
export function offerClaudeSignIn(errorText: string): void {
  if (!isSignedOutText(errorText)) return;
  if (useClaudeSignInStore.getState().open) return;
  useClaudeSignInStore.setState({
    open: true,
    phase: "idle",
    error: null,
    url: null,
    fromSettings: false,
    provider: activeProvider(),
  });
}

/** Settings (or onboarding) → Sign in: the popup opens already waiting for
 *  the browser. */
export function signInClaudeFromSettings(provider: AgentProviderId = activeProvider()): void {
  if (useClaudeSignInStore.getState().phase === "waiting") closeClaudeSignIn();
  useClaudeSignInStore.setState({ open: true, fromSettings: true, provider });
  void startClaudeSignIn();
}

export function closeClaudeSignIn(): void {
  run += 1;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  if (useClaudeSignInStore.getState().phase === "waiting") {
    void invoke("claude_sign_in_cancel").catch((error: unknown) =>
      console.error("[sign-in] Couldn't stop signing in:", error),
    );
  }
  useClaudeSignInStore.setState({ open: false, phase: "idle", error: null, url: null });
}

export async function startClaudeSignIn(): Promise<void> {
  ensureListener();
  const mine = ++run;
  const { provider } = useClaudeSignInStore.getState();
  useClaudeSignInStore.setState({ phase: "waiting", error: null, url: null });
  try {
    await invoke("claude_sign_in", { provider });
    void refreshClaudeAccount(provider);
    if (mine !== run) return;
    useClaudeSignInStore.setState({ phase: "done" });
    closeTimer = setTimeout(() => {
      if (mine === run) closeClaudeSignIn();
    }, DONE_CLOSE_MS);
  } catch (error) {
    if (mine !== run) return;
    useClaudeSignInStore.setState({ phase: "failed", error: errorMessage(error) });
  }
}

/** The code the browser showed, for Claude Code's "Paste code here" prompt. */
export async function submitClaudeSignInCode(code: string): Promise<void> {
  if (!code.trim()) return;
  try {
    await invoke("claude_sign_in_code", { code });
  } catch (error) {
    useClaudeSignInStore.setState({ phase: "failed", error: errorMessage(error) });
  }
}

/** Ask the CLI whether it is signed in. Settings calls this each time it
 *  opens, onboarding for each CLI it finds, and every finished sign-in. */
export async function refreshClaudeAccount(
  provider: AgentProviderId = activeProvider(),
): Promise<void> {
  const mine = ++accountRuns[provider];
  try {
    const signedIn = await invoke<boolean>("claude_auth_status", { provider });
    if (mine !== accountRuns[provider]) return;
    setAccount(provider, signedIn ? "signed-in" : "signed-out", null);
  } catch (error) {
    if (mine !== accountRuns[provider]) return;
    setAccount(provider, null, errorMessage(error));
  }
}

/** Settings → Sign out: the CLI's logout, and every running agent ends. */
export async function signOutClaude(provider: AgentProviderId = activeProvider()): Promise<void> {
  const mine = ++accountRuns[provider];
  setAccount(provider, "signing-out", null);
  try {
    await invoke("claude_sign_out", { provider });
    if (mine !== accountRuns[provider]) return;
    setAccount(provider, "signed-out", null);
  } catch (error) {
    if (mine !== accountRuns[provider]) return;
    // It fails only when the CLI still reports a sign-in after logging out.
    setAccount(provider, "signed-in", errorMessage(error));
  }
}
