/**
 * Agent CLI stdout line → chat events. Pure, so the chat's view of a run can
 * be tested without a process. Two shapes arrive, told apart by the line:
 * - Claude Code `--output-format stream-json`: text comes from the
 *   partial-message deltas (so it streams); tool calls come from the complete
 *   assistant messages (so their input is whole).
 * - Codex `app-server` JSON-RPC: text from `item/agentMessage/delta`, tool
 *   calls from `item/started`, the end from `turn/completed`
 *   (SPECs/codex-spec.md).
 * Everything else — hooks, init noise, tool results, reasoning — is dropped:
 * the chat shows replies, not a log.
 */

export type AgentStreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "result"; isError: boolean; text: string; sessionId: string | null };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fileName(path: unknown): string | null {
  const value = str(path);
  if (!value) return null;
  return value.split(/[\\/]/).pop() || value;
}

/** The CLI's sign-in failed (expired, revoked or missing): the raw API error
 *  is JSON, so say so plainly. This text is also what opens the sign-in
 *  popup (`offerClaudeSignIn`), for whichever CLI is chosen. */
const SIGNED_OUT_RE = /\bauthenticat|\b401\b|oauth|unauthorized|not logged in|\/login\b/i;
const SIGNED_OUT_TAIL = " is signed out. Sign in, then try again.";

/** What a signed-out request says, naming the CLI's plan ("Claude", "ChatGPT"). */
export function signedOutText(plan: string): string {
  return `${plan}${SIGNED_OUT_TAIL}`;
}

/** Claude's, kept for the callers (and tests) that predate Codex. */
export const SIGNED_OUT_TEXT = signedOutText("Claude");

export function isSignedOutText(text: string): boolean {
  return text.endsWith(SIGNED_OUT_TAIL);
}

/** An error from the CLI, readable: a sign-in failure says so. */
export function agentErrorText(text: string, plan = "Claude"): string {
  return SIGNED_OUT_RE.test(text) ? signedOutText(plan) : text;
}

/** One past-tense line per tool call. `null` hides bookkeeping tools. */
export function describeToolCall(name: string, input: Json): string | null {
  switch (name) {
    case "Read":
      return `Read ${fileName(input.file_path) ?? "a file"}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Edited ${fileName(input.file_path ?? input.notebook_path) ?? "a file"}`;
    case "Write":
      return `Wrote ${fileName(input.file_path) ?? "a file"}`;
    case "Glob":
      return `Searched ${str(input.pattern) ?? "files"}`;
    case "Grep":
      return str(input.pattern) ? `Searched for “${str(input.pattern)}”` : "Searched files";
    case "Bash":
      return "Ran a command";
    case "WebSearch":
    case "WebFetch":
      return "Searched the web";
    case "Task":
    case "Agent":
      return "Ran a subagent";
    case "TodoWrite":
    case "ToolSearch":
    case "Skill":
      return null;
    default:
      return name.startsWith("mcp__") ? `Used ${name.split("__").pop()}` : `Used ${name}`;
  }
}

/** One past-tense line for a Codex item that acts. Codex reads and searches
 *  with shell commands; their parsed `commandActions` say what each did. */
export function describeCodexItem(item: Json): string | null {
  switch (item.type) {
    case "commandExecution": {
      const actions = Array.isArray(item.commandActions)
        ? item.commandActions.filter(isObject)
        : [];
      const action = actions[0];
      if (!action) return "Ran a command";
      if (action.type === "read") return `Read ${fileName(action.path ?? action.name) ?? "a file"}`;
      if (action.type === "search")
        return str(action.query) ? `Searched for “${str(action.query)}”` : "Searched files";
      if (action.type === "listFiles") return "Listed files";
      return "Ran a command";
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isObject) : [];
      const names = changes.map((change) => fileName(change.path)).filter(Boolean);
      return names.length ? `Edited ${names.join(", ")}` : "Edited a file";
    }
    case "webSearch":
      return "Searched the web";
    case "mcpToolCall":
      return `Used ${str(item.tool) ?? "a tool"}`;
    default:
      return null;
  }
}

/** The reply a finished Codex turn ends on: its last agent message. */
function codexReply(turn: Json): string {
  const items = Array.isArray(turn.items) ? turn.items.filter(isObject) : [];
  const messages = items.filter((item) => item.type === "agentMessage");
  return str(messages[messages.length - 1]?.text) ?? "";
}

