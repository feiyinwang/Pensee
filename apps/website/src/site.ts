/**
 * Where the site lives. Every absolute URL (canonicals, og:url, JSON-LD,
 * sitemap.xml, robots.txt, llms.txt) is built from this, so moving to a
 * custom domain is this one line (SPECs/website-pages-spec.md).
 */
export const SITE_URL = "https://pensee-website.zhhv5f4p77.workers.dev";

export const SITE_NAME = "Pensée";

/** `/guides/example-page/` → `https://…/guides/example-page/`. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
