/**
 * Route loaders read pages through server-only functions: the markdown and its
 * parser run at build, and the browser gets the result already in the HTML
 * plus a stub that throws. The site has no server at runtime, so a loader
 * must never run in the browser: pages link with plain <a> (a full load of a
 * prerendered file), never <Link>, whose client navigation or hover preload
 * would call the loader there.
 */
import { notFound } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

import { findPage, listPages, typesWithPages } from "./content.server";
import type { Page, PageSummary } from "./parse";
import type { PageType } from "./types";

export const loadPage = createServerOnlyFn((type: PageType, slug: string): Page => {
  const page = findPage(type, slug);
  if (!page) throw notFound();
  return page;
});

/** A type with no pages has no index: nothing links it, and it would only say "nothing here". */
export const loadPageList = createServerOnlyFn((type: PageType): PageSummary[] => {
  const pages = listPages(type);
  if (pages.length === 0) throw notFound();
  return pages;
});

export const loadSections = createServerOnlyFn((): PageType[] => typesWithPages());
