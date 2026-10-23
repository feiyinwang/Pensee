import { REPO } from "../content";
import { SectionLinks } from "./SectionLinks";

/**
 * The footer on every page. Its section links are how the prerender's crawl
 * finds the indexes and, through them, every page.
 */
export function SiteFooter() {
  return (
    <footer className="foot">
      <span>Pensée is GPL v3. Neither the app nor this site collects usage data.</span>
      <SectionLinks />
      <nav aria-label="Project">
        <a href={REPO}>GitHub</a>
        <a href={`${REPO}/releases`}>Releases</a>
        <a href={`${REPO}/blob/master/LICENSE`}>License</a>
      </nav>
    </footer>
  );
}
