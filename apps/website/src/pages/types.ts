/**
 * The kinds of page beside the homepage, one entry each. A page's folder in
 * `content/`, its URL, its index and its section in llms.txt all come from
 * here (SPECs/website-pages-spec.md).
 */
export const PAGE_TYPES = {
  articles: {
    name: "Folios",
    summary: "Doing one thing in Pensée, start to finish.",
  },
  docs: {
    name: "Docs",
    summary: "How each part of Pensée works.",
  },
  essays: {
    name: "Essays",
    summary: "On writing, thinking and notes.",
  },
} as const;

export type PageType = keyof typeof PAGE_TYPES;

export const PAGE_TYPE_IDS = Object.keys(PAGE_TYPES) as PageType[];

export function isPageType(value: string): value is PageType {
  return Object.prototype.hasOwnProperty.call(PAGE_TYPES, value);
}

/** `/articles/`: indexes and pages end in a slash, the URL Cloudflare serves a folder's index.html at. */
export function indexPath(type: PageType): string {
  return `/${type}/`;
}

export function pagePath(type: PageType, slug: string): string {
  return `/${type}/${slug}/`;
}
