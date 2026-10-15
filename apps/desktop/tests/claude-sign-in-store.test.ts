import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const handlers = new Map<string, (event: { payload: unknown }) => void>();
let settle: { resolve: () => void; reject: (error: string) => void } | null = null;
const invoke = vi.fn((command: string, ..._args: unknown[]) => {
  if (command !== "claude_sign_in") return Promise.resolve(undefined);
  return new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...args: unknown[]) => invoke(command, ...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => {});
  }),
}));

import { SIGNED_OUT_TEXT } from "../src/lib/agent-stream";
import {
  closeClaudeSignIn,
  offerClaudeSignIn,
  startClaudeSignIn,
  useClaudeSignInStore,
} from "../src/stores/claude-sign-in-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  closeClaudeSignIn();
  invoke.mockClear();
  settle = null;
});

describe("claude sign-in popup", () => {
  test("opens only for the signed-out error", () => {
    offerClaudeSignIn("The pen took too long. Try again.");
    expect(useClaudeSignInStore.getState().open).toBe(false);
    offerClaudeSignIn(SIGNED_OUT_TEXT);
    expect(useClaudeSignInStore.getState()).toMatchObject({ open: true, phase: "idle" });
  });

  test("waits for the browser, shows the page link, then is done", async () => {
    offerClaudeSignIn(SIGNED_OUT_TEXT);
    const signingIn = startClaudeSignIn();
    expect(useClaudeSignInStore.getState().phase).toBe("waiting");
    handlers.get("claude-sign-in:url")!({ payload: { url: "https://claude.com/x" } });
    expect(useClaudeSignInStore.getState().url).toBe("https://claude.com/x");
    settle!.resolve();
    await signingIn;
    expect(useClaudeSignInStore.getState().phase).toBe("done");
  });

  test("a failure says why", async () => {
    offerClaudeSignIn(SIGNED_OUT_TEXT);
    const signingIn = startClaudeSignIn();
    settle!.reject("Signing in didn't finish. Try again.");
    await signingIn;
    expect(useClaudeSignInStore.getState()).toMatchObject({
      phase: "failed",
      error: "Signing in didn't finish. Try again.",
    });
  });

  test("closing while waiting cancels, and the late result changes nothing", async () => {
    offerClaudeSignIn(SIGNED_OUT_TEXT);
    const signingIn = startClaudeSignIn();
    closeClaudeSignIn();
    expect(invoke).toHaveBeenCalledWith("claude_sign_in_cancel");
    settle!.reject("Signing in was cancelled.");
    await signingIn;
    await flush();
    expect(useClaudeSignInStore.getState()).toMatchObject({ open: false, phase: "idle" });
  });
});
