import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { formatClock, recordingStem, talkHeadingTime } from "../src/lib/talk/clock";
import { talkInsertion } from "../src/lib/talk/insert-talk";
import { meterLevel } from "../src/lib/talk/recorder";
import { parseWikiAudioEmbedTarget, parseWikiVideoEmbedTarget } from "../src/lib/wiki-links";

describe("talk clock", () => {
  test("formats times for the player and the transcript", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75.9)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  test("names a take by its date and time, with no colon", () => {
    const at = new Date(2026, 9, 25, 9, 4);
    expect(recordingStem(at)).toBe("2026-10-25 09.04");
    expect(talkHeadingTime(at)).toBe("09:04");
  });
});

describe("talk meter", () => {
  test("speech fills most of the meter; room noise leaves it empty", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.001)).toBe(0); // -60 dB, a quiet room
    expect(meterLevel(0.03)).toBeGreaterThan(0.5); // -30 dB, talking
    expect(meterLevel(0.03)).toBeLessThan(meterLevel(0.1));
    expect(meterLevel(0.5)).toBe(1);
  });
});

describe("audio embeds", () => {
  test("audio files and takes in Recordings/ are audio, other videos stay video", () => {
    expect(parseWikiAudioEmbedTarget("Recordings/2026-10-25 09.14.m4a")).toEqual({
      path: "Recordings/2026-10-25 09.14.m4a",
    });
    expect(parseWikiAudioEmbedTarget("song.mp3")).toEqual({ path: "song.mp3" });
    expect(parseWikiAudioEmbedTarget("Recordings/take.webm")).toEqual({
      path: "Recordings/take.webm",
    });
    expect(parseWikiAudioEmbedTarget("clip.webm")).toBeNull();
    expect(parseWikiVideoEmbedTarget("clip.webm")).not.toBeNull();
    expect(parseWikiAudioEmbedTarget("note")).toBeNull();
  });
});

describe("talkInsertion", () => {
  const at = new Date(2026, 9, 25, 9, 14);
  const after = (doc: string, caret: number, file: string) => {
    const state = EditorState.create({ doc, selection: { anchor: caret } });
    const { from, insert } = talkInsertion(state, file, at);
    return state.update({ changes: { from, insert } }).state.doc.toString();
  };

  test("adds the heading and embed as a block after the caret's line", () => {
    expect(after("# Day\n\nFirst line.\nSecond line.", 10, "Recordings/2026-10-25 09.14.m4a")).toBe(
      "# Day\n\nFirst line.\n\n## Talk · 09:14\n\n![[Recordings/2026-10-25 09.14.m4a]]\n\nSecond line.",
    );
  });

  test("on an empty line under text, keeps one blank line before the heading", () => {
    expect(after("Some text.\n", 11, "Recordings/a.m4a")).toBe(
      "Some text.\n\n## Talk · 09:14\n\n![[Recordings/a.m4a]]\n",
    );
  });
});

import { createResampler, WHISPER_RATE } from "../src/lib/talk/resample";

describe("createResampler", () => {
  test("48 kHz in chunks comes out at 16 kHz, a third as many samples, with no seam", () => {
    const resample = createResampler(48_000);
    const second = new Float32Array(48_000).map((_, i) =>
      Math.sin((2 * Math.PI * 220 * i) / 48_000),
    );
    const parts = [
      second.subarray(0, 4800),
      second.subarray(4800, 20_000),
      second.subarray(20_000),
    ];
    const out = parts.map((p) => resample(p));
    const total = out.reduce((n, o) => n + o.length, 0);
    expect(Math.abs(total - WHISPER_RATE)).toBeLessThanOrEqual(1);
    // A 220 Hz tone survives: the averaged samples still swing near ±1.
    expect(Math.max(...out[2])).toBeGreaterThan(0.9);
  });

  test("44.1 kHz keeps its fractional step across chunks", () => {
    const resample = createResampler(44_100);
    let total = 0;
    for (let i = 0; i < 10; i++) total += resample(new Float32Array(4410)).length;
    expect(Math.abs(total - WHISPER_RATE)).toBeLessThanOrEqual(1);
  });
});

import { transcriptCallout, transcriptInsertion } from "../src/lib/talk/transcript";

