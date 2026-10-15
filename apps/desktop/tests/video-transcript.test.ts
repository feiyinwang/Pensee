import { describe, expect, test } from "vite-plus/test";
import {
  hasTranscript,
  lineAt,
  linesAround,
  transcriptBlock,
  transcriptLanguageIn,
  transcriptRange,
  transcriptLines,
  transcriptParagraphs,
  transcriptText,
} from "../src/lib/video-transcript";

describe("transcriptParagraphs", () => {
  test("closes a paragraph at the first sentence end past 45s", () => {
    const cues = [
      { start: 0, text: "Hello there." },
      { start: 20, text: "A sentence that runs" },
      { start: 46, text: "on and ends here." },
      { start: 50, text: "Next paragraph." },
    ];
    expect(transcriptParagraphs(cues)).toEqual([
      { start: 0, text: "Hello there. A sentence that runs on and ends here." },
      { start: 50, text: "Next paragraph." },
    ]);
  });

  test("closes at 90s when captions have no full stops", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({ start: i * 20, text: `word ${i}` }));
    const paragraphs = transcriptParagraphs(cues);
    expect(paragraphs.map((p) => p.start)).toEqual([0, 100]);
  });

  test("nothing in, nothing out", () => {
    expect(transcriptParagraphs([])).toEqual([]);
  });
});

describe("transcriptBlock", () => {
  test("a closed toggle with timed, escaped paragraphs and no blank line", () => {
    const block = transcriptBlock(
      [
        { start: 18.8, text: "We're <no> strangers & friends." },
        { start: 3725, text: "An hour in." },
      ],
      "en",
    );
    expect(block).toBe(
      [
        '<details lang="en">',
        "<summary>Transcript</summary>",
        "<p><small>0:18</small> We're &lt;no&gt; strangers &amp; friends.</p>",
        "<p><small>1:02:05</small> An hour in.</p>",
        "</details>",
      ].join("\n"),
    );
    expect(block).not.toMatch(/\n\s*\n/);
    expect(hasTranscript(`intro\n\n${block}\n`)).toBe(true);
  });

  test("a closing details tag in the captions can't end the toggle", () => {
    expect(transcriptBlock([{ start: 0, text: "</details>" }], "en")).toContain("&lt;/details&gt;");
  });
});

describe("transcript language and range", () => {
  test("the block keeps its caption language; an older one has none", () => {
    expect(transcriptLanguageIn(transcriptBlock([{ start: 0, text: "Hola." }], "es-419"))).toBe(
      "es-419",
    );
    expect(transcriptLanguageIn("<details>\n<summary>Transcript</summary>\n</details>")).toBe(null);
  });

  test("finds the whole toggle, with or without a language, and nothing else", () => {
    const block = transcriptBlock([{ start: 0, text: "Hi." }], "en");
    const body = `<details>\n<summary>Notes</summary>\n</details>\n\n${block}\n\n- after`;
    const range = transcriptRange(body)!;
    expect(body.slice(range.from, range.to)).toBe(block);
    const older = "<details>\n<summary>Transcript</summary>\n<p>x</p>\n</details>\n- after";
    expect(transcriptRange(older)).toEqual({ from: 0, to: older.indexOf("\n- after") });
    expect(transcriptRange("- nothing")).toBe(null);
  });
});

describe("hasTranscript", () => {
  test("finds the toggle's summary, not the word", () => {
    expect(hasTranscript("<details>\n<summary> transcript </summary>\n</details>")).toBe(true);
    expect(hasTranscript("The transcript says otherwise.")).toBe(false);
  });
});

describe("transcriptLines", () => {
  test("one line per sentence, timed by where it falls in the paragraph", () => {
    const lines = transcriptLines([
      { start: 0, text: "First sentence is here. Second sentence goes here." },
      { start: 60, text: "Next paragraph starts now." },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "First sentence is here.",
      "Second sentence goes here.",
      "Next paragraph starts now.",
    ]);
    expect(lines[0]!.start).toBe(0);
    // 23 of 49 letters in: just under half of the paragraph's minute.
    expect(lines[1]!.start).toBeCloseTo((60 * 23) / 49);
    expect(lines[0]!.end).toBe(lines[1]!.start);
    expect(lines[1]!.end).toBe(60);
    expect(lines[2]!.start).toBe(60);
    expect(lines[2]!.end).toBeGreaterThan(60);
  });

  test("short sentences join the next one", () => {
    const lines = transcriptLines([{ start: 0, text: "Yes. Okay. That is a fair point to make." }]);
    expect(lines.map((l) => l.text)).toEqual(["Yes. Okay. That is a fair point to make."]);
  });

  test("captions with no full stops are cut into even slices", () => {
    const text = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const lines = transcriptLines([{ start: 10, text }]);
    expect(lines.map((l) => l.text.split(" ").length)).toEqual([17, 17, 16]);
    expect(lines[0]!.start).toBe(10);
  });
});

describe("lineAt", () => {
  const lines = [
    { start: 0, end: 5, text: "a" },
    { start: 5, end: 9, text: "b" },
    { start: 9, end: 12, text: "c" },
  ];
  test("the last line started by then", () => {
    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 4.9)).toBe(0);
    expect(lineAt(lines, 5)).toBe(1);
    expect(lineAt(lines, 100)).toBe(2);
  });
  test("the first line before the start, -1 with none", () => {
    expect(lineAt(lines, -3)).toBe(0);
    expect(lineAt([], 3)).toBe(-1);
  });
  test("linesAround keeps what overlaps the window", () => {
    expect(linesAround(lines, 9, 3, 0).map((l) => l.text)).toEqual(["b", "c"]);
  });
});

describe("transcriptText", () => {
  test("each paragraph after its time, blank line between", () => {
    expect(
      transcriptText([
        { start: 0, text: "Hi." },
        { start: 75, text: "Then." },
      ]),
    ).toBe("0:00 Hi.\n\n1:15 Then.");
  });
});
