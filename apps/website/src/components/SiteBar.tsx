import { DownloadButton } from "./DownloadButton";
import { PenseeMark } from "./Mark";
import { SectionLinks } from "./SectionLinks";

/**
 * The sticky header on every page: the lockup, the section links, What's new
 * and Download.
 * The homepage passes `dark` while its hero painting is under the bar: the bar
 * then has no card, only light words on the painting, and its cream card fades
 * in once the hero has scrolled past.
 * The homepage also passes `downloadShown={false}` until the hero has scrolled
 * past, so the page never shows two Download buttons at once. Hidden, it takes
 * no room, so the section links sit at the right edge until it comes in.
 */
export function SiteBar({
  onHome,
  downloadShown = true,
  dark = false,
}: {
  onHome?: boolean;
  downloadShown?: boolean;
  dark?: boolean;
}) {
  return (
    <header className="bar" data-dark={dark || undefined}>
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
