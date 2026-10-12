import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const invoke = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => {});
  }),
}));
vi.mock("@/lib/agent-open-files", () => ({
  collectAgentOpenFiles: async () => [],
  collectAgentPeriodNotes: async () => [],
}));
vi.mock("@/lib/book-readers", () => ({ openBookPassages: async () => [] }));

import { useAgentStore } from "../src/stores/agent-store";
import { useWorkspaceStore } from "../src/stores/workspace-store";

const line = (requestId: string, message: object) =>
  handlers.get("agent:line")!({ payload: { requestId, line: JSON.stringify(message) } });
const exit = (requestId: string, code: number | null) =>
  handlers.get("agent:exit")!({ payload: { requestId, code, stderr: "" } });

async function sendAndGetRequestId(text: string): Promise<string> {
  await useAgentStore.getState().send(text);
  const run = useAgentStore.getState().run;
  if (!run) throw new Error("no run");
  return run.requestId;
}

describe("agent store run lifecycle", () => {
  beforeEach(() => {
    invoke.mockClear();
    useWorkspaceStore.setState({ root: "/w" });
    useAgentStore.setState({ items: [], sessionId: null, run: null });
  });

  test("a reply ends at its result, while the process stays up", async () => {
    const requestId = await sendAndGetRequestId("Define junior");
    expect(invoke).toHaveBeenCalledWith("agent_send", expect.objectContaining({ requestId }));

    line(requestId, {
      type: "result",
      subtype: "success",
      result: "Low-ranking.",
      session_id: "s1",
    });
    expect(useAgentStore.getState().run).toBeNull();
    expect(useAgentStore.getState().sessionId).toBe("s1");

    // The next question goes through instead of "still answering".
    const next = await sendAndGetRequestId("And senior?");
    expect(next).not.toBe(requestId);
    expect(invoke).toHaveBeenLastCalledWith(
      "agent_send",
      expect.objectContaining({ requestId: next, sessionId: "s1" }),
    );
  });

  test("a process that exits mid-reply shows an error", async () => {
    const requestId = await sendAndGetRequestId("hi");
    exit(requestId, 0);
    const { run, items } = useAgentStore.getState();
    expect(run).toBeNull();
    expect(items.at(-1)).toMatchObject({ role: "error" });
  });

  test("an exit after the reply is done says nothing", async () => {
    const requestId = await sendAndGetRequestId("hi");
    line(requestId, { type: "result", subtype: "success", result: "ok", session_id: "s1" });
    const before = useAgentStore.getState().items.length;
    exit(requestId, null);
    expect(useAgentStore.getState().items).toHaveLength(before);
  });
});
