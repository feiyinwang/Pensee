import { describe, expect, test } from "vite-plus/test";
import { parse } from "yaml";
import {
  bookmarkNote,
  bookmarkNoteName,
  escapePostText,
  syncXBookmarks,
  type SavedMedia,
  type XBookmark,
  type XMedia,
  type XSyncDeps,
} from "../src/lib/x-bookmarks";

function bookmark(overrides: Partial<XBookmark> = {}): XBookmark {
  return {
    id: "1844000000000000001",
    url: "https://x.com/lenawrites/status/1844000000000000001",
    authorId: "42",
    authorName: "Lena Park",
    authorHandle: "lenawrites",
    conversationId: "1844000000000000001",
    postedAt: "2026-10-08T14:03:00.000Z",
    mayHaveThread: false,
    posts: [{ id: "1844000000000000001", text: "Hello there", media: [], quote: null }],
    ...overrides,
  };
}

const video: XMedia = {
  kind: "video",
  url: "https://video.twimg.com/a.mp4",
  poster: "https://pbs.twimg.com/a.jpg",
  durationMs: 42_400,
  alt: null,
};

function frontmatter(note: string): Record<string, unknown> {
  return parse(/^---\n([\s\S]*?)\n---\n/.exec(note)![1]!) as Record<string, unknown>;
}

describe("bookmarkNoteName", () => {
  test("is the author and the first words, without links", () => {
    const name = bookmarkNoteName(
      bookmark({
        posts: [
          {
            id: "1",
            text: "I wrote every first draft this year in 90 minutes. Here is the whole system https://t.co/x",
            media: [],
            quote: null,
          },
        ],
      }),
    );
    expect(name).toBe("Lena Park – I wrote every first draft this year in 90 minutes. Here is…");
  });

  test("falls back to the author for a post with no text", () => {
    expect(
      bookmarkNoteName(bookmark({ posts: [{ id: "1", text: "", media: [], quote: null }] })),
    ).toBe("Lena Park");
  });
});

describe("escapePostText", () => {
  test("keeps line starts from becoming markdown", () => {
    expect(escapePostText("#buildinpublic day 3\n> quote\n- one\n1. two\n---\nplain")).toBe(
      "\\#buildinpublic day 3\n\\> quote\n\\- one\n1\\. two\n\\---\nplain",
    );
  });

  test("leaves text inside a line alone", () => {
    expect(escapePostText("a #tag and - dash")).toBe("a #tag and - dash");
  });
});

describe("bookmarkNote", () => {
  test("writes properties a Library card can read", () => {
    const note = bookmarkNote(bookmark(), [[]], "2026-10-10");
    expect(frontmatter(note)).toEqual({
      Type: "Tweet",
      Author: "Lena Park",
      Handle: "lenawrites",
      URL: "https://x.com/lenawrites/status/1844000000000000001",
      ID: "1844000000000000001",
      Posted: "2026-10-08",
      Saved: "2026-10-10",
      Posts: 1,
    });
    expect(note.endsWith("---\n\nHello there\n")).toBe(true);
  });

  test("separates thread posts and embeds media, poster as the cover", () => {
    const thread = bookmark({
      posts: [
        { id: "1", text: "First", media: [], quote: null },
        { id: "2", text: "Second", media: [video], quote: null },
      ],
    });
    const media: SavedMedia[][] = [
      [],
      [{ media: video, path: "Note-assets/2-1.mp4", poster: "Note-assets/2-1-poster.jpg" }],
    ];
    const note = bookmarkNote(thread, media, "2026-10-10");
    const props = frontmatter(note);
    expect(props.Posts).toBe(2);
    expect(props.Cover).toBe("Note-assets/2-1-poster.jpg");
    expect(props.Media).toBe("video");
    expect(props.Duration).toBe(42);
    expect(note).toContain("First\n\n---\n\nSecond\n\n![[Note-assets/2-1.mp4]]\n");
  });

  test("links to the post for media that didn't download", () => {
    const one = bookmark({ posts: [{ id: "1", text: "Look", media: [video], quote: null }] });
    const note = bookmarkNote(one, [[{ media: video, path: null, poster: null }]], "2026-10-10");
    expect(note).toContain(`[Video didn't download · see it on X](${one.url})`);
    expect(frontmatter(note).Cover).toBeUndefined();
  });

  test("quotes a quoted post with its author", () => {
    const one = bookmark({
      posts: [
        {
          id: "1",
          text: "This:",
          media: [],
          quote: {
            authorName: "June Hart",
            authorHandle: "junehart",
            text: "Drafting and editing\nare different.",
            url: "https://x.com/junehart/status/9",
          },
        },
      ],
    });
    expect(bookmarkNote(one, [[]], "2026-10-10")).toContain(
      "> **June Hart** (@junehart) · [post](https://x.com/junehart/status/9)\n>\n> Drafting and editing\n> are different.",
    );
  });

  test("quotes names YAML would misread", () => {
    const note = bookmarkNote(bookmark({ authorName: "Dr. #1: Fan" }), [[]], "2026-10-10");
    expect(frontmatter(note).Author).toBe("Dr. #1: Fan");
  });
});

