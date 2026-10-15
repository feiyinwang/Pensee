import { describe, expect, test } from "vite-plus/test";
import {
  childIndent,
  citationMarkdown,
  citationsIn,
  combineAt,
  combineReply,
  combinedLines,
  connectTerms,
  contentWords,
  echoLine,
  echoQuote,
  echoedNotes,
  echoesReply,
  isNonsenseTake,
  judgeReply,
  itemText,
  newPenId,
  noteForPen,
  organizeReply,
  inTheirWords,
  organizedLines,
  outlineDepth,
  parentOf,
  childrenOf,
  penIdKind,
  penKindOf,
  penLineSlot,
  penPrompt,
  replyLine,
  sealedAbove,
  SIDE_LABEL_AT_START_RE,
  sideLine,
  sidesReply,
  splitPoints,
  subtreeEnd,
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
    expect(penIdKind("ai-g-ab12")).toBe("g");
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
              under: [
                {
                  by: "pen",
                  text: "say it in their words",
                  how: "The opposite",
                  // Deeper than two levels: it sits beside its parent.
                  under: [{ by: "pen", text: "use the words customers use in reviews" }],
                },
              ],
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
      "      - say it in their words — the opposite ^ai-r-0002",
      "      - use the words customers use in reviews ^ai-r-0003",
      "  - measure what brings customers ^ai-r-0004",
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

  test("Combine drops a pen point that says your take again in other words", () => {
    const take =
      "Slow down myself and try to do one anchor and then make the link together, you actually think carefully instead of just skim it";
    const answer = "Slow down yourself: take one anchor at a time and link it before the next.";
    const reply = JSON.stringify({
      points: [
        {
          by: "you",
          text: "Slow down myself",
          under: [
            { by: "pen", text: "Slow down yourself" },
            { by: "you", text: "try to do one anchor" },
            {
              by: "you",
              text: "make the link together",
              under: [{ by: "pen", text: "link each anchor before taking the next" }],
            },
          ],
        },
        { by: "you", text: "you actually think carefully instead of just skim it" },
      ],
    });
    let n = 0;
    expect(combinedLines(combineReply(reply, take, answer), "", () => `ai-r-000${n++}`)).toEqual([
      "- Slow down myself",
      "  - try to do one anchor",
      "  - make the link together",
      "    - link each anchor before taking the next ^ai-r-0000",
      "- you actually think carefully instead of just skim it",
      "- ",
    ]);
  });

  test("Combine never writes your words as the pen's", () => {
    const take = "comes up idea by idea sex, coming up with 10 ideas/day";
    const answer =
      "Notice problems people face. Imagine how to solve them better than existing options do.";
    const flat = (reply: string) =>
      combineReply(reply, take, answer).map((p) => [p.by, p.text, p.under.length]);
    // The pen echoed your take as its points: they go, and its answer stands in.
    const echoed = JSON.stringify({
      points: [
        { by: "you", text: "comes up idea by idea sex" },
        { by: "you", text: "coming up with 10 ideas/day" },
        { by: "pen", text: "Comes up idea by idea sex." },
        { by: "pen", text: "coming up with 10 ideas/day" },
      ],
    });
    expect(flat(echoed)).toEqual([
      ["you", "comes up idea by idea sex", 0],
      ["you", "coming up with 10 ideas/day", 0],
      ["pen", "Notice problems people face", 0],
      ["pen", "Imagine how to solve them better than existing options do", 0],
    ]);
    // One echo among real points: only the echo goes, its points move up.
    const mixed = JSON.stringify({
      points: [
        {
          by: "pen",
          text: "coming up with 10 ideas/day",
          under: [{ by: "you", text: "coming up with 10 ideas/day" }],
        },
        { by: "you", text: "comes up idea by idea sex" },
        { by: "pen", text: "notice problems people face" },
      ],
    });
    expect(flat(mixed)).toEqual([
      ["you", "coming up with 10 ideas/day", 0],
      ["you", "comes up idea by idea sex", 0],
      ["pen", "notice problems people face", 0],
    ]);
  });

  test("a check's two lines name their papers, or no paper; never two opinions", () => {
    const reply =
      '{"claim": true, "lines": [{"label": "Evidence", "paper": 1, "text": "The curve replicates."}, {"label": "Limit", "paper": 0, "text": "One lab, one person."}]}';
    // A claim is always For and Against, whatever the reply called them.
    expect(sidesReply(reply, [paper])).toEqual([
      { label: "For", text: "The curve replicates.", paper },
      { label: "Against", text: "One lab, one person.", paper: null },
    ]);
    // The labels fit what the line asks, not always For and Against.
    expect(
      sidesReply(
        '{"claim": false, "lines": [{"label": "How:", "paper": 1, "text": "Space the reviews."}, {"label": "Caveat", "paper": 0, "text": "Not tested on goals."}]}',
        [paper],
      )?.map((s) => s.label),
    ).toEqual(["How", "Caveat"]);
    const line = (label: string, paperN = 1) =>
      `{"lines": [{"label": "${label}", "paper": ${paperN}, "text": "a"}, {"label": "B", "paper": 0, "text": "b"}]}`;
    expect(
      sidesReply(line("A whole sentence that is far too long to be a label"), [paper]),
    ).toBeNull();
    expect(sidesReply(line(""), [paper])).toBeNull();
    expect(sidesReply(line("A", 0), [paper])).toBeNull();
    expect(sidesReply(line("A", 3), [paper])).toBeNull();
    expect(sidesReply("{}", [paper])).toBeNull();
    expect(
      sidesReply('{"lines": [{"label": "For", "paper": 1, "text": "a"}]}', [paper]),
    ).toBeNull();
    expect(sideLine({ label: "Against", text: "One lab.", paper: null })).toBe("Against: One lab.");
    expect(sideLine({ label: "How", text: "Yes.", paper })).toMatch(
      /^How: Yes\. \[Murre & Dros 2015\]\(/,
    );
  });

  test("a check's label is drawn: a word or two and a colon, never a citation", () => {
    expect(SIDE_LABEL_AT_START_RE.exec("Caveat: small study")?.[0]).toBe("Caveat:");
    expect(SIDE_LABEL_AT_START_RE.exec("如何：先定目标")?.[0]).toBe("如何：");
    expect(SIDE_LABEL_AT_START_RE.exec("[Murre 2015](https://x): y")).toBeNull();
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

describe("organize", () => {
  const yours = [
    "- I think I basically start too many things at once",
    "- no deadline so it drifts",
    "      - the habit app, then nothing",
    "- excitement fades after a week",
    "  - [ ] the boring middle, see [[Auth notes]] ^yt-540",
    "- small scope worked",
    "- small scope worked",
  ];
  const reply = JSON.stringify({
    points: [
      {
        group: "Why I stall:",
        under: [
          {
            group: "How I set it up",
            under: [
              { line: 1, text: "I start too many things at once" },
              { line: 2, text: "no deadline, it drifts", under: [{ line: 3 }] },
            ],
          },
          {
            line: 4,
            text: "excitement fades after a week",
            under: [{ line: 5, text: "the boring middle, see [[Auth notes]]" }],
          },
        ],
      },
      { lines: [6, 7], text: "small scope worked" },
    ],
  });

  test("the prompt numbers your lines with their indentation and asks for no depth limit", () => {
    const prompt = penPrompt({
      title: "T",
      note: "",
      lines: [],
      source: null,
      ask: { task: "organize", lines: yours },
    });
    expect(prompt).toContain('<line n="3">      - the habit app, then nothing</line>');
    expect(prompt).toContain("MECE at every level");
    expect(prompt).toContain("no limit on depth");
    expect(prompt).toContain("Never flatten");
  });

  test("a short tree in your words, as deep as its meaning, every line once", () => {
    const points = organizeReply(reply, yours)!;
    expect(outlineDepth(points)).toBe(4);
    let n = 0;
    expect(organizedLines(points, yours, "", () => `ai-g-000${n++}`)).toEqual([
      "- Why I stall ^ai-g-0000",
      "  - How I set it up ^ai-g-0001",
      "    - I start too many things at once",
      "    - no deadline, it drifts",
      "      - the habit app, then nothing",
      "  - excitement fades after a week",
      "    - [ ] the boring middle, see [[Auth notes]] ^yt-540",
      // A word-for-word repeat goes.
      "- small scope worked",
    ]);
  });

  // The writer's example (2026-10-15): Organize came out one level deep.
  const fruit = [
    "fruit",
    "* apple",
    "* banana",
    "* blueberry",
    "   * benefit of eating blueberry",
    "      * Types of benefits",
    "         * Biomechnical functionalities",
  ];
  const fruitTree = [
    "- fruit",
    "  - apple",
    "  - banana",
    "  - blueberry",
    "    - benefits of eating blueberry",
    "      - types of benefits",
    "        - biomechanical functionalities",
  ];

  test("a branch's lines listed on its top point stay nested under it, never folded in", () => {
    // Its children under a key the prompt didn't ask for.
    const points = organizeReply(
      JSON.stringify({
        points: [
          {
            line: 1,
            text: "fruit",
            children: [
              { line: 2, text: "apple" },
              { line: 3, text: "banana" },
              {
                lines: [4, 5, 6, 7],
                text: "blueberry",
                children: [
                  {
                    line: 5,
                    text: "benefits of eating blueberry",
                    children: [
                      {
                        lines: [6, 7],
                        text: "types of benefits",
                        children: [{ line: 7, text: "biomechanical functionalities" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      fruit,
    )!;
    expect(outlineDepth(points)).toBe(5);
    expect(organizedLines(points, fruit, "", () => "x")).toEqual(fruitTree);
  });

  test("lines a point lists that nothing else places go under it as you nested them", () => {
    const points = organizeReply(
      JSON.stringify({
        points: [
          {
            line: 1,
            under: [{ line: 2 }, { line: 3 }, { lines: [4, 5, 6, 7], text: "blueberry" }],
          },
        ],
      }),
      fruit,
    )!;
    expect(organizedLines(points, fruit, "", () => "x")).toEqual([
      "- fruit",
      "  - apple",
      "  - banana",
      "  - blueberry",
      "    - benefit of eating blueberry",
      "      - Types of benefits",
      "        - Biomechnical functionalities",
    ]);
  });

  test("a point that isn't your words, shorter, is your line as written", () => {
    const points = organizeReply(
      JSON.stringify({
        points: [
          { line: 1, text: "Overcommitting kills momentum" },
          { line: 2, text: "no deadline so it drifts and drifts and drifts away" },
          { line: 5, text: "the boring middle" },
          { line: 3 },
          { line: 4 },
          { lines: [6, 7] },
        ],
      }),
      yours,
    )!;
    expect(organizedLines(points, yours, "", () => "x")).toEqual([
      "- I think I basically start too many things at once",
      "- no deadline so it drifts",
      // A link of yours never goes.
      "- [ ] the boring middle, see [[Auth notes]] ^yt-540",
      "- the habit app, then nothing",
      "- excitement fades after a week",
      "- small scope worked",
    ]);
  });

  test("your words: a word or two may change, never the idea", () => {
    expect(inTheirWords("start too many things", ["- I start too many things at once"])).toBe(true);
    expect(inTheirWords("no deadline, so it drifts", ["- no deadline so it drifts"])).toBe(true);
    expect(inTheirWords("procrastination ruins focus", ["- I start too many things"])).toBe(false);
  });

  test("a repeat with its own block id is kept", () => {
    const lines = ["- a idea ^one-1", "- a idea ^two-2"];
    const points = organizeReply('{"points": [{"lines": [1, 2], "text": "a idea"}]}', lines)!;
    expect(organizedLines(points, lines, "", () => "x")).toEqual([
      "- a idea ^one-1",
      "  - a idea ^two-2",
    ]);
  });

  test("a missing line fails; a repeat is dropped", () => {
    expect(
      organizeReply('{"points": [{"line": 1}, {"line": 2}]}', ["- a", "- b", "- c"]),
    ).toBeNull();
    const points = organizeReply('{"points": [{"line": 1}, {"line": 2}, {"line": 1}]}', [
      "- a",
      "- b",
    ])!;
    expect(organizedLines(points, ["- a", "- b"], "  ", () => "x")).toEqual(["  - a", "  - b"]);
  });

  test("a group of one gives way to its point", () => {
    const points = organizeReply(
      '{"points": [{"group": "Alone", "under": [{"line": 1}]}, {"line": 2}]}',
      ["- a", "- b"],
    )!;
    expect(organizedLines(points, ["- a", "- b"], "", () => "x")).toEqual(["- a", "- b"]);
  });

  test("not JSON is no outline", () => {
    expect(organizeReply("- a\n- b", ["- a", "- b"])).toBeNull();
  });
});
