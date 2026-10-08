import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { foldExtension, prosemarkMarkdownSyntaxExtensions } from "../src/lib/prosemark-core/main";
import {
  __testLinkPreview,
  bareUrlOfLine,
  linkChips,
  linkPreviews,
  webUrlOf,
} from "../src/components/editor-area/link-preview";

const { LinkPreviewWidget, LinkChipWidget } = __testLinkPreview;

function cardsIn(doc: string, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
      linkPreviews(),
    ],
  });
  ensureSyntaxTree(state, state.doc.length);
  const found: { url: string; from: number; to: number; replace: boolean }[] = [];
  state.field(foldExtension).between(0, state.doc.length, (from, to, deco) => {
    const widget = deco.spec.widget;
    if (widget instanceof LinkPreviewWidget) {
      found.push({ url: widget.url, from, to, replace: from !== to });
    }
  });
  return found;
}

describe("bareUrlOfLine", () => {
  test("accepts a bare or angle-bracketed web address", () => {
    expect(bareUrlOfLine("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(bareUrlOfLine("  <http://example.com>  ")).toBe("http://example.com");
  });

  test("rejects lines with anything else on them", () => {
    expect(bareUrlOfLine("see https://example.com")).toBeNull();
    expect(bareUrlOfLine("[x](https://example.com)")).toBeNull();
    expect(bareUrlOfLine("ftp://example.com")).toBeNull();
    expect(bareUrlOfLine("https://")).toBeNull();
  });
});

describe("link preview cards", () => {
  test("a URL line away from the caret is replaced by the page", () => {
    const doc = "https://example.com\n\nafter";
    expect(cardsIn(doc)).toEqual([{ url: "https://example.com", from: 0, to: 19, replace: true }]);
  });

  test("with the caret on the line the source stays and the page sits under it", () => {
    const doc = "https://example.com\n\nafter";
    expect(cardsIn(doc, 5)).toEqual([
      { url: "https://example.com", from: 19, to: 19, replace: false },
    ]);
  });

  test("a URL line directly under prose still gets a preview", () => {
    const doc = "Read this:\nhttps://example.com/post\n\nend";
    expect(cardsIn(doc)).toEqual([
      { url: "https://example.com/post", from: 11, to: 35, replace: true },
    ]);
  });

  test("inline links, list items and quotes keep rendering as links", () => {
    expect(cardsIn("see https://example.com here\n\nx")).toEqual([]);
    expect(cardsIn("- https://example.com\n\nx")).toEqual([]);
    expect(cardsIn("> https://example.com\n\nx")).toEqual([]);
  });
});

function chipsIn(doc: string, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
      linkPreviews(),
      linkChips(),
    ],
  });
  ensureSyntaxTree(state, state.doc.length);
  const found: { url: string; text: string }[] = [];
  state.field(foldExtension).between(0, state.doc.length, (from, to, deco) => {
    const widget = deco.spec.widget;
    if (widget instanceof LinkChipWidget) {
      found.push({ url: widget.url, text: doc.slice(from, to) });
    }
  });
  return found;
}

describe("webUrlOf", () => {
  test("accepts http(s) and www addresses only", () => {
    expect(webUrlOf("https://example.com/a")).toBe("https://example.com/a");
    expect(webUrlOf("www.example.com")).toBe("https://www.example.com");
    expect(webUrlOf("someone@example.com")).toBeNull();
    expect(webUrlOf("ftp://example.com")).toBeNull();
  });
});

describe("inline link chips", () => {
  const meeting = "https://app.read.ai/analytics/meetings/01M4DNJ4X?utm_source=Share_CopyLink";

  test("a URL in running text folds to a chip, parentheses left as text", () => {
    const doc = `- in this meeting (${meeting})\n\nx`;
    expect(chipsIn(doc)).toEqual([{ url: meeting, text: meeting }]);
  });

  test("an angle-bracket autolink folds whole", () => {
    expect(chipsIn("see <https://example.com> here\n\nx")).toEqual([
      { url: "https://example.com", text: "<https://example.com>" },
    ]);
  });

  test("the caret on the URL shows it as text", () => {
    const doc = "see https://example.com here";
    expect(chipsIn(doc, 8)).toEqual([]);
    expect(chipsIn(doc, 2)).toEqual([{ url: "https://example.com", text: "https://example.com" }]);
  });

  test("markdown links and lines with a page preview are left alone", () => {
    expect(chipsIn("see [x](https://example.com) here\n\nx")).toEqual([]);
    expect(chipsIn("https://example.com\n\nafter")).toEqual([]);
  });

  test("a URL alone in a list item is a chip", () => {
    expect(chipsIn("- https://example.com\n\nx")).toEqual([
      { url: "https://example.com", text: "https://example.com" },
    ]);
  });
});
