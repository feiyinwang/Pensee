import { createFileRoute } from "@tanstack/react-router";

import { publishedPages } from "../pages/content.server";
import { buildSitemap } from "../pages/feeds";

/** Prerendered to /sitemap.xml at build (the prerender pages in vite.config.ts). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildSitemap(publishedPages()), {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        }),
    },
  },
});
