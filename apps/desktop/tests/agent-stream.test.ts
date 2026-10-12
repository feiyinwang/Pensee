import { describe, expect, test } from "vite-plus/test";
import { describeToolCall, parseAgentLine } from "../src/lib/agent-stream";
import { buildAgentSystemPrompt } from "../src/lib/agent-context";

const line = (value: unknown) => JSON.stringify(value);

describe("parseAgentLine", () => {
  test("reads the session id from init and ignores hook noise", () => {
    expect(parseAgentLine(line({ type: "system", subtype: "init", session_id: "s1" }))).toEqual([
      { kind: "session", sessionId: "s1" },
    ]);
    expect(
      parseAgentLine(line({ type: "system", subtype: "hook_started", session_id: "s1" })),
    ).toEqual([]);
  });

  test("streams top-level text deltas only", () => {
    const delta = (text: string, parent: string | null = null) =>
      line({
        type: "stream_event",
        parent_tool_use_id: parent,
        event: { type: "content_block_delta", delta: { type: "text_delta", text } },
      });
    expect(parseAgentLine(delta("Hi"))).toEqual([{ kind: "text", text: "Hi" }]);
    expect(parseAgentLine(delta("sub", "toolu_1"))).toEqual([]);
    expect(
      parseAgentLine(
        line({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "input_json_delta" } },
        }),
      ),
    ).toEqual([]);
  });

  test("turns tool calls into one-line labels and drops assistant text blocks", () => {
    const events = parseAgentLine(
      line({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "Let me look." },
            { type: "tool_use", name: "Edit", input: { file_path: "/w/notes/Draft.md" } },
            { type: "tool_use", name: "TodoWrite", input: {} },
          ],
        },
      }),
    );
    expect(events).toEqual([{ kind: "tool", label: "Edited Draft.md" }]);
  });

  test("reports results, success and error", () => {
    expect(
      parseAgentLine(
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Done",
          session_id: "s2",
        }),
      ),
    ).toEqual([{ kind: "result", isError: false, text: "Done", sessionId: "s2" }]);
    expect(
      parseAgentLine(
        line({ type: "result", subtype: "success", is_error: true, result: "Not logged in" }),
      ),
    ).toEqual([{ kind: "result", isError: true, text: "Not logged in", sessionId: null }]);
    expect(
      parseAgentLine(line({ type: "result", subtype: "error_during_execution", errors: ["boom"] })),
    ).toEqual([{ kind: "result", isError: true, text: "boom", sessionId: null }]);
  });

  test("ignores non-JSON lines", () => {
    expect(parseAgentLine("not json")).toEqual([]);
  });
});

describe("describeToolCall", () => {
  test("names the file or pattern once", () => {
    expect(describeToolCall("Read", { file_path: "/a/b/Page.md" })).toBe("Read Page.md");
    expect(describeToolCall("Write", { file_path: "/a/New.md" })).toBe("Wrote New.md");
    expect(describeToolCall("Grep", { pattern: "todo" })).toBe("Searched for “todo”");
    expect(describeToolCall("Glob", { pattern: "**/*.md" })).toBe("Searched **/*.md");
    expect(describeToolCall("mcp__things__todos_create", {})).toBe("Used todos_create");
  });
});

describe("buildAgentSystemPrompt", () => {
  test("names the focused file as 'this' and lists the other tabs", () => {
    const prompt = buildAgentSystemPrompt({
      root: "/w",
      openPaths: ["/w/A.md", "/w/B.md"],
      focusedPath: "/w/B.md",
    });
    expect(prompt).toContain("The user is focused on: /w/B.md");
    expect(prompt).toContain('"This"');
    expect(prompt).toContain("- /w/A.md");
    expect(prompt).not.toContain("- /w/B.md");
    expect(prompt).toContain("short, concise and simple");
  });

  test("has no focus line on a non-file tab", () => {
    const prompt = buildAgentSystemPrompt({ root: "/w", openPaths: [], focusedPath: null });
    expect(prompt).not.toContain("focused on");
    expect(prompt).not.toContain("Other open tabs");
  });
});
