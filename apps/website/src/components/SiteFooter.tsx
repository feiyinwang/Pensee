import { useLoaderData } from "@tanstack/react-router";

import { REPO } from "../content";
import { indexPath, PAGE_TYPES } from "../pages/types";

/**
 * The footer on every page. It links the index of each type that has a page
 * (the root loader says which), which is how the prerender's crawl finds the
 * indexes and, through them, every page. With no pages it links none.
 */
export function SiteFooter() {
  const sections = useLoaderData({ from: "__root__" });
  return (
    <footer className="foot">
      <span>Pensée is GPL v3. Neither the app nor this site collects usage data.</span>
      {sections.length > 0 && (
        <nav aria-label="Pages">
          {sections.map((type) => (
            <a href={indexPath(type)} key={type}>
              {PAGE_TYPES[type].name}
            </a>
          ))}
        </nav>
      )}
      <nav aria-label="Project">
        <a href={REPO}>GitHub</a>
        <a href={`${REPO}/releases`}>Releases</a>
        <a href={`${REPO}/blob/master/LICENSE`}>License</a>
      </nav>
    </footer>
  );
}
