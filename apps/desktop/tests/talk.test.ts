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
