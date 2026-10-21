import type { ReactNode } from "react";

import { PAINTINGS, REQUIREMENTS, type Painting as PaintingData } from "../content";
import type { Page, PageSummary } from "../pages/parse";
import { indexPath, pagePath, PAGE_TYPES, type PageType } from "../pages/types";
import { DownloadButton } from "./DownloadButton";
import { PenseeMark } from "./Mark";
import { Credit, Painting } from "./Painting";
import { SiteFooter } from "./SiteFooter";

/**
 * The page templates (SPECs/website-pages-spec.md): the homepage's bar, a
 * painting, the page's words set in the site's type, and the download at the
 * end. Each type is the same frame with its own painting and measure.
 */

export function GuidePage({ page }: { page: Page }) {
  return <Article page={page} painting={PAINTINGS.caravaggio} closing />;
}

export function DocPage({ page }: { page: Page }) {
  return <Article page={page} painting={PAINTINGS.antonello} />;
}

export function EssayPage({ page }: { page: Page }) {
  return <Article page={page} painting={PAINTINGS.fragonard} essay />;
}

/** `/guides/` and the others: every page of one type, newest first. */
export function PageIndex({ type, pages }: { type: PageType; pages: PageSummary[] }) {
  const { name, summary } = PAGE_TYPES[type];
  return (
    <Shell>
      <header className="doc-head">
        <div className="eyebrow">
          Pensée · {pages.length === 1 ? "1 page" : `${pages.length} pages`}
        </div>
        <h1>{name}</h1>
        <p className="doc-stand">{summary}</p>
      </header>
      <ul className="doc-list">
        {pages.map((page) => (
          <li key={page.slug}>
            <a href={pagePath(page.type, page.slug)}>
              <span className="doc-list-title">
                {page.title}
                {page.draft && <DraftTag />}
              </span>
              <span className="doc-list-desc">{page.description}</span>
              <Updated date={page.updated} />
            </a>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Article({
  page,
  painting,
  closing = false,
  essay = false,
}: {
  page: Page;
  painting: PaintingData;
  closing?: boolean;
  essay?: boolean;
}) {
  return (
    <Shell>
      <article className={essay ? "doc essay" : "doc"}>
        <Painting painting={painting} eager>
          <figcaption>
            <Credit painting={painting} />
            <small>{painting.at}</small>
          </figcaption>
        </Painting>
        <header className="doc-head">
          <div className="eyebrow">
            <a href={indexPath(page.type)}>{PAGE_TYPES[page.type].name}</a> ·{" "}
            <Updated date={page.updated} />
          </div>
          <h1>
            {page.title}
            {page.draft && <DraftTag />}
          </h1>
          <p className="doc-stand">{page.description}</p>
        </header>
        {/* Markdown from the repo's own content folder, rendered at build. */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        {closing && (
          <aside className="doc-cta">
            <DownloadButton />
            <span>{REQUIREMENTS}</span>
          </aside>
        )}
      </article>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <header className="bar">
        <a className="lockup" href="/" aria-label="Pensée, home">
          <PenseeMark size={18} />
          <span className="wordmark">PENSÉE</span>
        </a>
        <DownloadButton />
      </header>
      <main className="doc-main">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Drafts show only in `vite dev`; this says so on the page. */
function DraftTag() {
  return <span className="draft-tag">Draft</span>;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function Updated({ date }: { date: string }) {
  return <time dateTime={date}>Updated {DAY.format(new Date(`${date}T00:00:00Z`))}</time>;
}
