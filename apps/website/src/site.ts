/**
 * Where the site lives. Every absolute URL (canonicals, og:url, JSON-LD,
 * sitemap.xml, robots.txt, llms.txt) is built from this, so moving to a
 * custom domain is this one line (SPECs/website-pages-spec.md).
 */
export const SITE_URL = "https://pensee-website.zhhv5f4p77.workers.dev";

export const SITE_NAME = "Pensée";

/**
 * OpenAnalytics (github.com/every-app/open-analytics), self-hosted on our
 * own Cloudflare account: no cookies, no stored IPs. The host is the app's
 * origin (`https://analytics.<gateway domain>`) and the site ID comes from
 * that site's Settings page. Either one empty → no tag, no analytics.
 */
export const ANALYTICS_HOST: string = "";
export const ANALYTICS_SITE_ID: string = "";

/** `/articles/example-page/` → `https://…/articles/example-page/`. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
