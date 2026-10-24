import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect, useState } from "react";
import { useOnboardingStore } from "@/components/onboarding/onboarding-store";
import {
  firstSentence,
  formatDays,
  inlineParts,
  paintingIndex,
  type ChangelogDay,
} from "@/lib/whats-new";
import { PAINTINGS } from "./paintings";
import { checkWhatsNew, dismissWhatsNew, useWhatsNewStore } from "./whats-new-store";
import "./whats-new.css";

/** The website's What's new page (apps/website/src/routes/changelog.tsx);
 *  the host is the site's SITE_URL (apps/website/src/site.ts). */
const CHANGELOG_PAGE = "https://pensee-website.zhhv5f4p77.workers.dev/changelog/";

/** Entries shown before "N more". */
const SHOWN = 3;

/** The card's fade-out: --motion-fast (App.css). */
const LEAVE_MS = 100;

/** The What's new card (SPECs/whats-new-card-spec.md): the changes since the
 *  writer last looked, in the corner, once per app update. It waits while
 *  onboarding is open. */
export function WhatsNew() {
  useEffect(() => {
    void checkWhatsNew();
  }, []);

  const days = useWhatsNewStore((s) => s.days);
  const onboardingOpen = useOnboardingStore((s) => s.open);
  if (!days || onboardingOpen) return null;
  return <WhatsNewCard key={days[0].date} days={days} />;
}

function WhatsNewCard({ days }: { days: ChangelogDay[] }) {
  const [all, setAll] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const newest = days[0].date;
  const painting = PAINTINGS[paintingIndex(newest, PAINTINGS.length)];
  const changes = days.flatMap((day) => day.entries);
  const count = changes.length;
  const rest = count - SHOWN;
  const entries = all ? changes : changes.slice(0, SHOWN);

  // The card fades out on --motion-fast, then closes. A timer, not
  // transitionend: a hidden window sends no transition events.
  const close = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void dismissWhatsNew();
      return;
    }
    setLeaving(true);
    window.setTimeout(() => void dismissWhatsNew(), LEAVE_MS);
  };

  const readAll = () => {
    void openUrl(`${CHANGELOG_PAGE}#${newest}`).catch((error: unknown) =>
      console.error("[whats-new] Failed to open the changelog:", error),
    );
    close();
  };

  return (
    <section
      className="whats-new surface-card surface-card-opaque popover-outline"
      aria-labelledby="whats-new-title"
      data-leaving={leaving || undefined}
    >
      <figure className="whats-new-art">
        <img src={painting.src} alt="" style={{ objectPosition: painting.focus }} />
        <figcaption>
          {painting.artist}, <i>{painting.title}</i>, {painting.year}
        </figcaption>
      </figure>
      <div className="whats-new-body">
        <div className="whats-new-eyebrow">
          What's new · {count === 1 ? "1 change" : `${count} changes`}
        </div>
        <h2 id="whats-new-title" className="whats-new-title">
          {formatDays(days)}
        </h2>
        <ul className="whats-new-list" data-all={all || undefined}>
          {entries.map((entry, i) => (
            <li
              key={i}
              className="whats-new-item"
              style={{ "--i": all ? i - SHOWN : i } as React.CSSProperties}
            >
              <span>
                {inlineParts(firstSentence(entry)).map((part, j) =>
                  part.kind === "code" ? (
                    <code key={j}>{part.text}</code>
                  ) : part.kind === "em" ? (
                    <em key={j}>{part.text}</em>
                  ) : (
                    <Fragment key={j}>{part.text}</Fragment>
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
        {!all && rest > 0 && (
          <button type="button" className="whats-new-more" onClick={() => setAll(true)}>
            {rest} more
          </button>
        )}
        <div className="whats-new-actions">
          <button type="button" className="whats-new-button" onClick={close}>
            Got it
          </button>
          <button type="button" className="whats-new-link" onClick={readAll}>
            Read all
          </button>
        </div>
      </div>
    </section>
  );
}
