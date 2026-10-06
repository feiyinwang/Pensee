import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { foldExtension, prosemarkMarkdownSyntaxExtensions } from "../src/lib/prosemark-core/main";
import {
  __testLinkPreview,
  bareUrlOfLine,
  linkPreviews,
} from "../src/components/editor-area/link-preview";

const { LinkPreviewWidget } = __testLinkPreview;

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
