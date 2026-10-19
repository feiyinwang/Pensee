import { DOWNLOAD } from "../content";

/**
 * Downloads the newest release's zip directly. `beta` adds the gold Beta tag:
 * the page says beta once, on the hero's button (SPECs/website-homepage-spec.md).
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
  return (
    <a className={["btn", size, tone].filter(Boolean).join(" ")} href={DOWNLOAD}>
      <svg viewBox="0 0 14 17" fill="currentColor" aria-hidden="true">
        <path d="M11.6 9c0-2 1.7-3 1.7-3a3.7 3.7 0 0 0-2.9-1.6c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7A3.9 3.9 0 0 0 1.5 6.5C.1 9 1.1 12.6 2.5 14.6c.7 1 1.5 2 2.5 2s1.4-.6 2.6-.6 1.5.6 2.6.6 1.7-1 2.4-2a8 8 0 0 0 1-2.2S11.6 11.6 11.6 9ZM9.6 3.1A3.4 3.4 0 0 0 10.4.6a3.5 3.5 0 0 0-2.3 1.2 3.3 3.3 0 0 0-.8 2.4 2.9 2.9 0 0 0 2.3-1.1Z" />
      </svg>
      Download for Mac
      {beta && <span className="btn-tag">Beta</span>}
    </a>
  );
}
