import { describe, expect, test } from "vite-plus/test";
import {
  applyCuts,
  childIndent,
  citationMarkdown,
  citationsIn,
  compareReply,
  connectTerms,
  contentWords,
  cutsFromReply,
  echoLine,
  echoQuote,
  echoedNotes,
  echoesReply,
  isNonsenseTake,
  isQuestion,
  itemText,
  newPenId,
  noteForPen,
  parentOf,
  childrenOf,
  penIdKind,
  penKindOf,
  penLabelEnd,
  penLineSlot,
  penPrompt,
  replyLine,
  sealedAbove,
  sideLine,
  sidesReply,
  subtreeEnd,
  unansweredSiblings,
  uncuttable,
  unsealedLine,
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
});

describe("answer flow", () => {
  test("your take is the bullet under a sealed answer, and it opens to r", () => {
    const lines = ["- Why?", "  - The answer. ^ai-s-ab12", "    - my take", "  - other"];
    expect(sealedAbove(lines, 2)).toBe(1);
    expect(sealedAbove(lines, 1)).toBe(-1);
    expect(sealedAbove(lines, 3)).toBe(-1);
    expect(unsealedLine(lines[1]!)).toBe("  - The answer. ^ai-r-ab12");
    // Once open, the take is an ordinary line.
    expect(sealedAbove(["- Why?", "  - The answer. ^ai-r-ab12", "    - my take"], 2)).toBe(-1);
  });

  test("keeping an echo drops the unanswered ones beside it", () => {
    const lines = [
      "- idea",
      "  - “one” — [[A]] · same idea ^ai-e-aaaa",
      "  - “two” — [[B]] · another angle ^ai-e-bbbb",
      "    - they connect because",
      "  - “three” — [[C]] · you tried it ^ai-e-cccc",
      "  - For: x ^ai-p-dddd",
    ];
    expect(unansweredSiblings(lines, 1, "e")).toEqual([4]);
  });

  test("keeping a plain echo drops the unanswered plain ones around it", () => {
    const lines = [
      "An idea.",
      "",
      "“one” — [[A]] · same idea ^ai-e-aaaa",
      "",
      "“two” — [[B]] · same idea ^ai-e-bbbb",
      "- liked",
      "",
      "“three” — [[C]] · same idea ^ai-e-cccc",
      "",
      "Other.",
    ];
    expect(unansweredSiblings(lines, 2, "e")).toEqual([7]);
  });

  test("a line ending in a question mark is a question, not a claim", () => {
    expect(isQuestion("Why do I never finish side projects?")).toBe(true);
    expect(isQuestion("为什么？")).toBe(true);
    expect(isQuestion("Caffeine helps (I think?) a lot")).toBe(false);
  });

  test("a take with no word in it is nobody's guess", () => {
    expect(isNonsenseTake(".,;; 123")).toBe(true);
    expect(isNonsenseTake("boredom")).toBe(false);
    expect(isNonsenseTake("无聊")).toBe(false);
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
  test("only an answer reads the source", () => {
    const source = {
      kind: "video" as const,
      label: "the video",
      passages: [{ where: "9:00", text: "Recall wins." }],
    };
    const base = { title: "T", note: "- note", lines: ["note"], source };
    expect(penPrompt({ ...base, ask: { task: "answer", already: [] } })).toContain("[9:00]");
    expect(penPrompt({ ...base, ask: { task: "factQuery" } })).not.toContain("[9:00]");
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

  test("a comparison only comes for a real take", () => {
    expect(compareReply('{"real": false}')).toEqual({ real: false });
    expect(compareReply('{"real": true, "compare": "Yours has the boredom part."}')).toEqual({
      real: true,
      text: "Yours has the boredom part.",
    });
    expect(compareReply("no json")).toBeNull();
  });

  test("both sides name their papers, or no paper; never two opinions", () => {
    const reply =
      '{"for": {"paper": 1, "text": "The curve replicates."}, "against": {"paper": 0, "text": "One lab, one person."}}';
    expect(sidesReply(reply, [paper])).toEqual({
      pro: { text: "The curve replicates.", paper },
      con: { text: "One lab, one person.", paper: null },
    });
    expect(
      sidesReply('{"for": {"paper": 0, "text": "a"}, "against": {"paper": 0, "text": "b"}}', [
        paper,
      ]),
    ).toBeNull();
    expect(sidesReply("{}", [paper])).toBeNull();
    expect(
      sidesReply('{"for": {"paper": 3, "text": "a"}, "against": {"paper": 1, "text": "b"}}', [
        paper,
      ]),
    ).toBeNull();
    expect(sideLine("Against", { text: "One lab.", paper: null })).toBe("Against: One lab.");
    expect(sideLine("For", { text: "Yes.", paper })).toMatch(/^For: Yes\. \[Murre & Dros 2015\]\(/);
  });

  test("connect: search words, picked echoes, and the echo line", () => {
    expect(connectTerms('["dopamine", "reward", "ok", "reward"]')).toEqual(["dopamine", "reward"]);
    expect(connectTerms("nope")).toEqual([]);
    expect(contentWords(["naps help you remember what you studied", "Naps!"])).toEqual([
      "naps",
      "help",
      "remember",
      "studied",
    ]);
    expect(
      echoesReply(
        '[{"n": 2, "label": "supports"}, {"n": 2, "label": "Summary"}, {"n": 9, "label": "Example"}, {"n": 1, "label": "made up"}]',
        3,
      ),
    ).toEqual([{ index: 1, label: "Supports", point: null }]);
    const [long] = echoesReply(
      `[{"n": 1, "label": "Example", "point": "${"word ".repeat(50)}"}]`,
      1,
    );
    expect(long!.point!.split(" ").length).toBe(32);
    expect(long!.point!.endsWith("…")).toBe(true);
    expect(echoQuote("  - [ ] A reward after every chapter. ^abc123")).toBe(
      "A reward after every chapter.",
    );
    expect(echoQuote(`## ${"word ".repeat(60)}`).endsWith("…")).toBe(true);
    expect(echoQuote("<p><small>1:10</small> Recall won.</p>")).toBe("1:10 Recall won.");
    expect(
      echoLine(
        { index: 0, label: "Supports", point: "You felt flat after an hour of scrolling." },
        "After an hour of scrolling I feel flat, not bored, like the colour went out of things.",
        "Why I quit Twitter",
      ),
    ).toBe("Supports: You felt flat after an hour of scrolling. — [[Why I quit Twitter]]");
    expect(penLabelEnd("Supports: You felt flat. — [[A]]")).toBe(9);
    expect(penLabelEnd("Another angle: x")).toBe(14);
    expect(penLabelEnd("Notes: x")).toBeNull();
    // Without a point, a short quote stands in.
    expect(
      echoLine({ index: 0, label: "Summary", point: null }, "x ".repeat(80), "N").length,
    ).toBeLessThan(120);
    expect(
      echoedNotes(["- Example: You slept. — [[Sleep log]] ^ai-e-aaaa", "- [[A#^b|alias]] x"]),
    ).toEqual(new Set(["Sleep log", "A"]));
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

  test("never cuts an id, a link or a citation", () => {
    const text = "Supports: you really slept well — [[Sleep log]] · another angle ^ai-e-jjfohink";
    const cuts = cutsFromReply(
      '[[" really", "[[Sleep log]]", " ^ai-e-jjfohink", "Sleep", "[link](https://x.org)"]]',
      [text],
    );
    expect(cuts![0]!.map((c) => text.slice(c.from, c.to))).toEqual([" really"]);
    expect(uncuttable('a [p](https://x.org "t") b ^id-1').map((c) => [c.from, c.to])).toEqual([
      [2, 24],
      [27, 32],
    ]);
  });
});
