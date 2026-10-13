import { describe, expect, test } from "vite-plus/test";
import {
  applyCuts,
  childIndent,
  citationMarkdown,
  citationsIn,
  combineAt,
  combineReply,
  combinedLines,
  connectTerms,
  contentWords,
  cutsFromReply,
  echoLine,
  echoQuote,
  echoedNotes,
  echoesReply,
  isNonsenseTake,
  judgeReply,
  isQuestion,
  itemText,
  newPenId,
  noteForPen,
  parentOf,
  childrenOf,
  penIdKind,
  penKindOf,
  penLineSlot,
  penPrompt,
  replyLine,
  sealedAbove,
  sideLine,
  sidesReply,
  splitPoints,
  subtreeEnd,
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
  test("your take sits beside a sealed answer; Combine waits under it once open", () => {
    const lines = ["- Why?", "  - The answer. ^ai-s-ab12", "  - my take", "  - "];
    expect(sealedAbove(lines, 2)).toBe(1);
    expect(sealedAbove(lines, 3)).toBe(-1);
    // Still sealed: nothing to combine yet.
    expect(combineAt(lines, 3)).toBeNull();
    const open = ["- Why?", "  - The answer. ^ai-r-ab12", "  - my take", "  - "];
    expect(sealedAbove(open, 2)).toBe(-1);
    expect(combineAt(open, 3)).toEqual({ answer: 1, take: 2 });
    // Only an empty line right under a take, at its level.
    expect(
      combineAt(["- Why?", "  - The answer. ^ai-r-ab12", "  - my take", "    - "], 3),
    ).toBeNull();
    expect(combineAt(["- Why?", "  - The answer. ^ai-r-ab12", "  - ", "  - "], 3)).toBeNull();
    // Under a paragraph: the plain pen line, your take the bullet after it.
    const para = ["Why?", "", "The answer. ^ai-r-ab12", "- my take", "- "];
    expect(combineAt(para, 4)).toEqual({ answer: 2, take: 3 });
    expect(sealedAbove(["Why?", "", "The answer. ^ai-s-ab12", "- my take"], 3)).toBe(2);
  });

  test("a second answer lands after the first one's take and its empty line", () => {
    const lines = ["- Why?", "  - The answer. ^ai-r-ab12", "  - my take", "  - ", "  - mine"];
    expect(penLineSlot(lines, 0)).toEqual({ kind: "bullet", after: 3, indent: "  " });
    const sealed = ["- Why?", "  - The answer. ^ai-s-ab12", "  - my take", "  - mine"];
    expect(penLineSlot(sealed, 0)).toEqual({ kind: "bullet", after: 2, indent: "  " });
  });

  test("an earlier answer's take is the bullet under it, and it opens to r", () => {
    const lines = ["- Why?", "  - The answer. ^ai-s-ab12", "    - my take", "  - other"];
    expect(sealedAbove(lines, 2)).toBe(1);
    expect(sealedAbove(lines, 1)).toBe(-1);
    expect(sealedAbove(lines, 3)).toBe(-1);
    expect(unsealedLine(lines[1]!)).toBe("  - The answer. ^ai-r-ab12");
    // Once open, the take is an ordinary line.
    expect(sealedAbove(["- Why?", "  - The answer. ^ai-r-ab12", "    - my take"], 2)).toBe(-1);
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

  test("the answer opens only for a real take", () => {
    expect(judgeReply('{"real": false}')).toBe(false);
    expect(judgeReply('Sure. {"real": true}')).toBe(true);
    expect(judgeReply("no json")).toBeNull();
  });

  const TAKE =
    "find a pain point, target that pain point, then think about the scenarios people who have that pain point. explain it in a way that they can understand";
  const ANSWER =
    "Online marketing means reaching your audience where they already spend time, by creating content they find useful, then measuring what brings customers.";

  test("Combine nests by meaning, either way round, and keeps your words", () => {
    const reply = JSON.stringify({
      points: [
        {
          by: "you",
          text: "find a pain point",
          under: [{ by: "pen", text: "watch where people quit or complain" }],
        },
        { by: "you", text: "target that pain point" },
        {
          by: "pen",
          text: "reach your audience where they already spend time",
          under: [
            { by: "you", text: "think about the scenarios people who have that pain point" },
            {
              by: "you",
              text: "explain it in a way that they can understand.",
              // Deeper than one level: it sits beside its parent.
              under: [{ by: "pen", text: "say it in their words", how: "The opposite" }],
            },
          ],
        },
        { by: "pen", text: "measure what brings customers" },
      ],
    });
    let n = 0;
    expect(combinedLines(combineReply(reply, TAKE, ANSWER), "  ", () => `ai-r-000${n++}`)).toEqual([
      "  - find a pain point",
      "    - watch where people quit or complain ^ai-r-0000",
      "  - target that pain point",
      "  - reach your audience where they already spend time ^ai-r-0001",
      "    - think about the scenarios people who have that pain point",
      "    - explain it in a way that they can understand",
      "    - say it in their words — the opposite ^ai-r-0002",
      "  - measure what brings customers ^ai-r-0003",
      "  - ",
    ]);
  });

  test("Combine never puts words in your mouth, nor drops any", () => {
    const flat = (reply: string) =>
      combineReply(reply, TAKE, ANSWER).map((p) => [p.by, p.text, p.under.length]);
    const reworded = JSON.stringify({
      points: [
        { by: "you", text: "identify customer pain", under: [{ by: "pen", text: "reach them" }] },
        { by: "you", text: "target that pain point" },
      ],
    });
    // Reworded: your take split at its punctuation, the pen's points after, unnested.
    expect(flat(reworded)).toEqual([
      ...splitPoints(TAKE).map((t) => ["you", t, 0]),
      ["pen", "reach them", 0],
    ]);
    // Your last point left out: the same.
    const dropped = JSON.stringify({
      points: [
        { by: "you", text: "find a pain point" },
        { by: "you", text: "target that pain point" },
        { by: "pen", text: "reach them" },
      ],
    });
    expect(flat(dropped)).toEqual(flat(reworded));
    // Every pen point was yours already: only yours, which is fine.
    const all = splitPoints(TAKE).map((text) => ({ by: "you", text }));
    expect(combineReply(JSON.stringify({ points: all }), TAKE, ANSWER)).toHaveLength(4);
    // No reply at all: both are split at their punctuation.
    expect(
      combineReply("", TAKE, ANSWER)
        .filter((p) => p.by === "pen")
        .map((p) => p.text),
    ).toEqual(splitPoints(ANSWER));
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
