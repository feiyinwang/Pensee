import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SIGNED_OUT_TEXT } from "@/lib/agent-stream";

// The "Sign in to Claude" popup and the Claude row in Settings
// (SPECs/claude-sign-in-spec.md). Owns the sign-in IPC: `claude_sign_in` runs
// `claude auth login`, which opens the browser and resolves once the writer
// approved there.

export type SignInPhase = "idle" | "waiting" | "failed" | "done";

/** Claude Code's sign-in on this Mac, as Settings shows it. `null` while it
 *  hasn't been checked yet. */
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
  account: ClaudeAccount;
  /** Why the last status check or sign-out failed, in plain words. */
  accountError: string | null;
}

export const useClaudeSignInStore = create<ClaudeSignInState>(() => ({
  open: false,
  phase: "idle",
  error: null,
  url: null,
  fromSettings: false,
  account: null,
  accountError: null,
}));

/** Bumped by every sign-in and close, so a stale `claude_sign_in` settling
 *  late (cancelled, replaced) changes nothing. */
let run = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** Bumped by every status check and sign-out, so only the latest one lands. */
let accountRun = 0;

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
 *  popup. Only requests the writer made call this, never warm-ups. */
export function offerClaudeSignIn(errorText: string): void {
  if (errorText !== SIGNED_OUT_TEXT) return;
  if (useClaudeSignInStore.getState().open) return;
  useClaudeSignInStore.setState({
    open: true,
    phase: "idle",
    error: null,
    url: null,
    fromSettings: false,
  });
}

/** Settings → Sign in: the popup opens already waiting for the browser. */
export function signInClaudeFromSettings(): void {
  useClaudeSignInStore.setState({ open: true, fromSettings: true });
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
  useClaudeSignInStore.setState({ phase: "waiting", error: null, url: null });
  try {
    await invoke("claude_sign_in");
    void refreshClaudeAccount();
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

/** Ask Claude Code whether it is signed in. Settings calls this each time it
 *  opens, and every finished sign-in calls it. */
export async function refreshClaudeAccount(): Promise<void> {
  const mine = ++accountRun;
  try {
    const signedIn = await invoke<boolean>("claude_auth_status");
    if (mine !== accountRun) return;
    useClaudeSignInStore.setState({
      account: signedIn ? "signed-in" : "signed-out",
      accountError: null,
    });
  } catch (error) {
    if (mine !== accountRun) return;
    useClaudeSignInStore.setState({ account: null, accountError: errorMessage(error) });
  }
}

/** Settings → Sign out: `claude auth logout`, and every running Claude ends. */
export async function signOutClaude(): Promise<void> {
  const mine = ++accountRun;
  useClaudeSignInStore.setState({ account: "signing-out", accountError: null });
  try {
    await invoke("claude_sign_out");
    if (mine !== accountRun) return;
    useClaudeSignInStore.setState({ account: "signed-out" });
  } catch (error) {
    if (mine !== accountRun) return;
    // It fails only when Claude Code still reports a sign-in after logging out.
    useClaudeSignInStore.setState({ account: "signed-in", accountError: errorMessage(error) });
  }
}
