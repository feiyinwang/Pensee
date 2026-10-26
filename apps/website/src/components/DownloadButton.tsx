import { DOWNLOAD, DOWNLOAD_WINDOWS, FINE_PRINT, FINE_PRINT_WINDOWS } from "../content";
import { useVisitorOs } from "../visitor-os";

const APPLE = (
  <svg viewBox="0 0 14 17" fill="currentColor" aria-hidden="true">
    <path d="M11.6 9c0-2 1.7-3 1.7-3a3.7 3.7 0 0 0-2.9-1.6c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7A3.9 3.9 0 0 0 1.5 6.5C.1 9 1.1 12.6 2.5 14.6c.7 1 1.5 2 2.5 2s1.4-.6 2.6-.6 1.5.6 2.6.6 1.7-1 2.4-2a8 8 0 0 0 1-2.2S11.6 11.6 11.6 9ZM9.6 3.1A3.4 3.4 0 0 0 10.4.6a3.5 3.5 0 0 0-2.3 1.2 3.3 3.3 0 0 0-.8 2.4 2.9 2.9 0 0 0 2.3-1.1Z" />
  </svg>
);

const WINDOWS = (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M0 2.2 6.5 1.3v6.3H0Zm7.3-1L16 0v7.6H7.3ZM0 8.4h6.5v6.3L0 13.8Zm7.3 0H16V16l-8.7-1.2Z" />
  </svg>
);

/**
 * Downloads the newest release for the visitor's computer: the Mac zip, or
 * the Windows installer on Windows. `beta` adds the gold Beta tag: the page
 * says beta once, on the hero's button (SPECs/website-homepage-spec.md).
 */
export function DownloadButton({
  size,
  tone,
  beta = false,
}: {
  size?: "lg";
  tone?: "light";
  beta?: boolean;
}) {
  const windows = useVisitorOs() === "windows";
  return (
    <a
      className={["btn", size, tone].filter(Boolean).join(" ")}
      href={windows ? DOWNLOAD_WINDOWS : DOWNLOAD}
    >
      {windows ? WINDOWS : APPLE}
      {windows ? "Download for Windows" : "Download for Mac"}
      {beta && <span className="btn-tag">Beta</span>}
    </a>
  );
}

/**
 * What it runs on. A Windows visitor sees only Windows, so the page offers
 * one download. Elsewhere each platform links to its own download, so a Mac
 * visitor can fetch the Windows build for another computer.
 */
export function Requirements() {
  if (useVisitorOs() === "windows") {
    return (
      <>
        <span className="req">Free and open source</span> ·{" "}
        <span className="req">Windows 10 and 11</span>
      </>
    );
  }
  return (
    <>
      <span className="req">Free and open source</span> ·{" "}
      <span className="req">
        <a href={DOWNLOAD}>Mac</a> with Apple Silicon
      </span>{" "}
      ·{" "}
      <span className="req">
        <a href={DOWNLOAD_WINDOWS}>Windows</a> 10 and 11
      </span>
    </>
  );
}

/** The honest fine print for the visitor's computer: Gatekeeper on the Mac, SmartScreen on Windows. */
export function FinePrint() {
  return <p className="fine">{useVisitorOs() === "windows" ? FINE_PRINT_WINDOWS : FINE_PRINT}</p>;
}
