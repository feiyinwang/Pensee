import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

export default defineConfig({
  plugins: [
    devtools(),
    tanstackStart({
      prerender: {
        enabled: true,
        // From the homepage the crawl follows the footer to each type's index and on to every page.
        crawlLinks: true,
        // Only what's linked or named below is built: a type with no pages has an index route
        // but no index, so it must not be prerendered just for existing.
        autoStaticPathsDiscovery: false,
      },
      // Nothing links these, so they're named. Built from the content list (src/pages/feeds.ts).
      pages: [
        { path: "/" },
        { path: "/sitemap.xml" },
        { path: "/robots.txt" },
        { path: "/llms.txt" },
      ],
    }),
    react(),
  ],
  server: {
    port: 5173,
  },
});
