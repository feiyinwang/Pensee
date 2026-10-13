import { describe, expect, test } from "vite-plus/test";
import {
  answerStep,
  applyCuts,
  childIndent,
  citationMarkdown,
  citationsIn,
  cutsFromReply,
  factReply,
  itemText,
  newPenId,
  noteForPen,
  parentOf,
  childrenOf,
  penIdKind,
  penKindOf,
  penLineSlot,
  penPrompt,
  questionAbove,
  replyLine,
  subtreeEnd,
  unansweredSiblingMixes,
  videoPassages,
} from "../src/lib/second-pen";
import type { Paper } from "../src/lib/tauri";
import { transcriptBlock, transcriptIn } from "../src/lib/video-transcript";

const paper: Paper = {
  title: "Replication and analysis of Ebbinghaus' forgetting curve",
  authors: ["Jaap Murre", "Joeri Dros"],
  year: 2015,
  date: "2015-07-06",
  venue: "PLOS ONE",
  citedBy: 600,
  url: "https://doi.org/10.1371/journal.pone.0120644",
  abstractText: "We present a successful replication of Ebbinghaus' classic forgetting curve.",
};

describe("ids", () => {
  test("a new id names its kind and is unique", () => {
    let n = 0;
    const random = () => [0, 0, 0.5][n++]!;
    const id = newPenId("q", new Set(["ai-q-0000"]), random);
    expect(id).not.toBe("ai-q-0000");
    expect(penIdKind(id)).toBe("q");
    expect(penIdKind("yt-540")).toBeNull();
    expect(penIdKind("ai-r-ab12")).toBe("r");
    expect(penKindOf("  - Why? ^ai-m-ab12")).toBe("m");
    expect(penKindOf("- my note ^yt-540")).toBeNull();
  });
});

describe("outline", () => {
  const lines = [
    "- forgetting curve ^yt-250", // 0
    "  - Why does it drop fastest at first? ^ai-q-aaaa", // 1
    "    - my answer", // 2
    "  - but why ^ai-m-bbbb", // 3
    "  - my own child note", // 4
    "- next note", // 5
  ];

  test("a child bullet sits at its parent's text column", () => {
    expect(childIndent("- note")).toBe("  ");
    expect(childIndent("1. note")).toBe("   ");
    expect(childIndent("  - [ ] task")).toBe("    ");
    expect(childIndent("A paragraph")).toBe("");
  });

  test("a line's words have no marker and no id", () => {
    expect(itemText(lines[1]!)).toBe("Why does it drop fastest at first?");
    expect(itemText("  - ")).toBe("");
  });

  test("subtrees end where the indent comes back", () => {
    expect(subtreeEnd(lines, 0)).toBe(4);
    expect(subtreeEnd(lines, 1)).toBe(2);
    expect(subtreeEnd(lines, 5)).toBe(5);
  });

  test("under a bullet the pen writes a sub-bullet, after its own ones", () => {
    expect(penLineSlot(lines, 0)).toEqual({ kind: "bullet", after: 3, indent: "  " });
    expect(penLineSlot(lines, 5)).toEqual({ kind: "bullet", after: 5, indent: "  " });
    expect(penLineSlot(lines, 2)).toEqual({ kind: "bullet", after: 2, indent: "      " });
  });

  test("under a paragraph or heading the pen writes a plain line below", () => {
    const para = ["A thought", "on two lines.", "", "Why? ^ai-a-cccc", "- my answer", "", "Next."];
    expect(penLineSlot(para, 0)).toEqual({ kind: "line", after: 4, blankAfter: false });
    expect(penLineSlot(["# Heading", "Text"], 0)).toEqual({
      kind: "line",
      after: 0,
      blankAfter: true,
    });
    expect(penLineSlot(["Last line"], 0)).toEqual({ kind: "line", after: 0, blankAfter: false });
  });

  test("the bullets right after a plain pen line are its answers", () => {
    const para = ["Why? ^ai-q-cccc", "- my answer", "  - “…” — 1:10 ^ai-c-dddd", "- more"];
    expect(parentOf(para, 1)).toBe(0);
    expect(childrenOf(para, 0)).toEqual([1, 3]);
    expect(subtreeEnd(para, 0)).toBe(3);
    expect(parentOf(["Just text", "- a bullet"], 1)).toBe(-1);
  });

  test("an answer belongs to the question above it", () => {
    expect(questionAbove(lines, 2)).toBe(1);
    expect(questionAbove(lines, 4)).toBeNull();
  });
});

