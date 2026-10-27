import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const handlers = new Map<string, (event: { payload: unknown }) => void>();
let settle: { resolve: () => void; reject: (error: string) => void } | null = null;
let signedIn = false;
let signOutError: string | null = null;
const invoke = vi.fn((command: string, ..._args: unknown[]): Promise<unknown> => {
  if (command === "claude_auth_status") return Promise.resolve(signedIn);
  if (command === "claude_sign_out") {
    if (signOutError) return Promise.reject(signOutError);
    signedIn = false;
    return Promise.resolve(undefined);
  }
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

import { SIGNED_OUT_TEXT, signedOutText } from "../src/lib/agent-stream";
import {
  closeClaudeSignIn,
  offerClaudeSignIn,
  refreshClaudeAccount,
  signInClaudeFromSettings,
  signOutClaude,
  startClaudeSignIn,
  useClaudeSignInStore,
} from "../src/stores/claude-sign-in-store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  closeClaudeSignIn();
  invoke.mockClear();
  settle = null;
  signedIn = false;
  signOutError = null;
  useClaudeSignInStore.setState({
    accounts: { claude: null, codex: null },
    accountErrors: { claude: null, codex: null },
  });
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

describe("claude account in settings", () => {
  test("reads the status", async () => {
    signedIn = true;
    await refreshClaudeAccount();
    expect(useClaudeSignInStore.getState().accounts.claude).toBe("signed-in");
    signedIn = false;
    await refreshClaudeAccount();
    expect(useClaudeSignInStore.getState().accounts.claude).toBe("signed-out");
  });

  test("a status that can't be read says why", async () => {
    invoke.mockImplementationOnce(() => Promise.reject("Run `claude update`"));
    await refreshClaudeAccount();
    expect(useClaudeSignInStore.getState()).toMatchObject({
      accounts: { claude: null },
      accountErrors: { claude: "Run `claude update`" },
    });
  });

  test("sign in opens the popup already waiting, and the status follows", async () => {
    signInClaudeFromSettings();
    expect(useClaudeSignInStore.getState()).toMatchObject({
      open: true,
      phase: "waiting",
      fromSettings: true,
    });
    signedIn = true;
    settle!.resolve();
    await flush();
    await flush();
    expect(useClaudeSignInStore.getState()).toMatchObject({
      phase: "done",
      accounts: { claude: "signed-in" },
    });
  });

  test("sign out ends signed out", async () => {
    signedIn = true;
    await refreshClaudeAccount();
    const signingOut = signOutClaude();
    expect(useClaudeSignInStore.getState().accounts.claude).toBe("signing-out");
    await signingOut;
    expect(invoke).toHaveBeenCalledWith("claude_sign_out", { provider: "claude" });
    expect(useClaudeSignInStore.getState().accounts.claude).toBe("signed-out");
  });

  test("a sign out that didn't take says why and stays signed in", async () => {
    signedIn = true;
    signOutError = "Claude Code is still signed in.";
    await signOutClaude();
    expect(useClaudeSignInStore.getState()).toMatchObject({
      accounts: { claude: "signed-in" },
      accountErrors: { claude: "Claude Code is still signed in." },
    });
  });

  test("each CLI keeps its own sign-in", async () => {
    signedIn = true;
    await refreshClaudeAccount("codex");
    expect(useClaudeSignInStore.getState().accounts).toEqual({ claude: null, codex: "signed-in" });
    expect(invoke).toHaveBeenCalledWith("claude_auth_status", { provider: "codex" });
  });

  test("signing in to ChatGPT runs Codex's sign-in", async () => {
    signInClaudeFromSettings("codex");
    expect(useClaudeSignInStore.getState()).toMatchObject({ provider: "codex", phase: "waiting" });
    expect(invoke).toHaveBeenCalledWith("claude_sign_in", { provider: "codex" });
    settle!.resolve();
    await flush();
  });
});

describe("signed-out text", () => {
  test("ChatGPT's signed-out error opens the popup too", () => {
    offerClaudeSignIn(signedOutText("ChatGPT"));
    expect(useClaudeSignInStore.getState().open).toBe(true);
  });
});
