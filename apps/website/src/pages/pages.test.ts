import { describe, expect, it } from "vite-plus/test";

import { buildLlms, buildRobots, buildSitemap } from "./feeds";
import { parsePage, summarize } from "./parse";

const ORIGIN = "https://pensee-website.zhhv5f4p77.workers.dev";
const FILE = "../../content/articles/example-page.md";
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
      type: "articles",
      slug: "example-page",
      path: "/articles/example-page/",
      title: "An example page",
      updated: "2026-10-21",
      draft: false,
      steps: [],
      questions: [],
    });
    expect(parsed.html).toContain('<h2 id="hello">Hello</h2>');
    expect(parsed.outline).toEqual([{ id: "hello", text: "Hello" }]);
  });

  it.each([
    ["an unknown type", "../../content/notes/example-page.md", page(FIELDS), /not a page type/],
    ["no frontmatter", FILE, "# Hi", /no frontmatter/],
    ["a missing field", FILE, page(FIELDS.replace(/^title.*$/m, "")), /needs "title"/],
    [
      "a slug that isn't the file name",
      "../../content/articles/other-page.md",
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

  it("gives every ## its own id, for the On this page list", () => {
    const body = "## What you need\n\n## Why it *works*\n\n### Not listed\n\n## What you need";
    expect(parsePage(FILE, page(FIELDS, body)).outline).toEqual([
      { id: "what-you-need", text: "What you need" },
      { id: "why-it-works", text: "Why it works" },
      { id: "what-you-need-2", text: "What you need" },
    ]);
  });

  it("ends an article with the app, an essay with the next read, unless the page says", () => {
    expect(parsePage(FILE, page(FIELDS)).cta).toBe("try");
    const essay = parsePage(
      "../../content/essays/example-page.md",
      page(`${FIELDS}\nnext: /articles/other-page/`),
    );
    expect(essay).toMatchObject({ cta: "read-next", next: "/articles/other-page/" });
    expect(parsePage(FILE, page(`${FIELDS}\ncta: install`)).cta).toBe("install");
  });

  it.each([
    ["an unknown closing", `${FIELDS}\ncta: buy-now`, /cta "buy-now"/],
    ["a closing that hands on with no next page", `${FIELDS}\ncta: method`, /needs "next"/],
    ["a next that isn't a page path", `${FIELDS}\ncta: method\nnext: articles/x`, /page path/],
    ["an unknown painting", `${FIELDS}\npainting: monet`, /painting "monet"/],
  ])("fails the build on %s", (_, fields, why) => {
    expect(() => parsePage(FILE, page(fields))).toThrow(why);
  });

  const MEDIA = { youtube: "/assets/youtube.gif" };

  it("shows a demo as a figure, whole or one box of it, never inside a <p>", () => {
    const whole = parsePage(FILE, page(FIELDS, '![The note](demo:youtube "Caption.")'), MEDIA);
    expect(whole.html).toContain(
      '<figure class="demo"><div class="media"><img src="/assets/youtube.gif" alt="The note"',
    );
    expect(whole.html).toContain("<figcaption>Caption.</figcaption>");
    expect(whole.html).not.toContain("<p><figure");

    const crop = parsePage(
      FILE,
      page(FIELDS, "![The box](demo:youtube?crop=500,0,1000,250&of=1000,500)"),
      MEDIA,
    );
    expect(crop.html).toContain('style="max-width:750px"');
    expect(crop.html).toContain("aspect-ratio:500 / 250");
    expect(crop.html).toContain("width:200%;height:200%;left:-100%;top:0%");
  });

  it.each([
    ["an unknown demo", "![x](demo:nope)", /no demo called "nope"/],
    ["a demo with no alt text", "![](demo:youtube)", /needs alt text/],
    ["a crop outside the GIF", "![x](demo:youtube?crop=0,0,1200,10&of=1000,500)", /outside/],
  ])("fails the build on %s", (_, body, why) => {
    expect(() => parsePage(FILE, page(FIELDS, body), MEDIA)).toThrow(why);
  });

  it("shows a note file with its name, escaped", () => {
    const body = '```md title="A note.md"\n- a <b> line ^yt-12\n```';
    expect(parsePage(FILE, page(FIELDS, body)).html).toContain(
      '<figure class="file"><figcaption>A note.md</figcaption><pre><code>- a &lt;b&gt; line ^yt-12</code></pre></figure>',
    );
  });

  it("links each citation to its numbered source", () => {
    const body = "A claim.[^2]\n\n## Sources\n\n1. First.\n2. Second.";
    const { html } = parsePage(FILE, page(FIELDS, body));
    expect(html).toContain('<a href="#source-2" aria-label="Source 2">2</a>');
    expect(html).toContain('<h2 id="sources">Sources</h2>');
    expect(html).toContain('<li id="source-1">First.</li>');
    expect(html).toContain('<li id="source-2">Second.</li>');
  });

  it("fails the build on a citation with no source", () => {
    expect(() => parsePage(FILE, page(FIELDS, "A claim.[^3]\n\n## Sources\n\n1. One."))).toThrow(
      /\[\^3\]/,
    );
    expect(() => parsePage(FILE, page(FIELDS, "A claim.[^1]"))).toThrow(/no ## Sources/);
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
    for (const path of [
      "/",
      "/articles/",
      "/docs/",
      "/articles/example-page/",
      "/docs/second-page/",
    ]) {
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
      `## Articles\n\n- [An example page](${ORIGIN}/articles/example-page/): A page that exists only in this test.`,
    );
    expect(llms).not.toContain("## Essays");
  });
});
