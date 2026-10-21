/**
 * sitemap.xml, robots.txt and llms.txt, built from the same page list the
 * routes render (SPECs/website-pages-spec.md). Pure: the server routes
 * hand in the pages, tests hand in fixtures.
 */
import { absoluteUrl, SITE_NAME } from "../site";
import type { PageSummary } from "./parse";
import { indexPath, PAGE_TYPE_IDS, PAGE_TYPES } from "./types";

/** Crawlers many sites block by name; named here so it's plain they're allowed too. */
export const NAMED_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot"] as const;

const SUMMARY =
  "A free, open-source markdown notes app for the Mac, made for neurodivergent writers. Notes are plain markdown files in a folder of your own, and the AI is a second pen that helps you think in writing, not a ghostwriter.";

export function buildSitemap(pages: PageSummary[]): string {
  const newest = (list: PageSummary[]) =>
    list
      .map((p) => p.updated)
      .sort()
      .pop();
  const entries: { path: string; lastmod?: string }[] = [
    // The homepage changes apart from the pages, so it claims no date it can't back.
    { path: "/" },
    // A type gets an index only once it has a page.
    ...PAGE_TYPE_IDS.flatMap((type) => {
      const lastmod = newest(pages.filter((p) => p.type === type));
      return lastmod ? [{ path: indexPath(type), lastmod }] : [];
    }),
    ...pages.map((page) => ({ path: page.path, lastmod: page.updated })),
  ];
  const urls = entries.map(({ path, lastmod }) =>
    [
      "  <url>",
      `    <loc>${escapeXml(absoluteUrl(path))}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      "  </url>",
    ].join("\n"),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function buildRobots(): string {
  return [
    ...NAMED_CRAWLERS.flatMap((bot) => [`User-agent: ${bot}`, "Allow: /", ""]),
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}

/** The llmstxt.org format: a name, a one-line summary, then a section of links per type. */
export function buildLlms(pages: PageSummary[]): string {
  const sections = PAGE_TYPE_IDS.flatMap((type) => {
    const list = pages.filter((p) => p.type === type);
    if (list.length === 0) return [];
    return [
      `## ${PAGE_TYPES[type].name}`,
      "",
      ...list.map((p) => `- [${p.title}](${absoluteUrl(p.path)}): ${p.description}`),
      "",
    ];
  });
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    `Home and download: ${absoluteUrl("/")}`,
    "",
    ...sections,
  ].join("\n");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
