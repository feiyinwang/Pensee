import { describe, expect, test } from "vite-plus/test";
import { describeToolCall, parseAgentLine, SIGNED_OUT_TEXT } from "../src/lib/agent-stream";
import {
  buildAgentInstructions,
  buildAgentMessage,
  buildScreenContext,
  MAX_TOTAL_CHARS,
  SHORT_FILE_CHARS,
} from "../src/lib/agent-context";
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

  test("a revoked sign-in says how to sign in, not the API's JSON", () => {
    const result = (text: string) =>
      parseAgentLine(line({ type: "result", subtype: "success", is_error: true, result: text }));
    expect(
      result(
        'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token has been revoked."}}',
      ),
    ).toEqual([{ kind: "result", isError: true, text: SIGNED_OUT_TEXT, sessionId: null }]);
    // Other errors stay as they are.
    expect(result("Overloaded")).toEqual([
      { kind: "result", isError: true, text: "Overloaded", sessionId: null },
    ]);
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
    ).toEqual([{ kind: "result", isError: true, text: SIGNED_OUT_TEXT, sessionId: null }]);
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

describe("buildAgentInstructions", () => {
  test("names the workspace and the per-message context, and asks for short replies", () => {
    const instructions = buildAgentInstructions("/w");
    expect(instructions).toContain("Workspace: /w");
    expect(instructions).toContain("<pensee_context>");
    expect(instructions).toContain("short, concise and simple");
  });
});

describe("buildAgentMessage", () => {
  test("puts the screen first, then what the user typed", () => {
    const message = buildAgentMessage(
      { openFiles: [{ path: "/w/A.md", text: "hi" }], focusedPath: "/w/A.md" },
      "Define junior",
    );
    expect(message).toMatch(/^<pensee_context>\nThe tab in front of the user is: \/w\/A\.md/);
    expect(message.endsWith("</pensee_context>\n\nDefine junior")).toBe(true);
  });

  test("says so when nothing is open", () => {
    expect(buildScreenContext({ openFiles: [], focusedPath: null })).toBe(
      "No pages or books are open.",
    );
  });
});

describe("buildScreenContext", () => {
  test("says where an open note's video is and what was said around then", () => {
    const prompt = buildScreenContext({
      openFiles: [],
      focusedPath: null,
      videos: [{ notePath: "/w/Talk.md", at: "12:04", text: "11:58 Speech is motor." }],
    });
    expect(prompt).toContain(
      '<video_moment note="/w/Talk.md" at="12:04">\n11:58 Speech is motor.\n</video_moment>',
    );
  });

  test("includes every open tab's text and names the focused one", () => {
    const prompt = buildScreenContext({
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
  });

  test("sends a long file only as its lines on screen, and lists one off screen", () => {
    const long = Array.from({ length: 2_000 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(long.length).toBeGreaterThan(SHORT_FILE_CHARS);
    const prompt = buildScreenContext({
      openFiles: [
        {
          path: "/w/Book.md",
          text: long,
          visible: { fromLine: 99, toLine: 102, text: "line 100\nline 101\nline 102" },
        },
        { path: "/w/Other.md", text: long },
      ],
      focusedPath: "/w/Book.md",
    });
    expect(prompt).toContain(
      '<open_file path="/w/Book.md" on_screen="lines 100-102 of 2000">\nline 100\nline 101\nline 102\n[only the part on screen',
    );
    expect(prompt).not.toContain("line 99\n");
    expect(prompt).not.toContain('<open_file path="/w/Other.md"');
    expect(prompt).toContain(
      "Also open (not included for length; read when relevant):\n- /w/Other.md",
    );
  });

  test("stops adding files at the total cap and lists what didn't fit", () => {
    const page = "x".repeat(SHORT_FILE_CHARS);
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `/w/${i}.md`, text: page }));
    const prompt = buildScreenContext({ openFiles: files, focusedPath: null });
    expect(prompt).toContain("Also open (not included for length");
    expect(prompt).toContain("- /w/11.md");
    expect(prompt.length).toBeLessThan(MAX_TOTAL_CHARS + 10_000);
  });

  test("has no focus line on a non-file tab", () => {
    const prompt = buildScreenContext({ openFiles: [], focusedPath: null });
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

describe("buildScreenContext period notes", () => {
  test("includes the current period notes, broadest first, and points at open ones", () => {
    const prompt = buildScreenContext({
      openFiles: [{ path: "/vault/2026-W42.md", text: "week plan" }],
      focusedPath: null,
      periodNotes: [
        { kind: "year", path: "/vault/2026.md", text: "Ship Pensée 1.0" },
        { kind: "week", path: "/vault/2026-W42.md", text: null },
        { kind: "day", path: "/vault/2026-10-12.md", text: "Calendar panel" },
      ],
    });
    expect(prompt).toContain('<period_note period="year" path="/vault/2026.md">\nShip Pensée 1.0');
    expect(prompt).toContain(
      '<period_note period="week" path="/vault/2026-W42.md" open_tab="true" />',
    );
    expect(prompt.indexOf('period="year"')).toBeLessThan(prompt.indexOf('period="day"'));
  });

  test("points at a long period note instead of including it", () => {
    const prompt = buildScreenContext({
      openFiles: [],
      focusedPath: null,
      periodNotes: [
        { kind: "month", path: "/vault/2026-10.md", text: "y".repeat(SHORT_FILE_CHARS + 1) },
      ],
    });
    expect(prompt).toContain('<period_note period="month" path="/vault/2026-10.md" long="true" />');
    expect(prompt).not.toContain("yyyy");
  });

  test("says nothing about period notes when there are none", () => {
    const prompt = buildScreenContext({ openFiles: [], focusedPath: null });
    expect(prompt).not.toContain("period_note");
  });
});
