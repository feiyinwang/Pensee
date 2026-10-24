import type { CSSProperties } from "react";

import { formatDay } from "../../../desktop/src/lib/whats-new";
import { MONTH_PAINTINGS } from "../changelog-paintings";
import type { ChangeDay, ChangeMonth } from "../pages/changelog.server";
import { InstallLine } from "./InstallLine";
import { SiteBar } from "./SiteBar";
import { SiteFooter } from "./SiteFooter";

export const TITLE = "What's new";
export const DESCRIPTION =
  "Every change to Pensée, newest first: the same days the app's What's new card shows when it updates.";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

/**
 * Every day of the app's changelog, newest first, by month
 * (SPECs/whats-new-card-spec.md). Each month hangs its own painting, never
 * shown twice on the site (src/changelog-paintings.ts).
 */
export function ChangelogPage({ months }: { months: ChangeMonth[] }) {
  const count = months.reduce(
    (sum, m) => sum + m.days.reduce((n, day) => n + day.changes.length, 0),
    0,
  );
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
        {months.map((m) => (
          <Month key={m.month} month={m} />
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

function Month({ month: { month, days } }: { month: ChangeMonth }) {
  const painting = MONTH_PAINTINGS[month];
  const n = days.reduce((sum, day) => sum + day.changes.length, 0);
  return (
    <section className="change-month" id={month} aria-labelledby={`${month}-title`}>
      <header className="change-month-head">
        <figure className="change-art">
          <img
            src={painting.src}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ "--focus": painting.focus } as CSSProperties}
          />
          <figcaption>
            {painting.by}, <i>{painting.title}</i>, {painting.year}
          </figcaption>
        </figure>
        <h2 id={`${month}-title`}>{MONTH.format(new Date(`${month}-01T00:00:00Z`))}</h2>
        <p className="change-meta">
          {month.slice(0, 4)} · {changes(n)}
        </p>
      </header>
      <div className="change-days">
        {days.map((day) => (
          <Day key={day.date} day={day} />
        ))}
      </div>
    </section>
  );
}

function Day({ day }: { day: ChangeDay }) {
  return (
    <section className="change-day" id={day.date} aria-labelledby={`${day.date}-title`}>
      <header className="change-day-head">
        <h3 id={`${day.date}-title`}>
          <a href={`#${day.date}`}>{formatDay(day.date)}</a>
        </h3>
        <span className="change-meta">{changes(day.changes.length)}</span>
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
