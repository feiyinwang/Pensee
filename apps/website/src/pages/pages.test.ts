import { describe, expect, it } from "vite-plus/test";

import { buildLlms, buildRobots, buildSitemap } from "./feeds";
import { parsePage, summarize } from "./parse";

const ORIGIN = "https://pensee-website.zhhv5f4p77.workers.dev";
const FILE = "../../content/guides/example-page.md";
const page = (fields: string, body = "Some words.") => `---\n${fields}\n---\n\n${body}\n`;
const FIELDS = [
  "title: An example page",
  "description: A page that exists only in this test.",
  "slug: example-page",
  "updated: 2026-10-21",
].join("\n");

describe("parsePage", () => {
  it("reads frontmatter and renders the body", () => {
    const parsed = parsePage(FILE, page(FIELDS, "## Hello\n\nWorld."));
    expect(parsed).toMatchObject({
      type: "guides",
      slug: "example-page",
      path: "/guides/example-page/",
      title: "An example page",
      updated: "2026-10-21",
      draft: false,
      steps: [],
      questions: [],
    });
    expect(parsed.html).toContain("<h2>Hello</h2>");
  });

  it.each([
    ["an unknown type", "../../content/notes/example-page.md", page(FIELDS), /not a page type/],
    ["no frontmatter", FILE, "# Hi", /no frontmatter/],
    ["a missing field", FILE, page(FIELDS.replace(/^title.*$/m, "")), /needs "title"/],
    [
      "a slug that isn't the file name",
      "../../content/guides/other-page.md",
      page(FIELDS),
      /match the file name/,
    ],
    ["a bad date", FILE, page(FIELDS.replace("2026-10-21", "Oct 21")), /YYYY-MM-DD/],
    [
      "a long description",
      FILE,
      page(FIELDS.replace(/^description.*$/m, `description: ${"x".repeat(161)}`)),
      /160/,
    ],
    ["a draft flag that isn't true or false", FILE, page(`${FIELDS}\ndraft: maybe`), /draft/],
  ])("fails the build on %s, naming the file", (_, file, raw, why) => {
    expect(() => parsePage(file, raw)).toThrow(why);
    expect(() => parsePage(file, raw)).toThrow(file);
  });

  it("takes the steps from the first numbered list", () => {
    const raw = page(
      FIELDS,
      "Intro.\n\n- not a step\n\n1. Open **Settings**.\n2. Pick a folder.\n\nThen:\n\n1. Not this list.",
    );
    expect(parsePage(FILE, raw).steps).toEqual(["Open Settings.", "Pick a folder."]);
  });

  it("takes questions from the ## Questions section and stops at the next ##", () => {
    const body = [
      "### Not a question",
      "Text.",
      "## Questions",
      "### Where are the files?",
      "In a folder you pick.",
      "",
      "They stay plain markdown.",
      "### Unanswered?",
      "## After",
      "### Also not a question",
      "Text.",
    ].join("\n\n");
    expect(parsePage(FILE, page(FIELDS, body)).questions).toEqual([
      {
        question: "Where are the files?",
        answer: "In a folder you pick. They stay plain markdown.",
      },
    ]);
  });
});

describe("feeds", () => {
  const published = [
    summarize(parsePage(FILE, page(FIELDS))),
    summarize(
      parsePage(
        "../../content/docs/second-page.md",
        page(FIELDS.replace("example-page", "second-page").replace("2026-10-21", "2026-10-02")),
      ),
    ),
  ];

  it("lists home, the indexes of types with pages, and every page, with absolute URLs", () => {
    const xml = buildSitemap(published);
    for (const path of ["/", "/guides/", "/docs/", "/guides/example-page/", "/docs/second-page/"]) {
      expect(xml).toContain(`<loc>${ORIGIN}${path}</loc>`);
    }
    expect(xml).not.toContain("/essays/");
    expect(xml).toContain("<lastmod>2026-10-02</lastmod>");
  });

  it("lists only the homepage when there are no pages", () => {
    expect(buildSitemap([]).match(/<loc>/g)).toHaveLength(1);
  });

  it("allows every crawler and points at the sitemap", () => {
    const robots = buildRobots();
    expect(robots).toContain("User-agent: *\nAllow: /");
    expect(robots).not.toMatch(/Disallow/);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("writes llms.txt with a section per type that has pages", () => {
    const llms = buildLlms(published);
    expect(llms).toMatch(/^# Pensée\n\n> /);
    expect(llms).toContain(
      `## Guides\n\n- [An example page](${ORIGIN}/guides/example-page/): A page that exists only in this test.`,
    );
    expect(llms).not.toContain("## Essays");
  });
});
