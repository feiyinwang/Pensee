/**
 * A route's head(): its own title, description, canonical, og tags and
 * JSON-LD. These replace the root's tags of the same name (the deepest route
 * wins), so every page says what it is, not what the homepage is.
 */
import { absoluteUrl, SITE_NAME } from "../site";
import type { JsonLd } from "./jsonld";

export function pageHead({
  title,
  description,
  path,
  draft = false,
  ogType = "article",
  jsonLd = [],
}: {
  title: string;
  description: string;
  path: string;
  /** Drafts only show in `vite dev`; noindex in case one is ever served. */
  draft?: boolean;
  ogType?: "article" | "website";
  jsonLd?: (JsonLd | null)[];
}) {
  const url = absoluteUrl(path);
  const fullTitle = `${title} · ${SITE_NAME}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: url },
      { property: "og:site_name", content: SITE_NAME },
      ...(draft ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: jsonLd.filter((data): data is JsonLd => data !== null).map(jsonLdScript),
  };
}

/** A head() script for JSON-LD. "<" is escaped so text like "</script>" can't end the tag early. */
export function jsonLdScript(data: JsonLd) {
  return { type: "application/ld+json", children: JSON.stringify(data).replace(/</g, "\\u003c") };
}
