import { describe, expect, test } from "vite-plus/test";
import { describeToolCall, parseAgentLine } from "../src/lib/agent-stream";
import { buildAgentSystemPrompt, MAX_FILE_CHARS, MAX_TOTAL_CHARS } from "../src/lib/agent-context";
import { embeddedBoardPaths, isBoardPath } from "../src/lib/agent-open-files";

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
  test("includes every open tab's text and names the focused one", () => {
    const prompt = buildAgentSystemPrompt({
      root: "/w",
      openFiles: [
        { path: "/w/A.md", text: "users roll left to right" },
        { path: "/w/B.md", text: "dopamine" },
      ],
      focusedPath: "/w/B.md",
    });
    expect(prompt).toContain("The tab in front of the user is: /w/B.md");
    expect(prompt).toContain('<open_file path="/w/A.md">\nusers roll left to right');
    expect(prompt).toContain('<open_file path="/w/B.md">\ndopamine');
    // Focused tab comes first so a length cut never drops it.
    expect(prompt.indexOf('/w/B.md">')).toBeLessThan(prompt.indexOf('/w/A.md">'));
    expect(prompt).toContain("short, concise and simple");
  });

  test("truncates long files and lists what didn't fit", () => {
    const big = "x".repeat(MAX_FILE_CHARS + 10);
    const files = Array.from({ length: 8 }, (_, i) => ({ path: `/w/${i}.md`, text: big }));
    const prompt = buildAgentSystemPrompt({ root: "/w", openFiles: files, focusedPath: null });
    expect(prompt).toContain("[…truncated; read the file for the rest]");
    expect(prompt).toContain("Also open (not included for length");
    expect(prompt.length).toBeLessThan(MAX_TOTAL_CHARS + 10_000);
  });

  test("has no focus line on a non-file tab", () => {
    const prompt = buildAgentSystemPrompt({ root: "/w", openFiles: [], focusedPath: null });
    expect(prompt).not.toContain("in front of the user is");
  });
});

describe("embeddedBoardPaths", () => {
  test("finds board image links relative to the page", () => {
    const text = "Intro\n![Board](assets/flow.board.svg)\n![pic](a.png)\n![](<my board.board.svg>)";
    expect(embeddedBoardPaths("/w/notes/Page.md", text)).toEqual([
      "/w/notes/assets/flow.board.svg",
      "/w/notes/my board.board.svg",
    ]);
    expect(isBoardPath("/w/x.board.svg")).toBe(true);
    expect(isBoardPath("/w/x.svg")).toBe(false);
  });
});

describe("buildAgentSystemPrompt period notes", () => {
  test("includes the current period notes, broadest first, and points at open ones", () => {
    const prompt = buildAgentSystemPrompt({
      root: "/vault",
      openFiles: [{ path: "/vault/2026-W42.md", text: "week plan" }],
      focusedPath: null,
      periodNotes: [
        { kind: "year", path: "/vault/2026.md", text: "Ship Writer 1.0" },
        { kind: "week", path: "/vault/2026-W42.md", text: null },
        { kind: "day", path: "/vault/2026-10-12.md", text: "Calendar panel" },
      ],
    });
    expect(prompt).toContain('<period_note period="year" path="/vault/2026.md">\nShip Writer 1.0');
    expect(prompt).toContain(
      '<period_note period="week" path="/vault/2026-W42.md" open_tab="true" />',
    );
    expect(prompt.indexOf('period="year"')).toBeLessThan(prompt.indexOf('period="day"'));
  });

  test("says nothing about period notes when there are none", () => {
    const prompt = buildAgentSystemPrompt({ root: "/vault", openFiles: [], focusedPath: null });
    expect(prompt).not.toContain("period_note");
  });
});
