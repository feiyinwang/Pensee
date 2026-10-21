import { createFileRoute } from "@tanstack/react-router";

import { publishedPages } from "../pages/content.server";
import { buildLlms } from "../pages/feeds";

/** Prerendered to /llms.txt at build (the prerender pages in vite.config.ts). */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildLlms(publishedPages()), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