describe("transcript callout", () => {
  const file = "Recordings/2026-10-25 09.14.m4a";
  const segments = [
    { start: 0, end: 2.4, text: " Okay, a few things today." },
    { start: 3.2, end: 9, text: "First,   what to build." },
  ];

  test("is a folded callout with a time link per line", () => {
    expect(transcriptCallout(file, segments, "On this Mac · Whisper Small")).toBe(
      [
        "> [!transcript]- Transcript · 2 lines · On this Mac · Whisper Small",
        "> [0:00](<Recordings/2026-10-25 09.14.m4a#t=0>) Okay, a few things today.",
        "> [0:03](<Recordings/2026-10-25 09.14.m4a#t=3>) First, what to build.",
      ].join("\n"),
    );
  });

  test("goes under its take's embed", () => {
    const state = EditorState.create({ doc: `## Talk · 09:14\n\n![[${file}]]\n\nAfter.` });
    const at = transcriptInsertion(state, file, "> [!transcript]- T");
    expect(at).not.toBeNull();
    const doc = state.update({ changes: at! }).state.doc.toString();
    expect(doc).toBe(`## Talk · 09:14\n\n![[${file}]]\n\n> [!transcript]- T\n\nAfter.`);
    expect(transcriptInsertion(EditorState.create({ doc: "No embed" }), file, "x")).toBeNull();
  });
});

import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { findCallouts } from "../src/components/editor-area/callout-decorations";

describe("findCallouts", () => {
  const parsed = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown()] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    return state;
  };

  test("a folded transcript callout: its type, marker and body", () => {
    const doc =
      "Before.\n\n> [!transcript]- Transcript · 2 lines\n> [0:00](<a.m4a#t=0>) One.\n> [0:03](<a.m4a#t=3>) Two.\n\nAfter.";
    const state = parsed(doc);
    const [c] = findCallouts(state);
    expect(c.type).toBe("transcript");
    expect(c.foldedByDefault).toBe(true);
    expect(state.sliceDoc(c.markerFrom, c.markerTo)).toBe("[!transcript]- ");
    expect(state.sliceDoc(c.bodyFrom!, c.to)).toBe(
      "> [0:00](<a.m4a#t=0>) One.\n> [0:03](<a.m4a#t=3>) Two.",
    );
  });

  test("an open callout and a plain quote", () => {
    const state = parsed("> [!note]+ Open\n> Body\n\n> Just a quote.");
    const callouts = findCallouts(state);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].foldedByDefault).toBe(false);
  });
});

import { recordingTime } from "../src/components/editor-area/link-navigation";

describe("recordingTime", () => {
  test("reads a transcript's time link, with or without angle brackets or encoding", () => {
    expect(recordingTime("Recordings/2026-10-25 09.14.m4a#t=75")).toEqual({
      path: "Recordings/2026-10-25 09.14.m4a",
      seconds: 75,
    });
    expect(recordingTime("<Recordings/a b.m4a#t=3>")).toEqual({
      path: "Recordings/a b.m4a",
      seconds: 3,
    });
    expect(recordingTime("Recordings/a%20b.webm#t=3.5")).toEqual({
      path: "Recordings/a b.webm",
      seconds: 3.5,
    });
    expect(recordingTime("Notes/Page.md#t=3")).toBeNull();
    expect(recordingTime("https://example.com/a.mp3")).toBeNull();
  });
});

import {
  acceptOffer,
  applyReply,
  emptyAsk,
  keepAside,
  pictureOf,
  startTopic,
  talkSections,
} from "../src/lib/talk/ask";
import { parseTalkReply, talkPrompt } from "../src/lib/talk/talk-agent";

