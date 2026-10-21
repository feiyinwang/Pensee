# Website: more pages from a content folder

Status: built. No pages yet.

## What it does

The website can hold more pages than the homepage: guides, docs and essays. Each page is one markdown file. The build turns it into a page in the site's look, with its own title, description, canonical URL and structured data, lists it on its type's index, and adds it to `sitemap.xml` and `llms.txt`. The site also serves `robots.txt`.

## A page

A markdown file at `apps/website/content/<type>/<slug>.md`. The types are a registry in `apps/website/src/pages/types.ts`:

| Type     | URL               | Template    | Structured data                                                                           |
| -------- | ----------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `guides` | `/guides/<slug>/` | `GuidePage` | SoftwareApplication; HowTo when it has numbered steps; FAQPage when it has `## Questions` |
| `docs`   | `/docs/<slug>/`   | `DocPage`   | FAQPage when it has `## Questions`                                                        |
| `essays` | `/essays/<slug>/` | `EssayPage` | the page tags only                                                                        |

Frontmatter:

```yaml
---
title: An example page
description: One sentence, at most 160 characters.
slug: example-page
updated: 2026-10-21
draft: true # optional
---
```

`title`, `description`, `slug` and `updated` are required. The build fails and names the file when a field is missing or malformed, when `slug` isn't the file's name, or when a folder in `content/` isn't a type. A typo stops the build instead of shipping a page without a title.

A **draft** shows only in `vite dev`, with a Draft mark. The build still parses it (so a malformed draft fails), but leaves it out of every page, index, list and file.

## What the templates read from the markdown

- **Questions:** an `## Questions` section whose `### ` headings are questions and whose text under each is the answer. It reads as ordinary prose and becomes FAQPage JSON-LD.
- **Steps:** the first numbered list on a page is its steps, and becomes HowTo JSON-LD (guides only).

Both come from the page's own text, so nothing is written twice.

## Sections appear with their first page

A type's index (`/guides/` …) and its link in the footer exist only once the type has a page. With no pages, the footer is as it was and nothing new is built. The root route's loader tells the footer which types have pages.

## URLs

- Every absolute URL comes from `SITE_URL` in `apps/website/src/site.ts`. A custom domain is a one-line change there.
- Pages end in `/` (`/guides/example-page/`): the build writes `guides/example-page/index.html`, and Cloudflare serves that folder at the slash URL and redirects the slashless one. Links and canonicals use the slash form. The router keeps whatever slash it's given (`trailingSlash: "preserve"`).

## Built files

- Each type's index lists its pages, newest `updated` first. The footer links each index, so `crawlLinks` prerenders the indexes and every page they link.
- `/sitemap.xml`: the homepage, each index that has pages, and every page, with `lastmod` from `updated`.
- `/robots.txt`: allows every crawler, and points at the sitemap.
- `/llms.txt`: in the llmstxt.org format: the site's name and summary, then a section per type that has pages, each page's link and description.

All three are server routes, prerendered at build (named in the prerender `pages` in `vite.config.ts`) from the same page list the routes use.

## Nothing new in the browser bundle

Pages load through server-only functions, so the markdown, `marked` and `yaml` run at build and never reach the browser. The site has no server at runtime: pages link with plain `<a>` tags (a full load of a prerendered file), never client-side navigation that would call a loader.
