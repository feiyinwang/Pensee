import { createFileRoute } from "@tanstack/react-router";

import { buildRobots } from "../pages/feeds";

/** Prerendered to /robots.txt at build (the prerender pages in vite.config.ts). */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildRobots(), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
