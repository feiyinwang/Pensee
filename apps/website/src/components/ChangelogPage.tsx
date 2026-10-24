import type { CSSProperties } from "react";

import { PAINTINGS } from "../../../desktop/src/components/whats-new/paintings";
import { formatDay, paintingIndex } from "../../../desktop/src/lib/whats-new";
import type { ChangeDay } from "../pages/changelog.server";
import { InstallLine } from "./InstallLine";
import { SiteBar } from "./SiteBar";
import { SiteFooter } from "./SiteFooter";

export const TITLE = "What's new";
export const DESCRIPTION =
  "Every change to Pensée, newest first: the same days the app's What's new card shows when it updates.";

/**
 * Every day of the app's changelog, newest first (SPECs/whats-new-card-spec.md).
 * Each day hangs beside the painting the app's card gave it, so a reader who
 * came from Read all finds the same painting by the same day.
 */
export function ChangelogPage({ days }: { days: ChangeDay[] }) {
  const count = days.reduce((sum, day) => sum + day.changes.length, 0);
  return (
    <div className="page">
      <SiteBar />
      <main className="doc-main changelog">
        <header className="doc-head">
          <div className="eyebrow">Pensée · {count} changes</div>
          <h1>{TITLE}</h1>
          <p className="doc-stand">
            Every change to the app, newest first. When Pensée updates, a card in its corner shows
            what changed since you last looked; this is the whole list.
          </p>
        </header>
        {days.map((day) => (
          <Day key={day.date} day={day} />
        ))}
        <aside className="doc-cta doc-cta-app">
          <h2>Get the newest</h2>
          <InstallLine />
          <p className="doc-cta-quiet">
            Already installed? <code>brew upgrade --cask pensee</code>.
          </p>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}

function Day({ day }: { day: ChangeDay }) {
  const painting = PAINTINGS[paintingIndex(day.date, PAINTINGS.length)];
  const n = day.changes.length;
  return (
    <section className="change-day" id={day.date} aria-labelledby={`${day.date}-title`}>
      <header className="change-date">
        <figure className="change-art">
          <img
            src={painting.src}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ "--focus": painting.focus } as CSSProperties}
          />
          <figcaption>
            {painting.artist}, <i>{painting.title}</i>
          </figcaption>
        </figure>
        <h2 id={`${day.date}-title`}>
          <a href={`#${day.date}`}>{formatDay(day.date)}</a>
        </h2>
        <p className="change-meta">
          {day.date.slice(0, 4)} · {n === 1 ? "1 change" : `${n} changes`}
        </p>
      </header>
      <ul className="change-list">
        {day.changes.map((change, i) => (
          // Markdown from the repo's own CHANGELOG.md, rendered at build.
          <li key={i}>
            <strong dangerouslySetInnerHTML={{ __html: change.lead }} />
            <span dangerouslySetInnerHTML={{ __html: change.rest }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
