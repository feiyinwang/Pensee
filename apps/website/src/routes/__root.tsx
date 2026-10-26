/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { loadSections } from "../pages/load";
import styles from "../styles.css?url";

const TITLE = "Pensée — Thinking, made by writing";
const DESCRIPTION =
  "A markdown notes app for Mac and Windows, made for neurodivergent minds: what you collect becomes what you understand, and the AI is a second pen, not a ghostwriter.";

export const Route = createRootRoute({
  // Which page types have pages, for the footer on every page.
  loader: () => loadSections(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Pensée" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#f4f2ee" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;1,6..96,400&display=swap",
      },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Without JavaScript the demos never get .play: show their final frame instead. */}
        <noscript>
          <style>{".sc * { animation: none !important; }"}</style>
        </noscript>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
