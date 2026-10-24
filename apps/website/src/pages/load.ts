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

import { changelogMonths, type ChangeMonth } from "./changelog.server";
import { findPage, findPath, listPages, typesWithPages } from "./content.server";
import { summarize, type Page, type PageSummary } from "./parse";
import type { PageType } from "./types";

/** A page, and the page its closing hands on to. */
export type LoadedPage = Page & { nextPage?: PageSummary };

export const loadPage = createServerOnlyFn((type: PageType, slug: string): LoadedPage => {
  const page = findPage(type, slug);
  if (!page) throw notFound();
  if (!page.next) return page;
  const next = findPath(page.next);
  // At build a published page can't hand on to a draft or a missing page.
  if (!next) throw new Error(`${page.path}: next "${page.next}" is not a published page`);
  return { ...page, nextPage: summarize(next) };
});

/** A type with no pages has no index: nothing links it, and it would only say "nothing here". */
export const loadPageList = createServerOnlyFn((type: PageType): PageSummary[] => {
  const pages = listPages(type);
  if (pages.length === 0) throw notFound();
  return pages;
});

export const loadSections = createServerOnlyFn((): PageType[] => typesWithPages());

export const loadChangelog = createServerOnlyFn((): ChangeMonth[] => changelogMonths());