describe("syncXBookmarks", () => {
  function deps(listed: XBookmark[], overrides: Partial<XSyncDeps> = {}) {
    const files = new Map<string, string>();
    const saved: string[] = [];
    const progress: [number, number][] = [];
    const d: XSyncDeps = {
      folder: "/vault/Bookmarks",
      knownIds: async () => ["known"],
      listNew: async () => listed,
      expand: async (b) => b,
      saveMedia: async (_url, notePath, name) =>
        `${notePath.split("/").pop()!.replace(/\.md$/, "")}-assets/${name}.jpg`,
      fileExists: async (path) => files.has(path) || path.endsWith("Taken.md"),
      createNote: async (path, content) => void files.set(path, content),
      markSaved: async (ids) => void saved.push(...ids),
      today: () => "2026-10-12",
      onProgress: (done, total) => void progress.push([done, total]),
      isCurrent: () => true,
      ...overrides,
    };
    return { d, files, saved, progress };
  }

  test("writes the oldest first and records each as saved", async () => {
    const newer = bookmark({
      id: "2",
      authorName: "B",
      posts: [{ id: "2", text: "new", media: [], quote: null }],
    });
    const older = bookmark({
      id: "1",
      authorName: "A",
      posts: [{ id: "1", text: "old", media: [], quote: null }],
    });
    const { d, files, saved, progress } = deps([newer, older]);
    const result = await syncXBookmarks(d);
    expect(result).toEqual({ saved: 2, missingMedia: 0 });
    expect([...files.keys()]).toEqual([
      "/vault/Bookmarks/A – old.md",
      "/vault/Bookmarks/B – new.md",
    ]);
    expect(saved).toEqual(["1", "2"]);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  test("a taken name gets a number", async () => {
    const one = bookmark({
      authorName: "Taken",
      posts: [{ id: "1", text: "", media: [], quote: null }],
    });
    const { d, files } = deps([one]);
    await syncXBookmarks(d);
    expect([...files.keys()]).toEqual(["/vault/Bookmarks/Taken 2.md"]);
  });

  test("a media failure still writes the note; an X failure stops before saving", async () => {
    const withVideo = bookmark({ posts: [{ id: "1", text: "v", media: [video], quote: null }] });
    const failingMedia = deps([withVideo], {
      saveMedia: async () => {
        throw new Error("404");
      },
    });
    expect(await syncXBookmarks(failingMedia.d)).toEqual({ saved: 1, missingMedia: 1 });

    const failingX = deps([withVideo], {
      expand: async () => {
        throw new Error("X signed you out.");
      },
    });
    await expect(syncXBookmarks(failingX.d)).rejects.toThrow("X signed you out.");
    expect(failingX.saved).toEqual([]);
    expect(failingX.files.size).toBe(0);
  });

  test("stops between bookmarks when the workspace changes", async () => {
    let current = true;
    const { d, files } = deps([bookmark({ id: "2" }), bookmark({ id: "1" })], {
      isCurrent: () => current,
      markSaved: async () => {
        current = false;
      },
    });
    await syncXBookmarks(d);
    expect(files.size).toBe(1);
  });
});
