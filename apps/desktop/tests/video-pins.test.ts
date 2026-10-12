import { describe, expect, test } from "vite-plus/test";
import {
  formatVideoTime,
  parseVideoLink,
  parseVideoPinId,
  pinEmptyLine,
  pinnedItemAfter,
  videoIdOf,
  videoLinkTarget,
  videoPinId,
} from "../src/lib/video-pins";

describe("pin ids", () => {
  test("one per second, numbered when the second is taken", () => {
    expect(videoPinId(754.9, new Set())).toBe("yt-754");
    expect(videoPinId(754, new Set(["yt-754"]))).toBe("yt-754-2");
    expect(videoPinId(754, new Set(["yt-754", "yt-754-2"]))).toBe("yt-754-3");
    expect(videoPinId(-3, new Set())).toBe("yt-0");
  });

  test("parse back to the second", () => {
    expect(parseVideoPinId("yt-754")).toBe(754);
    expect(parseVideoPinId("yt-754-2")).toBe(754);
    expect(parseVideoPinId("bk-p3-1-9")).toBeNull();
    expect(parseVideoPinId("abc123")).toBeNull();
    expect(parseVideoPinId("yt-")).toBeNull();
  });
});

test.each([
  [0, "0:00"],
  [59, "0:59"],
  [754, "12:34"],
  [3600, "1:00:00"],
  [3725.6, "1:02:05"],
])("formatVideoTime(%s)", (seconds, text) => {
  expect(formatVideoTime(seconds)).toBe(text);
});

describe("videoIdOf", () => {
  test("reads url, link or source, any case", () => {
    expect(videoIdOf("Type: Video\nUrl: https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("link: https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(videoIdOf("source: '[talk](https://youtu.be/dQw4w9WgXcQ)'")).toBe("dQw4w9WgXcQ");
  });

  test("null without a YouTube link", () => {
    expect(videoIdOf(null)).toBeNull();
    expect(videoIdOf("Type: Video\nurl: https://vimeo.com/123")).toBeNull();
    expect(videoIdOf("title: https://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
});

describe("board links", () => {
  test("round-trip page and second", () => {
    const ln = videoLinkTarget("/vault/Videos/Talk.md", 754.4);
    expect(ln).toBe("Talk#^yt-754");
    expect(parseVideoLink(ln)).toEqual({ page: "Talk", seconds: 754 });
  });

  test("other links are not pins", () => {
    expect(parseVideoLink("Book#^bk-p3-1-9")).toBeNull();
    expect(parseVideoLink("Page")).toBeNull();
    expect(parseVideoLink("#^yt-3")).toBeNull();
  });
});

describe("pinEmptyLine", () => {
  test("a blank line becomes a pinned bullet at its indent", () => {
    expect(pinEmptyLine("", "yt-5")).toEqual({ text: "-  ^yt-5", caret: 2 });
    expect(pinEmptyLine("  ", "yt-5")).toEqual({ text: "  -  ^yt-5", caret: 4 });
  });

  test("an empty item keeps its marker", () => {
    expect(pinEmptyLine("- ", "yt-5")).toEqual({ text: "-  ^yt-5", caret: 2 });
    expect(pinEmptyLine("    * ", "yt-5")).toEqual({ text: "    *  ^yt-5", caret: 6 });
    expect(pinEmptyLine("3.", "yt-5")).toEqual({ text: "3.  ^yt-5", caret: 3 });
  });

  test("a line with text is left to the block rules", () => {
    expect(pinEmptyLine("- idea", "yt-5")).toBeNull();
    expect(pinEmptyLine("idea", "yt-5")).toBeNull();
  });
});

describe("pinnedItemAfter", () => {
  test("the next item of a list", () => {
    expect(pinnedItemAfter("  - idea ^yt-3", "yt-9")).toEqual({ text: "  -  ^yt-9", caret: 4 });
    expect(pinnedItemAfter("2. idea ^yt-3", "yt-9")).toEqual({ text: "3.  ^yt-9", caret: 3 });
  });

  test("a top-level bullet after any other block", () => {
    expect(pinnedItemAfter("A paragraph ^yt-3", "yt-9")).toEqual({ text: "-  ^yt-9", caret: 2 });
  });
});
