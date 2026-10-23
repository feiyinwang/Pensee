import type { ReactNode } from "react";

import { PAINTINGS, REPO, REQUIREMENTS, type Painting as PaintingData } from "../content";
import type { LoadedPage } from "../pages/load";
import type { PageSummary, PaintingId } from "../pages/parse";
import { indexPath, pagePath, PAGE_TYPES, type PageType } from "../pages/types";
import { DownloadButton } from "./DownloadButton";
import { InstallLine } from "./InstallLine";
import { OnThisPage } from "./OnThisPage";
import { Credit, Painting } from "./Painting";
import { SiteBar } from "./SiteBar";
import { SiteFooter } from "./SiteFooter";

/**
 * The page templates (SPECs/website-pages-spec.md): the homepage's bar, the
 * page's own painting edge to edge with its title on it, the words set in the
 * site's type, and a closing that fits what the reader came for.
 */

/** A page that names no painting opens on its type's. */
const TYPE_PAINTING: Record<PageType, PaintingId> = {
  articles: "caravaggio",
  docs: "antonello",
  essays: "fragonard",
};

export function ArticlePage({ page }: { page: LoadedPage }) {
  return <Article page={page} />;
}

export function DocPage({ page }: { page: LoadedPage }) {
  return <Article page={page} />;
}

export function EssayPage({ page }: { page: LoadedPage }) {
  return <Article page={page} essay />;
}

/** `/articles/` and the others: every page of one type, newest first. */
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

function Article({ page, essay = false }: { page: LoadedPage; essay?: boolean }) {
  const painting: PaintingData = PAINTINGS[page.painting ?? TYPE_PAINTING[page.type]];
  // A list of two sections says nothing the page doesn't show at a glance.
  const toc = page.outline.length >= 3;
  return (
    <Shell hero={<PageHero page={page} painting={painting} />} wide={toc}>
      <article className={essay ? "doc essay" : "doc"}>
        {/* Markdown from the repo's own content folder, rendered at build. */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        <Closing page={page} />
      </article>
      {toc && (
        <aside className="toc-rail">
          <OnThisPage outline={page.outline} />
        </aside>
      )}
    </Shell>
  );
}

/** The page's painting edge to edge, its title laid on it over a scrim. */
function PageHero({ page, painting }: { page: LoadedPage; painting: PaintingData }) {
  return (
    <header className="full post-hero">
      <Painting painting={painting} eager />
      <div className="scrim" />
      <div className="over">
        <div className="eyebrow">
          <a href={indexPath(page.type)}>{PAGE_TYPES[page.type].name}</a> ·{" "}
          <Updated date={page.updated} />
        </div>
        <h1>
          {page.title}
          {page.draft && <DraftTag />}
        </h1>
        <p className="stand">{page.description}</p>
      </div>
      <p className="credit">
        <Credit painting={painting} /> · {painting.at}
      </p>
    </header>
  );
}

/**
 * How the page ends, by what its reader knows by now: an essay hands on to
 * the next read; a page about the problem hands on to the method; an article
 * offers the app to try it in; a page for someone choosing apps offers the
 * download and the install line; a doc, read by someone who has the app,
 * the install and update lines.
 */
function Closing({ page }: { page: LoadedPage }) {
  const next = page.nextPage;
  switch (page.cta) {
    case "read-next":
      return (
        <aside className="doc-cta">
          {next && <NextRead label="Read next" page={next} />}
          <p className="doc-cta-quiet">
            Pensée is the notes app I’m making for this. <a href="/">See how it works</a>.
          </p>
        </aside>
      );
    case "method":
      return (
        <aside className="doc-cta">
          {next && <NextRead label="Try the method" page={next} />}
          <p className="doc-cta-quiet">
            Or go straight to the app: <a href="/">Pensée</a>, free for the Mac.
          </p>
        </aside>
      );
    case "try":
    case "switch":
      return (
        <aside className="doc-cta doc-cta-app">
          <h2>{page.cta === "switch" ? "Open your notes in Pensée" : "Try it in Pensée"}</h2>
          <div className="doc-cta-row">
            <DownloadButton />
            <span>{REQUIREMENTS}</span>
          </div>
          <InstallLine />
        </aside>
      );
    case "install":
      return (
        <aside className="doc-cta doc-cta-app">
          <h2>Install or update</h2>
          <InstallLine />
          <p className="doc-cta-quiet">
            Already installed? <code>brew upgrade --cask pensee</code>. What changed in each
            version: <a href={`${REPO}/releases`}>Releases</a>.
          </p>
        </aside>
      );
  }
}

function NextRead({ label, page }: { label: string; page: PageSummary }) {
  return (
    <a className="doc-next" href={page.path}>
      <span className="eyebrow">{label}</span>
      <span className="doc-next-title">{page.title}</span>
      <span className="doc-next-desc">{page.description}</span>
    </a>
  );
}

function Shell({
  hero,
  wide = false,
  children,
}: {
  hero?: ReactNode;
  /** Room for the On this page list beside the text. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <SiteBar />
      {hero}
      <main className={wide ? "doc-main has-toc" : "doc-main"}>{children}</main>
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
