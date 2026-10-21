/**
 * Every page in `apps/website/content/`, read and checked at build. Server
 * only (the `.server` name makes TanStack Start refuse it in the browser
 * bundle): pages reach the browser as prerendered HTML, not as markdown.
 */
import { parsePage, summarize, type Page, type PageSummary } from "./parse";
import { PAGE_TYPE_IDS, type PageType } from "./types";

const files = import.meta.glob<string>("../../content/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Newest first, the order every list on the site uses. A draft is parsed (so
 * a malformed one still fails the build) but only shows in `vite dev`.
 */
export const PAGES: readonly Page[] = Object.entries(files)
  .map(([file, raw]) => parsePage(file, raw))
  .filter((page) => import.meta.env.DEV || !page.draft)
  .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));

export function findPage(type: PageType, slug: string): Page | undefined {
  return PAGES.find((page) => page.type === type && page.slug === slug);
}

export function listPages(type: PageType): PageSummary[] {
  return PAGES.filter((page) => page.type === type).map(summarize);
}

/** The types that have a page: only these get an index and a footer link. */
export function typesWithPages(): PageType[] {
  return PAGE_TYPE_IDS.filter((type) => PAGES.some((page) => page.type === type));
}

/** What sitemap.xml and llms.txt list: never a draft, even in dev. */
export function publishedPages(): PageSummary[] {
  return PAGES.filter((page) => !page.draft).map(summarize);
}