describe("Ask", () => {
  const build = {
    key: "build",
    title: "What to build next quarter",
    short: "What to build",
    mermaid: "quadrantChart\n  Voice capture: [0.3, 0.8]",
  };
  const week = {
    key: "week",
    title: "Where my week goes",
    short: "My week",
    mermaid: 'pie\n  "Writing" : 20',
  };

  test("the first topic opens without asking; a turn to a new one is offered; one more line takes it", () => {
    let s = applyReply(emptyAsk(), {
      lines: [
        { n: 0, topic: null },
        { n: 1, topic: "build", turn: "First" },
      ],
      topics: [build],
    });
    expect(s.open).toEqual(["build"]);
    expect(s.current).toBe("build");
    s = applyReply(s, { lines: [{ n: 2, topic: "week", turn: "Okay, next" }], topics: [week] });
    expect(s.offer).toEqual({ key: "week", cue: "Okay, next" });
    expect(s.current).toBe("build");
    s = applyReply(s, { lines: [{ n: 3, topic: "week" }], topics: [] });
    expect(s.open).toEqual(["build", "week"]);
    expect(s.current).toBe("week");
    expect(s.offer).toBeNull();
  });

  test("lines heard with the turn don't take the offer: the card gets its moment", () => {
    let s = applyReply(emptyAsk(), {
      lines: [{ n: 1, topic: "build", turn: "First" }],
      topics: [build],
    });
    s = applyReply(s, {
      lines: [
        { n: 2, topic: "week", turn: "Okay, next" },
        { n: 3, topic: "week" },
      ],
      topics: [week],
    });
    expect(s.offer?.key).toBe("week");
    expect(s.open).toEqual(["build"]);
    s = applyReply(s, { lines: [{ n: 4, topic: "week" }], topics: [] });
    expect(s.open).toEqual(["build", "week"]);
  });

  test("an aside waits as a badge; Accept and Aside answer the card", () => {
    let s = applyReply(emptyAsk(), {
      lines: [
        { n: 1, topic: "build", turn: "First" },
        { n: 2, topic: "hire", aside: true },
      ],
      topics: [build],
    });
    expect(s.parked).toEqual({ hire: [2] });
    expect(s.open).toEqual(["build"]);
    s = applyReply(s, { lines: [{ n: 3, topic: "week", turn: "Next" }], topics: [week] });
    expect(acceptOffer(s).current).toBe("week");
    const aside = keepAside(s);
    expect(aside.asides).toEqual(["week"]);
    expect(applyReply(aside, { lines: [{ n: 4, topic: "week" }], topics: [] }).open).toEqual([
      "build",
    ]);
  });

  test("one line about an open topic doesn't flip the picture; a turn or a second line does", () => {
    let s = applyReply(emptyAsk(), {
      lines: [
        { n: 1, topic: "build", turn: "First" },
        { n: 2, topic: "week", turn: "Next" },
      ],
      topics: [build, week],
    });
    s = applyReply(s, { lines: [{ n: 3, topic: "week" }], topics: [] });
    expect(s.current).toBe("week");
    s = applyReply(s, { lines: [{ n: 4, topic: "build" }], topics: [] });
    expect(s.current).toBe("week");
    s = applyReply(s, { lines: [{ n: 5, topic: "build" }], topics: [] });
    expect(s.current).toBe("build");
  });

  test("the topics become sections: summary, then the diagram or board; asides keep their lines", () => {
    const s = applyReply(emptyAsk(), {
      lines: [
        { n: 1, topic: "build", turn: "First" },
        { n: 2, topic: "hire", aside: true },
      ],
      topics: [{ ...build, summary: "Voice capture is the bet. A mobile app waits." }],
    });
    const lines = [
      { n: 1, start: 3, text: "First, what to build next quarter." },
      { n: 2, start: 14, text: "QA eats my evenings." },
    ];
    expect(
      talkSections(s, lines, (n) => ({
        file: "Recordings/a.m4a",
        start: lines.find((l) => l.n === n)!.start,
      })),
    ).toBe(
      [
        "### What to build next quarter",
        "",
        "Voice capture is the bet. A mobile app waits.",
        "",
        "```mermaid",
        "quadrantChart\n  Voice capture: [0.3, 0.8]",
        "```",
        "",
        "### Said in passing",
        "",
        "- QA eats my evenings. [0:14](<Recordings/a.m4a#t=14>)",
      ].join("\n"),
    );
  });

  test("a topic drawn as a board embeds it instead of its Mermaid", () => {
    const s = applyReply(emptyAsk(), {
      lines: [{ n: 1, topic: "build", turn: "First" }],
      topics: [build],
    });
    expect(
      talkSections(
        s,
        [{ n: 1, start: 3, text: "First." }],
        () => ({ file: "Recordings/a.m4a", start: 3 }),
        () => "Talk-assets/plan.board.svg",
      ),
    ).toBe(
      "### What to build next quarter\n\n![What to build next quarter](Talk-assets/plan.board.svg)",
    );
  });

  test("a reply's summary is read, trimmed", () => {
    const reply = parseTalkReply(
      '{"lines":[],"topics":[{"key":"b","title":"B","mermaid":"mindmap","summary":" One. Two. "}]}',
    );
    expect(reply.topics[0].summary).toBe("One. Two.");
  });

  test("a reply's JSON is read even inside a code fence", () => {
    const reply = parseTalkReply(
      '```json\n{"lines":[{"n":1,"topic":"build","turn":"First"}],"topics":[{"key":"build","title":"What to build","mermaid":"pie"}]}\n```',
    );
    expect(reply.lines[0]).toEqual({ n: 1, topic: "build", turn: "First" });
    expect(reply.topics[0].short).toBe("What to build");
  });
});

