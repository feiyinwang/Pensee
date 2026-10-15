import { describe, expect, test } from "vite-plus/test";
import {
  EMPTY_DRAFT,
  appendBlock,
  appendListItem,
  composerTarget,
  dayLabel,
  dayLinkLine,
  effectiveKind,
  isDraftEmpty,
  submitLabel,
  withDateProperty,
  withDay,
  withKind,
  type ComposerDraft,
} from "../src/lib/composer";
import type { TypedNote } from "../src/lib/tauri";

const NOW = new Date(2026, 9, 12, 15, 0);

function draft(patch: Partial<ComposerDraft>): ComposerDraft {
  return { ...EMPTY_DRAFT, ...patch };
}

function video(path: string, link: string): TypedNote {
  return {
    path,
    relative_path: path.replace("/vault/", ""),
    name: "Talk",
    title: "Talk",
    note_type: "YouTube",
    properties: { link },
  } as unknown as TypedNote;
}

describe("effectiveKind", () => {
  test("a pasted link takes the site's kind", () => {
    expect(effectiveKind(draft({ title: "https://youtu.be/dQw4w9WgXcQ" }))).toBe("video");
    expect(effectiveKind(draft({ title: "https://arxiv.org/abs/2401.00001" }))).toBe("paper");
  });

  test("a site Pensée doesn't know is a book, as in Library", () => {
    expect(effectiveKind(draft({ title: "https://example.com/post" }))).toBe("book");
  });

  test("a kind the user picked wins over the link", () => {
    expect(
      effectiveKind(draft({ title: "https://youtu.be/x", kind: "podcast", kindPicked: true })),
    ).toBe("podcast");
  });

  test("a date leaves the kind alone", () => {
    expect(effectiveKind(draft({ kind: "video", kindPicked: true, day: "2026-10-12" }))).toBe(
      "video",
    );
  });

  test("an attached file is a book unless paper was picked", () => {
    expect(effectiveKind(draft({ file: "/x/a.pdf" }))).toBe("book");
    expect(effectiveKind(draft({ file: "/x/a.pdf", kind: "paper", kindPicked: true }))).toBe(
      "paper",
    );
  });
});

describe("composerTarget", () => {
  test("nothing typed makes nothing", () => {
    expect(composerTarget(EMPTY_DRAFT, null)).toEqual({ kind: "empty" });
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true);
  });

  test("an empty draft's button still names its type", () => {
    const empty = { kind: "empty" } as const;
    expect(submitLabel(empty, "note", false, NOW)).toBe("Create note");
    expect(submitLabel(empty, "book", false, NOW)).toBe("Add book");
  });

  test("text without a title is an untitled note", () => {
    expect(composerTarget(draft({ body: "a thought" }), null)).toEqual({
      kind: "note",
      name: "Untitled",
      folder: null,
    });
  });

  test("a note goes to its folder", () => {
    expect(composerTarget(draft({ title: "Plan", folder: "Inbox" }), null)).toEqual({
      kind: "note",
      name: "Plan",
      folder: "Inbox",
    });
  });

  test("a link already in Library opens that note", () => {
    const held = video("/vault/Talk.md", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const target = composerTarget(draft({ title: "https://youtu.be/dQw4w9WgXcQ" }), [held]);
    expect(target).toMatchObject({ kind: "link", library: "video", existing: held });
    expect(submitLabel(target, "video", false, NOW)).toBe("Open note");
  });

  test("a Library kind with a title adds it by title", () => {
    const target = composerTarget(draft({ title: "Atomic Habits", kind: "book" }), null);
    expect(target).toEqual({ kind: "title", title: "Atomic Habits", library: "book" });
    expect(submitLabel(target, "book", false, NOW)).toBe("Add book");
  });

  test("an unpicked PDF leaves its kind to the import", () => {
    expect(composerTarget(draft({ file: "/x/a.pdf" }), null)).toEqual({
      kind: "file",
      path: "/x/a.pdf",
      library: null,
    });
  });
});

describe("labels", () => {
  test("days read as words near today", () => {
    expect(dayLabel("2026-10-12", NOW)).toBe("Today");
    expect(dayLabel("2026-10-13", NOW)).toBe("Tomorrow");
    expect(dayLabel("2026-10-11", NOW)).toBe("Yesterday");
    expect(dayLabel("2026-10-20", NOW)).toBe("20 Oct");
    expect(dayLabel("2025-10-20", NOW)).toBe("20 Oct 2025");
  });

  test("a day's button adds text, or opens the day without any", () => {
    const target = { kind: "day", day: "2026-10-12" } as const;
    expect(submitLabel(target, "note", true, NOW)).toBe("Add to today");
    expect(submitLabel(target, "note", false, NOW)).toBe("Open today");
  });
});

describe("dates", () => {
  test("a dated note with a title is its own note", () => {
    expect(composerTarget(draft({ title: "Standup", day: "2026-10-12" }), null)).toEqual({
      kind: "note",
      name: "Standup",
      folder: null,
    });
  });

  test("a date without a title writes in the day's note", () => {
    expect(composerTarget(draft({ body: "went fine", day: "2026-10-12" }), null)).toEqual({
      kind: "day",
      day: "2026-10-12",
    });
  });

  test("the chips no longer clear each other", () => {
    expect(withKind(draft({ day: "2026-10-12" }), "podcast")).toMatchObject({
      kind: "podcast",
      day: "2026-10-12",
    });
    expect(withDay(draft({ title: "Standup", kind: "video" }), "2026-10-12")).toMatchObject({
      title: "Standup",
      kind: "video",
      day: "2026-10-12",
    });
  });

  test("the day's note links the note as a list line, joining its list", () => {
    const link = dayLinkLine("Standup");
    expect(appendListItem("- 09:00 gym\n", link)).toBe("- 09:00 gym\n- [[Standup]]\n");
    expect(appendListItem("Slept well.\n", link)).toBe("Slept well.\n\n- [[Standup]]\n");
    expect(appendListItem("", link)).toBe("- [[Standup]]\n");
  });
});

describe("Date property", () => {
  test("set on empty, added to, or replacing a Date", () => {
    expect(withDateProperty(null, "2026-10-20")).toBe("Date: 2026-10-20");
    expect(withDateProperty("Type: Video\nLink: https://x.y", "2026-10-20")).toBe(
      "Type: Video\nLink: https://x.y\nDate: 2026-10-20",
    );
    expect(withDateProperty("date: 2025-01-01\nTags: [a]", "2026-10-20")).toBe(
      "date: 2026-10-20\nTags: [a]",
    );
  });
});

describe("appendBlock", () => {
  test("adds a blank line apart from what is there", () => {
    expect(appendBlock("- one\n\n", "two")).toBe("- one\n\ntwo\n");
    expect(appendBlock("", "two")).toBe("two\n");
    expect(appendBlock("keep", "  ")).toBe("keep");
  });
});
