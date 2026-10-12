import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { threadLayout } from "../src/components/editor-area/tweet-thread";
import { tweetNoteProps } from "../src/lib/x-bookmarks";

function stateOf(doc: string): EditorState {
  let state = EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] });
  ensureSyntaxTree(state, doc.length, 1000);
  state = state.update({ selection: state.selection }).state;
  return state;
}

/** Each post's first line, and the text of the whole thread. */
function shape(doc: string, count: number | null) {
  const state = stateOf(doc);
  const layout = threadLayout(state, count);
  if (!layout) return null;
  return {
    posts: layout.posts.map((pos) => state.doc.lineAt(pos).text),
    thread: state.sliceDoc(layout.from, layout.to),
    quotes: layout.quotes.map((q) => state.sliceDoc(q.from, q.to)),
  };
}

describe("tweetNoteProps", () => {
  test("reads a bookmark note's properties, values as text", () => {
    const props = tweetNoteProps(
      [
        "Type: Tweet",
        "Author: Lena Park",
        "Handle: lenawrites",
        "URL: https://x.com/lenawrites/status/1",
        'ID: "1"',
        "Posted: 2026-10-08",
        "Saved: 2026-10-10",
        "Posts: 7",
      ].join("\n"),
    );
    expect(props).toEqual({
      author: "Lena Park",
      handle: "lenawrites",
      url: "https://x.com/lenawrites/status/1",
      posted: "2026-10-08",
      saved: "2026-10-10",
      posts: 7,
    });
  });

  test("is null for any other note", () => {
    expect(tweetNoteProps(null)).toBeNull();
    expect(tweetNoteProps("Type: Book\nAuthor: Someone")).toBeNull();
    expect(tweetNoteProps("Type: Tweets")).toBeNull();
    expect(tweetNoteProps("Type: Tweet\n: broken: [")).toBeNull();
  });

  test("matches keys and the type ignoring case, and tolerates missing values", () => {
    expect(tweetNoteProps("type: tweet\nhandle: '@kofim'\nposts: many")).toEqual({
      author: null,
      handle: "kofim",
      url: null,
      posted: null,
      saved: null,
      posts: null,
    });
  });
});

describe("threadLayout", () => {
  test("splits the body into posts at each ---", () => {
    const doc = "\nFirst post.\n\n---\n\nSecond post.\n\n![[a-assets/2-1.mp4]]\n\n---\n\nThird.\n";
    expect(shape(doc, 3)).toEqual({
      posts: ["First post.", "Second post.", "Third."],
      thread: doc.slice(1, -1),
      quotes: [],
    });
  });

  test("ends at the Posts-th --- so the notes under it are not a post", () => {
    const doc = "One.\n\n---\n\nTwo.\n\n---\n\nMy own notes.\n";
    expect(shape(doc, 2)?.posts).toEqual(["One.", "Two."]);
    expect(shape(doc, 2)?.thread).toBe("One.\n\n---\n\nTwo.");
  });

  test("ends at the first heading", () => {
    const doc = "One.\n\n---\n\nTwo.\n\n## Notes\n\nMine.\n";
    expect(shape(doc, null)?.thread).toBe("One.\n\n---\n\nTwo.");
  });

  test("finds quoted posts", () => {
    const quote =
      "> **June Hart** (@junehart) · [post](https://x.com/junehart/status/2)\n>\n> Drafting.";
    const doc = `This changed how I think:\n\n${quote}\n`;
    expect(shape(doc, 1)).toEqual({
      posts: ["This changed how I think:"],
      thread: doc.slice(0, -1),
      quotes: [quote],
    });
  });

  test("is null when the body has no post", () => {
    expect(shape("", 1)).toBeNull();
    expect(shape("# Heading\n\ntext", 1)).toBeNull();
  });
});
