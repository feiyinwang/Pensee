import { describe, expect, test } from "vite-plus/test";
import { GFM, parser } from "@lezer/markdown";
import { shortDashUnderlineMarkdownSyntaxExtension } from "../src/lib/prosemark-core/markdown/shortDashUnderline";

const md = parser.configure([GFM, shortDashUnderlineMarkdownSyntaxExtension]);

const topLevelNodes = (doc: string): string[] => {
  const names: string[] = [];
  const cursor = md.parse(doc).cursor();
  if (cursor.firstChild()) {
    do names.push(cursor.name);
    while (cursor.nextSibling());
  }
  return names;
};

describe("short dash underline", () => {
  test("a lone dash under a paragraph is an empty bullet, not an H2 underline", () => {
    expect(topLevelNodes("Pivot\n-")).toEqual(["Paragraph", "BulletList"]);
  });

  test("a dash plus trailing space is still an empty bullet", () => {
    expect(topLevelNodes("Pivot\n- ")).toEqual(["Paragraph", "BulletList"]);
  });

  test("two dashes end the paragraph as their own line", () => {
    expect(topLevelNodes("Pivot\n--")).toEqual(["Paragraph", "Paragraph"]);
  });

  test("three or more dashes still underline a setext H2", () => {
    expect(topLevelNodes("Pivot\n---")).toEqual(["SetextHeading2"]);
    expect(topLevelNodes("Pivot\n-----  ")).toEqual(["SetextHeading2"]);
  });

  test("an equals underline is untouched", () => {
    expect(topLevelNodes("Pivot\n=")).toEqual(["SetextHeading1"]);
  });

  test("a dash with content still interrupts the paragraph as a list", () => {
    expect(topLevelNodes("Pivot\n- item")).toEqual(["Paragraph", "BulletList"]);
  });

  test("a dash inside prose is not an underline", () => {
    expect(topLevelNodes("Pivot\n- x -")).toEqual(["Paragraph", "BulletList"]);
    expect(topLevelNodes("Pivot\na - b")).toEqual(["Paragraph"]);
  });

  test("a dash in a new list item under a list paragraph stays a list item", () => {
    expect(topLevelNodes("- one\n-")).toEqual(["BulletList"]);
  });
});
