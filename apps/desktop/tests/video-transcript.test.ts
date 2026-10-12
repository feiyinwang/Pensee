import { describe, expect, test } from "vite-plus/test";
import { hasTranscript, transcriptBlock, transcriptParagraphs } from "../src/lib/video-transcript";

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
    const block = transcriptBlock([
      { start: 18.8, text: "We're <no> strangers & friends." },
      { start: 3725, text: "An hour in." },
    ]);
    expect(block).toBe(
      [
        "<details>",
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
    expect(transcriptBlock([{ start: 0, text: "</details>" }])).toContain("&lt;/details&gt;");
  });
});

describe("hasTranscript", () => {
  test("finds the toggle's summary, not the word", () => {
    expect(hasTranscript("<details>\n<summary> transcript </summary>\n</details>")).toBe(true);
    expect(hasTranscript("The transcript says otherwise.")).toBe(false);
  });
});
