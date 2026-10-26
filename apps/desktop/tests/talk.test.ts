import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { formatClock, recordingStem, talkHeadingTime } from "../src/lib/talk/clock";
import { talkInsertion } from "../src/lib/talk/insert-talk";
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