describe("answer flow", () => {
  test("an empty first answer asks for a hint, then the check", () => {
    const lines = ["- note", "  - Q? ^ai-q-aaaa", "    - "];
    expect(answerStep(lines, 2)).toEqual({ question: 1, step: "hint" });
    // The hint hangs under the answer that asked for it.
    const hinted = [
      "- note",
      "  - Q? ^ai-q-aaaa",
      "    - I don't know",
      "      - Hint: … ^ai-h-bbbb",
      "    - ",
    ];
    expect(answerStep(hinted, 4)).toEqual({ question: 1, step: "check" });
  });

  test("a written answer is checked, once", () => {
    const lines = ["- Q? ^ai-q-aaaa", "  - rereaders first"];
    expect(answerStep(lines, 1)).toEqual({ question: 0, step: "check" });
    const checked = [...lines, "    - “…” — 9:00 ^ai-c-cccc", "  - more"];
    expect(answerStep(checked, 3)).toBeNull();
  });

  test("a question about your thinking is never checked", () => {
    expect(answerStep(["- Why? ^ai-a-aaaa", "  - because"], 1)).toBeNull();
  });

  test("keeping a plain mix drops the unanswered plain ones around it", () => {
    const lines = [
      "An idea.",
      "",
      "× one ^ai-m-aaaa",
      "",
      "× two ^ai-m-bbbb",
      "- liked",
      "",
      "× three ^ai-m-cccc",
      "",
      "Other.",
    ];
    expect(unansweredSiblingMixes(lines, 2)).toEqual([7]);
  });

  test("keeping a mix drops the unanswered ones beside it", () => {
    const lines = [
      "- idea",
      "  - × one ^ai-m-aaaa",
      "  - × two ^ai-m-bbbb",
      "    - I like this",
      "  - × three ^ai-m-cccc",
      "  - mine",
    ];
    expect(unansweredSiblingMixes(lines, 1)).toEqual([4]);
  });
});

describe("source", () => {
  test("the transcript comes back from the note", () => {
    const block = transcriptBlock([
      { start: 0, text: "Hello & welcome." },
      { start: 50, text: "Rereading feels like knowing." },
    ]);
    expect(transcriptIn(`Intro\n\n${block}\n\n- note`)).toEqual([
      { start: 0, text: "Hello & welcome." },
      { start: 50, text: "Rereading feels like knowing." },
    ]);
  });

  test("only what was watched, nearest the line's moment first to fit", () => {
    const cues = [
      { start: 0, text: "a" },
      { start: 60, text: "b" },
      { start: 120, text: "c" },
    ];
    expect(videoPassages(cues, 90, null)).toEqual([
      { where: "0:00", text: "a" },
      { where: "1:00", text: "b" },
    ]);
  });

  test("the note the pen reads: no transcript, pins as times, its lines marked", () => {
    const body = `${transcriptBlock([{ start: 0, text: "x" }])}\n\n- note ^yt-540\n  - Q? ^ai-q-aaaa`;
    expect(noteForPen(body)).toBe("- note [at 9:00]\n  - [pen] Q?");
  });
});

describe("prompts and replies", () => {
  test("a quiz prompt carries the source and what was asked", () => {
    const prompt = penPrompt({
      title: "How we remember",
      note: "- note",
      lines: ["note"],
      source: {
        kind: "video",
        label: "the video",
        passages: [{ where: "9:00", text: "Recall wins." }],
      },
      ask: { task: "quiz", already: ["Who won?"], newTopic: false, focus: "9:00" },
    });
    expect(prompt).toContain("[9:00] Recall wins.");
    expect(prompt).toContain("- Who won?");
    expect(prompt).toContain("at 9:00");
  });

  test("an answer to your question comes from the source, with where", () => {
    const prompt = penPrompt({
      title: "How we remember",
      note: "- what did the study compare?",
      lines: ["what did the study compare?"],
      source: {
        kind: "video",
        label: "the video",
        passages: [{ where: "1:10", text: "Reread vs recall." }],
      },
      ask: { task: "answer", already: [] },
    });
    expect(prompt).toContain("[1:10] Reread vs recall.");
    expect(prompt).toContain("When the video covers it");
  });

  test("a reply is one clean line, or nothing", () => {
    expect(replyLine("- “Why does it?”\n")).toBe("Why does it?");
    expect(replyLine("NONE")).toBeNull();
    expect(replyLine("It compared rereading and recall — 1:10.")).toBe(
      "It compared rereading and recall — 1:10",
    );
    expect(replyLine("“Recall wins.” — 9:00", true)).toBe("“Recall wins.” — 9:00");
  });

  test("a fact names its paper", () => {
    expect(factReply('{"paper": 1, "fact": "The curve replicates."}', [paper])).toEqual({
      fact: "The curve replicates.",
      paper,
    });
    expect(factReply('{"paper": 0}', [paper])).toBeNull();
    expect(factReply("no json", [paper])).toBeNull();
  });

  test("a citation is a link that keeps the paper's details", () => {
    const markdown = citationMarkdown(paper);
    expect(
      markdown.startsWith("[Murre & Dros 2015](https://doi.org/10.1371/journal.pone.0120644 "),
    ).toBe(true);
    const [cite] = citationsIn(`The curve replicates. ${markdown} ^ai-f-aaaa`);
    expect(cite).toMatchObject({
      label: "Murre & Dros 2015",
      url: paper.url,
      venue: "PLOS ONE 2015",
      citedBy: "cited by 600",
    });
  });
});

describe("shorten", () => {
  test("only substrings that are there, in order, without overlaps", () => {
    const text = "I think we basically need a hint, maybe";
    const cuts = cutsFromReply('[["I think ", " basically", "absent", "I think we"]]', [text]);
    expect(cuts).toEqual([
      [
        { from: 0, to: 8 },
        { from: 10, to: 20 },
      ],
    ]);
    expect(applyCuts(text, cuts![0]!)).toBe("we need a hint, maybe");
  });

  test("tidy spacing where words left", () => {
    expect(applyCuts("hint before giving up completely, like", [{ from: 21, to: 32 }])).toBe(
      "hint before giving up, like",
    );
  });

  test("an unreadable reply is null", () => {
    expect(cutsFromReply("sorry", ["x"])).toBeNull();
  });
});