describe("talk buttons", () => {
  test("next topic opens an empty tab now; the reply that titles it keeps it, with no offer", () => {
    let s = applyReply(emptyAsk(), {
      lines: [{ n: 0, topic: "plan" }],
      topics: [
        { key: "plan", title: "My plan", short: "Plan", mermaid: "flowchart LR\n  A --> B" },
      ],
    });
    s = startTopic(s, "topic-2", 1);
    expect(s.open).toEqual(["plan", "topic-2"]);
    expect(s.current).toBe("topic-2");
    expect(s.topics["topic-2"]!.title).toBe("New topic");
    s = applyReply(s, {
      lines: [{ n: 1, topic: "topic-2", turn: "So, hiring" }],
      topics: [
        {
          key: "topic-2",
          title: "Who to hire",
          short: "Hiring",
          mermaid: "mindmap\n  root((Hiring))",
        },
      ],
    });
    expect(s.offer).toBeNull();
    expect(s.current).toBe("topic-2");
    expect(s.topics["topic-2"]!.title).toBe("Who to hire");
  });

  test("next topic's tab becomes the topic said after it, even under the AI's own key", () => {
    let s = applyReply(emptyAsk(), {
      lines: [{ n: 0, topic: "plan" }],
      topics: [
        { key: "plan", title: "My plan", short: "Plan", mermaid: "flowchart LR\n  A --> B" },
      ],
    });
    s = startTopic(s, "topic-2", 1);
    s = applyReply(s, {
      lines: [
        { n: 0, topic: "plan" },
        { n: 1, topic: "hiring", turn: "We need to hire" },
      ],
      topics: [
        {
          key: "hiring",
          title: "Who to hire",
          short: "Hiring",
          mermaid: "mindmap\n  root((Hiring))",
        },
      ],
    });
    expect(s.offer).toBeNull();
    expect(s.open).toEqual(["plan", "hiring"]);
    expect(s.current).toBe("hiring");
    expect(s.topics["topic-2"]).toBeUndefined();
    expect(s.started).toBeNull();
  });

  test("a topic started by button that nothing was said into isn't written to the note", () => {
    const s = startTopic(emptyAsk(), "topic-1", 0);
    expect(talkSections(s, [], () => ({ file: "a.m4a", start: 0 }))).toBe("");
  });

  test("the turn tells the AI what was clicked, even with nothing new heard", () => {
    const prompt = talkPrompt([], [{ key: "plan", title: "My plan" }], "plan", [
      "Draw plan as steps (flowchart)",
    ]);
    expect(prompt).toContain("New lines:\n(none)");
    expect(prompt).toMatch(/Buttons:\n- Draw plan as steps \(flowchart\)$/);
  });

  test("each button knows its picture by the diagram's first word", () => {
    expect(pictureOf("mindmap\n  root((x))")).toBe("mindmap");
    expect(pictureOf("graph TD\n  A --> B")).toBe("flowchart");
    expect(pictureOf("flowchart LR\n  A --> B")).toBe("flowchart");
    expect(pictureOf("xychart-beta\n  bar [1]")).toBe("xychart");
    expect(pictureOf('pie\n  "A" : 1')).toBeNull();
    expect(pictureOf(undefined)).toBeNull();
  });
});

import { afterTranscriptInsertion } from "../src/lib/talk/transcript";

describe("afterTranscriptInsertion", () => {
  test("the topics go below the transcript callout", () => {
    const file = "Recordings/a.m4a";
    const state = EditorState.create({
      doc: `![[${file}]]\n\n> [!transcript]- T\n> [0:00](<${file}#t=0>) One.\n\nAfter.`,
    });
    const at = afterTranscriptInsertion(state, file, "### Topic")!;
    expect(state.update({ changes: at }).state.doc.toString()).toBe(
      `![[${file}]]\n\n> [!transcript]- T\n> [0:00](<${file}#t=0>) One.\n\n### Topic\n\nAfter.`,
    );
  });
});

import { readTranscript } from "../src/lib/talk/transcript";

describe("readTranscript", () => {
  test("reads back the callout a take wrote", () => {
    const file = "Recordings/2026-10-25 09.14.m4a";
    const doc = `## Talk\n\n![[${file}]]\n\n${transcriptCallout(file, [{ start: 3, end: 5, text: "First, what to build." }], "On this Mac · Whisper Small")}\n\nAfter.`;
    expect(readTranscript(doc, file)).toEqual({
      engine: "On this Mac · Whisper Small",
      segments: [{ start: 3, end: 3, text: "First, what to build." }],
    });
    expect(readTranscript("No take here", file)).toBeNull();
  });
});