function codexError(error: unknown): string {
  return (isObject(error) && str(error.message)) || "Codex stopped with an error.";
}

/** A Codex request failed for want of a sign-in (HTTP 401). */
function isCodexUnauthorized(error: unknown): boolean {
  if (!isObject(error)) return false;
  const info = error.codexErrorInfo;
  if (info === "unauthorized") return true;
  if (isObject(info)) {
    return Object.values(info).some((detail) => isObject(detail) && detail.httpStatusCode === 401);
  }
  return false;
}

function parseCodexMessage(message: Json): AgentStreamEvent[] {
  const params = isObject(message.params) ? message.params : {};
  switch (message.method) {
    // A response: the thread it runs in, or a request that failed.
    case undefined: {
      const result = isObject(message.result) ? message.result : null;
      const thread = result && isObject(result.thread) ? str(result.thread.id) : null;
      if (thread) return [{ kind: "session", sessionId: thread }];
      if (isObject(message.error)) {
        const text = agentErrorText(codexError(message.error), "ChatGPT");
        return [{ kind: "result", isError: true, text, sessionId: null }];
      }
      return [];
    }
    case "item/agentMessage/delta": {
      const text = str(params.delta);
      return text ? [{ kind: "text", text }] : [];
    }
    case "item/started": {
      const item = isObject(params.item) ? params.item : null;
      if (!item) return [];
      // A second message in one turn (after "I'll read Draft.md.") is its
      // own paragraph; the chat drops this break when nothing came before.
      if (item.type === "agentMessage") return [{ kind: "text", text: "\n\n" }];
      const label = describeCodexItem(item);
      return label ? [{ kind: "tool", label }] : [];
    }
    // Codex retries a dropped stream five times before failing the turn. A
    // sign-in it lacks never comes back, so that ends the reply at once
    // instead of ~17 s later.
    case "error": {
      if (!isCodexUnauthorized(params.error)) return [];
      const text = signedOutText("ChatGPT");
      return [{ kind: "result", isError: true, text, sessionId: str(params.threadId) }];
    }
    case "turn/completed": {
      const turn = isObject(params.turn) ? params.turn : {};
      const sessionId = str(params.threadId);
      if (turn.status === "completed") {
        return [{ kind: "result", isError: false, text: codexReply(turn), sessionId }];
      }
      const text =
        turn.status === "interrupted"
          ? "Codex stopped before finishing its reply."
          : isCodexUnauthorized(turn.error)
            ? signedOutText("ChatGPT")
            : agentErrorText(codexError(turn.error), "ChatGPT");
      return [{ kind: "result", isError: true, text, sessionId }];
    }
    default:
      return [];
  }
}

export function parseAgentLine(line: string): AgentStreamEvent[] {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObject(message)) return [];
  // Claude Code's lines carry a `type`; Codex's JSON-RPC ones don't.
  if (message.type === undefined) return parseCodexMessage(message);

  switch (message.type) {
    case "system": {
      const sessionId = str(message.session_id);
      return message.subtype === "init" && sessionId ? [{ kind: "session", sessionId }] : [];
    }
    case "stream_event": {
      // Subagent output streams too; only the top-level reply belongs in the chat.
      if (message.parent_tool_use_id) return [];
      const event = message.event;
      if (!isObject(event) || event.type !== "content_block_delta") return [];
      const delta = event.delta;
      if (!isObject(delta) || delta.type !== "text_delta") return [];
      const text = str(delta.text);
      return text ? [{ kind: "text", text }] : [];
    }
    case "assistant": {
      if (message.parent_tool_use_id) return [];
      const content = isObject(message.message) ? message.message.content : null;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block): AgentStreamEvent[] => {
        if (!isObject(block) || block.type !== "tool_use") return [];
        const name = str(block.name);
        if (!name) return [];
        const label = describeToolCall(name, isObject(block.input) ? block.input : {});
        return label ? [{ kind: "tool", label }] : [];
      });
    }
    case "result": {
      const isError = message.is_error === true || message.subtype !== "success";
      const text =
        str(message.result) ??
        (Array.isArray(message.errors) ? message.errors.filter(str).join("\n") : "");
      return [
        {
          kind: "result",
          isError,
          text: isError ? agentErrorText(text) : text,
          sessionId: str(message.session_id),
        },
      ];
    }
    default:
      return [];
  }
}
