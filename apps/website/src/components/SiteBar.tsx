import { DownloadButton } from "./DownloadButton";
import { PenseeMark } from "./Mark";
import { SectionLinks } from "./SectionLinks";

/**
 * The sticky header on every page: the lockup, the section links, What's new
 * and Download.
 * The homepage passes `downloadShown={false}` while its hero's own Download
 * button is on screen, so the page never shows two at once. Hidden, it takes
 * no room, so the section links sit at the right edge until it comes in.
 */
export function SiteBar({
  onHome,
  downloadShown = true,
}: {
  onHome?: boolean;
  downloadShown?: boolean;
}) {
  return (
    <header className="bar">
      <a
        className="lockup"
        href={onHome ? "#top" : "/"}
        aria-label={onHome ? "Pensée, back to top" : "Pensée, home"}
      >
        <PenseeMark size={18} />
        <span className="wordmark">PENSÉE</span>
      </a>
      <div className="bar-end" data-download={downloadShown ? "shown" : "hidden"}>
        <SectionLinks className="bar-links">
          <a href="/changelog/" className="bar-whats-new">
            What's new
          </a>
        </SectionLinks>
        <span className="bar-download">
          <DownloadButton />
        </span>
      </div>
    </header>
  );
}
