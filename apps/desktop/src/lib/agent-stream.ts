/**
 * Claude Code `--output-format stream-json` line → chat events. Pure, so the
 * chat's view of a run can be tested without a process. Text comes from the
 * partial-message deltas (so it streams); tool calls come from the complete
 * assistant messages (so their input is whole). Everything else — hooks,
 * init noise, tool results — is dropped: the chat shows replies, not a log.
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

/** Claude Code's sign-in failed (expired, revoked or missing): the raw API
 *  error is JSON, so say what to do instead. */
const SIGNED_OUT_RE = /\bauthenticat|\b401\b|oauth|not logged in|\/login\b/i;
export const SIGNED_OUT_TEXT =
  "Claude is signed out. Run `claude` in Terminal, type /login, then try again.";

/** An error from Claude Code, readable: a sign-in failure says how to fix it. */
export function agentErrorText(text: string): string {
  return SIGNED_OUT_RE.test(text) ? SIGNED_OUT_TEXT : text;
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

export function parseAgentLine(line: string): AgentStreamEvent[] {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObject(message)) return [];

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
