import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { offerClaudeSignIn } from "@/stores/claude-sign-in-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { agentModel } from "./agent-models";
import { agentErrorText, parseAgentLine } from "./agent-stream";
import { PEN_INSTRUCTIONS } from "./second-pen";

// The second pen's Claude (SPECs/second-pen-spec.md#implementation): the
// window's `pen` channel, a process of its own next to the chat's. One
// request at a time; a request may take a few turns (a fact: query, then
// write), and the next request gets a fresh process, started ahead so it
// skips Claude's startup.

const CHANNEL = "pen";
/** Past this a request is given up on: the bar shouldn't say Writing… forever. */
const TIMEOUT_MS = 60_000;

interface Waiting {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  text: string;
}

const waiting = new Map<string, Waiting>();
let listening = false;

function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ""
  );
}

function ensureListeners(): void {
  if (listening) return;
  listening = true;
  // Signing in ended every Claude: start the pen's again, as it was.
  void listen("agent:ended", () => warmPen());
  // The chat listens to the same events and keeps only its own request ids,
  // as this does.
  void listen<{ requestId: string; line: string }>("agent:line", ({ payload }) => {
    const request = waiting.get(payload.requestId);
    if (!request) return;
    for (const event of parseAgentLine(payload.line)) {
      if (event.kind === "text") request.text += event.text;
      if (event.kind !== "result") continue;
      waiting.delete(payload.requestId);
      if (event.isError) {
        offerClaudeSignIn(event.text);
        request.reject(new Error(event.text || "The pen stopped with an error."));
      } else request.resolve(event.text || request.text);
    }
  });
  void listen<{ requestId: string; code: number | null; stderr: string }>(
    "agent:exit",
    ({ payload }) => {
      const request = waiting.get(payload.requestId);
      if (!request) return;
      waiting.delete(payload.requestId);
      const reason = agentErrorText(lastLine(payload.stderr));
      offerClaudeSignIn(reason);
      request.reject(new Error(reason || "Claude stopped before the pen finished."));
    },
  );
}

function model(): string {
  return agentModel(useSettingsStore.getState().getSetting("agent.model")).id;
}

/** Organize builds a pyramid of ideas from what the lines mean: Haiku hands
 *  back a flat list, so it asks Sonnet at least. */
export function organizeModel(): string {
  const id = model();
  return id === "haiku" ? "sonnet" : id;
}

/** Start the pen's Claude now, so the next request doesn't wait for it. */
export function warmPen(): void {
  if (!useWorkspaceStore.getState().root) return;
  ensureListeners();
  invoke("agent_warm", {
    sessionId: null,
    instructions: PEN_INSTRUCTIONS,
    model: model(),
    channel: CHANNEL,
  }).catch((error: unknown) => {
    // Not shown: the request starts the process itself and reports the reason.
    console.error("[pen] Couldn't start Claude ahead of time:", error);
  });
}

/** One conversation for one request, on `modelId` (else the chosen model).
 *  `send` takes a turn and resolves with the reply's text; `end` throws the
 *  process away and warms the next. */
export interface PenConversation {
  send: (prompt: string) => Promise<string>;
  cancel: () => void;
  end: () => void;
}

export function penConversation(modelId?: string): PenConversation {
  ensureListeners();
  let current: string | null = null;
  let ended = false;
  return {
    send(prompt) {
      if (ended) return Promise.reject(new Error("The pen was stopped."));
      const requestId = crypto.randomUUID();
      current = requestId;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!waiting.delete(requestId)) return;
          void invoke("agent_cancel", { requestId, channel: CHANNEL });
          reject(new Error("The pen took too long. Try again."));
        }, TIMEOUT_MS);
        waiting.set(requestId, {
          resolve: (text) => {
            clearTimeout(timer);
            resolve(text);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
          text: "",
        });
        invoke("agent_send", {
          requestId,
          prompt,
          sessionId: null,
          instructions: PEN_INSTRUCTIONS,
          model: modelId ?? model(),
          channel: CHANNEL,
        }).catch((error: unknown) => {
          const request = waiting.get(requestId);
          if (!request) return;
          waiting.delete(requestId);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    cancel() {
      ended = true;
      const request = current ? waiting.get(current) : undefined;
      if (current && request) {
        waiting.delete(current);
        request.reject(new Error("Stopped."));
        void invoke("agent_cancel", { requestId: current, channel: CHANNEL });
      }
      this.end();
    },
    end() {
      ended = true;
      // The next request starts from nothing: no earlier note, no earlier reply.
      invoke("agent_reset", { channel: CHANNEL })
        .then(() => warmPen())
        .catch((error: unknown) => console.error("[pen] Couldn't reset Claude:", error));
    },
  };
}
