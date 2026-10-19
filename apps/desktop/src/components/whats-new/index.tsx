import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect, useState } from "react";
import { useOnboardingStore } from "@/components/onboarding/onboarding-store";
import { restartApp } from "@/lib/tauri";
import {
  firstSentence,
  formatDay,
  inlineParts,
  paintingIndex,
  type ChangelogDay,
} from "@/lib/whats-new";
import { PAINTINGS } from "./paintings";
import {
  CHECK_EVERY_MS,
  checkWhatsNew,
  dismissWhatsNew,
  startUpgrade,
  useWhatsNewStore,
  type UpgradeState,
} from "./whats-new-store";
import "./whats-new.css";

const CHANGELOG_PAGE = "https://github.com/feiyinwang/Pensee/blob/master/CHANGELOG.md";

/** Entries shown before "N more". */
const SHOWN = 3;

/** The card's fade-out: --motion-fast (App.css). */
const LEAVE_MS = 100;

/** The What's new card (SPECs/whats-new-card-spec.md): a day of changes in
 *  the corner, once per update. It waits while onboarding is open. */
export function WhatsNew() {
  useEffect(() => {
    void checkWhatsNew();
    const timer = window.setInterval(() => void checkWhatsNew(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const day = useWhatsNewStore((s) => s.day);
  const release = useWhatsNewStore((s) => s.release);
  const onboardingOpen = useOnboardingStore((s) => s.open);
  if (!day || onboardingOpen) return null;
  return <WhatsNewCard key={day.date} day={day} release={release} />;
}

/** The Update button's label at each step of an upgrade. */
const UPGRADE_LABEL: Record<UpgradeState["step"], string> = {
  idle: "Update",
  running: "Downloading…",
  done: "Restart Pensée",
  failed: "Try again",
};

function WhatsNewCard({ day, release }: { day: ChangelogDay; release: string | null }) {
  const upgrade = useWhatsNewStore((s) => s.upgrade);
  const [all, setAll] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const painting = PAINTINGS[paintingIndex(day.date, PAINTINGS.length)];
  const count = day.entries.length;
  const rest = count - SHOWN;
  const entries = all ? day.entries : day.entries.slice(0, SHOWN);

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
    void openUrl(CHANGELOG_PAGE).catch((error: unknown) =>
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
          {release ? `Pensée ${release}` : formatDay(day.date)}
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
        {release && upgrade.step === "failed" && (
          <p className="whats-new-error" role="alert">
            {upgrade.error}
          </p>
        )}
        <div className="whats-new-actions">
          {release && (
            <button
              type="button"
              className="whats-new-update"
              disabled={upgrade.step === "running"}
              aria-busy={upgrade.step === "running" || undefined}
              onClick={() => {
                if (upgrade.step === "done") {
                  void restartApp().catch((error: unknown) =>
                    console.error("[whats-new] Failed to restart:", error),
                  );
                } else void startUpgrade();
              }}
            >
              {UPGRADE_LABEL[upgrade.step]}
            </button>
          )}
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
