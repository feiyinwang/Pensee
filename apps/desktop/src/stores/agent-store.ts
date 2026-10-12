import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { parseAgentLine, type AgentStreamEvent } from "@/lib/agent-stream";
import { buildAgentSystemPrompt } from "@/lib/agent-context";
import { useSettingsStore } from "@/stores/settings-store";
import { collectAgentOpenFiles, collectAgentPeriodNotes } from "@/lib/agent-open-files";
import { openBookPassages } from "@/lib/book-readers";
import { flushSave } from "@/lib/save";
import { agentModel, type AgentModelId } from "@/lib/agent-models";

/** One row in the chat. `tool` and `status` rows are muted one-liners. */
export type AgentItem =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "tool"; text: string }
  | { id: string; role: "status"; text: string }
  | { id: string; role: "error"; text: string };

interface AgentRun {
  requestId: string;
  /** Set by Stop so the exit reads as "Stopped", not as a failure. */
  cancelled: boolean;
  /** A `result` line arrived, so the exit code carries no news. */
  settled: boolean;
}

interface AgentState {
  isOpen: boolean;
  items: AgentItem[];
  sessionId: string | null;
  run: AgentRun | null;

  toggle: () => void;
  close: () => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  /** Switch the model for this and later messages; it is a global setting. */
  setModel: (id: AgentModelId) => void;
}

let nextId = 0;
const itemId = () => `agent-${++nextId}`;

function appendItem(items: AgentItem[], item: Omit<AgentItem, "id">): AgentItem[] {
  return [...items, { ...item, id: itemId() } as AgentItem];
}

/** Apply one stream event to the chat rows. Text deltas extend the reply
 *  being written; a tool call ends it, so later text starts a new reply. */
function applyEvent(state: AgentState, event: AgentStreamEvent): Partial<AgentState> {
  switch (event.kind) {
    case "session":
      return { sessionId: event.sessionId };
    case "text": {
      const last = state.items[state.items.length - 1];
      if (last?.role === "assistant") {
        return {
          items: [...state.items.slice(0, -1), { ...last, text: last.text + event.text }],
        };
      }
      const text = event.text.trimStart();
      return text ? { items: appendItem(state.items, { role: "assistant", text }) } : {};
    }
    case "tool":
      return { items: appendItem(state.items, { role: "tool", text: event.label }) };
    case "result": {
      const run = state.run ? { ...state.run, settled: true } : null;
      const sessionId = event.sessionId ?? state.sessionId;
      if (!event.isError) return { run, sessionId };
      return {
        run,
        sessionId,
        items: appendItem(state.items, {
          role: "error",
          text: event.text || "Claude stopped with an error.",
        }),
      };
    }
  }
}

function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let listening = false;

/** Subscribe once per window. Events are routed to this window by Rust, and
 *  lines for any request but the current one (a stopped run's tail) are dropped. */
function ensureListeners() {
  if (listening) return;
  listening = true;

  void listen<{ requestId: string; line: string }>("agent:line", ({ payload }) => {
    const { run } = useAgentStore.getState();
    if (!run || run.requestId !== payload.requestId) return;
    for (const event of parseAgentLine(payload.line)) {
      useAgentStore.setState((state) => applyEvent(state, event));
    }
  });

  void listen<{ requestId: string; code: number | null; stderr: string }>(
    "agent:exit",
    ({ payload }) => {
      useAgentStore.setState((state) => {
        if (!state.run || state.run.requestId !== payload.requestId) return {};
        if (state.run.cancelled) {
          return { run: null, items: appendItem(state.items, { role: "status", text: "Stopped" }) };
        }
        if (state.run.settled || payload.code === 0) return { run: null };
        const reason =
          lastLine(payload.stderr) || `Claude exited with code ${payload.code ?? "?"}.`;
        return { run: null, items: appendItem(state.items, { role: "error", text: reason }) };
      });
    },
  );
}

/** Save every dirty open file so Claude reads what is on screen. */
async function flushOpenFiles() {
  const { openFiles } = useEditorStore.getState();
  const dirty = [...openFiles.values()].filter((file) => file.isDirty).map((file) => file.path);
  await Promise.all(dirty.map((path) => flushSave(path)));
}

async function currentContext(root: string) {
  const { tabs, activeTabId, activeFilePath, openFiles } = useEditorStore.getState();
  const paths = [
    ...new Set(tabs.flatMap((tab) => (tab.location.kind === "file" ? [tab.location.path] : []))),
  ];
  const folder = useSettingsStore.getState().getSetting("workspace.daily-note-folder") ?? "";
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const [files, periodNotes, books] = await Promise.all([
    collectAgentOpenFiles(paths, openFiles),
    collectAgentPeriodNotes(root, folder, new Date(), new Set(paths), openFiles),
    openBookPassages(),
  ]);
  return buildAgentSystemPrompt({
    root,
    openFiles: files,
    focusedPath: activeFilePath,
    periodNotes,
    books,
    focusedBook: activeTab?.location.kind === "book" ? activeTab.location.path : null,
  });
}

export function currentModel() {
  return agentModel(useSettingsStore.getState().getSetting("agent.model"));
}

export const useAgentStore = create<AgentState>((set, get) => ({
  isOpen: false,
  items: [],
  sessionId: null,
  run: null,

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  close: () => set({ isOpen: false }),

  send: async (rawText) => {
    const text = rawText.trim();
    const root = useWorkspaceStore.getState().root;
    if (!text || !root || get().run) return;

    ensureListeners();
    const requestId = crypto.randomUUID();
    set((state) => ({
      items: appendItem(state.items, { role: "user", text }),
      run: { requestId, cancelled: false, settled: false },
    }));

    try {
      await flushOpenFiles();
      const systemPrompt = await currentContext(root);
      // Stopped (or reset) while saving or reading tabs: don't start the process.
      const run = get().run;
      if (run?.requestId !== requestId) return;
      if (run.cancelled) {
        set((state) => ({
          run: null,
          items: appendItem(state.items, { role: "status", text: "Stopped" }),
        }));
        return;
      }
      await invoke("agent_send", {
        requestId,
        prompt: text,
        sessionId: get().sessionId,
        systemPrompt,
        model: currentModel().id,
      });
    } catch (error) {
      set((state) =>
        state.run?.requestId === requestId
          ? {
              run: null,
              items: appendItem(state.items, { role: "error", text: errorMessage(error) }),
            }
          : {},
      );
    }
  },

  stop: () => {
    const { run } = get();
    if (!run) return;
    set({ run: { ...run, cancelled: true } });
    void invoke("agent_cancel", { requestId: run.requestId });
  },

  newChat: () => {
    const { run } = get();
    if (run) void invoke("agent_cancel", { requestId: run.requestId });
    set({ items: [], sessionId: null, run: null });
  },

  setModel: (id) => {
    // Optimistic: the setting changes now and rolls back if saving fails.
    useSettingsStore
      .getState()
      .setSetting("agent.model", id, "global")
      .catch((error: unknown) =>
        set((state) => ({
          items: appendItem(state.items, {
            role: "error",
            text: `Couldn't save the model: ${errorMessage(error)}`,
          }),
        })),
      );
    set((state) => ({
      items: appendItem(state.items, {
        role: "status",
        text: `Model set to ${agentModel(id).name}`,
      }),
    }));
  },
}));
