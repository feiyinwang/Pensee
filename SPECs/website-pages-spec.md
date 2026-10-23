# Website: more pages from a content folder

Status: built. No pages yet.

## What it does

The website can hold more pages than the homepage: articles, docs and essays. Each page is one markdown file. The build turns it into a page in the site's look, with its own title, description, canonical URL and structured data, lists it on its type's index, and adds it to `sitemap.xml` and `llms.txt`. The site also serves `robots.txt`.

## A page

A markdown file at `apps/website/content/<type>/<slug>.md`. The types are a registry in `apps/website/src/pages/types.ts`:

| Type       | URL                 | Template      | Structured data                                                                           |
| ---------- | ------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `articles` | `/articles/<slug>/` | `ArticlePage` | SoftwareApplication; HowTo when it has numbered steps; FAQPage when it has `## Questions` |
| `docs`     | `/docs/<slug>/`     | `DocPage`     | FAQPage when it has `## Questions`                                                        |
| `essays`   | `/essays/<slug>/`   | `EssayPage`   | the page tags only                                                                        |

Frontmatter:

```yaml
---
title: An example page
description: One sentence, at most 160 characters.
slug: example-page
updated: 2026-10-21
draft: true # optional
painting: wright # optional: a key of PAINTINGS in src/content.ts
cta: try # optional: how the page ends (below)
next: /articles/other-page/ # needed by cta read-next and method
---
```

`title`, `description`, `slug` and `updated` are required. The build fails and names the file when a field is missing or malformed, when `slug` isn't the file's name, when a folder in `content/` isn't a type, when `painting` isn't in `PAINTINGS`, when `cta` isn't one of the five below, or when a `cta` that hands on to another page has no `next`. A published page whose `next` is a draft or missing fails too. A typo stops the build instead of shipping a page without a title.

A **draft** shows only in `vite dev`, with a Draft mark. The build still parses it (so a malformed draft fails), but leaves it out of every page, index, list and file.

## What the templates read from the markdown

- **Questions:** an `## Questions` section whose `### ` headings are questions and whose text under each is the answer. It reads as ordinary prose and becomes FAQPage JSON-LD.
- **Steps:** the first numbered list on a page is its steps, and becomes HowTo JSON-LD (articles only).
- **Sections:** every `## ` heading gets an id from its words (`## What you need` → `#what-you-need`, a repeat gets `-2`) and a row in the page's **On this page** list.
- **Demos:** `![what it shows](demo:youtube "Caption.")` is one of the README's demo GIFs (`assets/readme/<name>.gif`, the same files the homepage shows) as a captioned figure. `demo:youtube?crop=l,t,r,b&of=w,h` shows only that box of a `w`×`h` GIF, at most 1.5× the box's real width so its text stays sharp. An unknown name, a missing alt text or a box outside the GIF fails the build.
- **Note files:** a code block whose info string is `md title="A note.md"` is shown as a note file with its name above it.
- **Sources:** `[^2]` is a small superscript link to the second item of the page's `## Sources` numbered list, which gets ids `source-1` … A citation with no matching item, or citations with no `## Sources` list, fail the build.
- **Keys:** `<kbd>⌘S</kbd>` in the text is drawn as a keycap.

All of it comes from the page's own text, so nothing is written twice.

## How a page opens and ends

- **Opens:** the page's painting edge to edge, its title, section, date and description laid on it over a scrim, and the painting's credit in the corner. A page with no `painting` uses its type's (articles: Caravaggio, docs: Antonello, essays: Fragonard). A post's own painting is one the homepage doesn't show.
- **Ends**, by `cta` (default per type: articles `try`, docs `install`, essays `read-next`):

| `cta`       | The page ends with                                                                      |
| ----------- | --------------------------------------------------------------------------------------- |
| `read-next` | **Read next** and the `next` page's title and description; a quiet link to the homepage |
| `method`    | **Try the method** and the `next` page; a quiet link to the homepage                    |
| `try`       | **Try it in Pensée**: the download button, the requirements, the install line           |
| `switch`    | **Open your notes in Pensée**: the same download and install line                       |
| `install`   | **Install or update**: the install line, the upgrade command, Releases                  |

## On this page

A page with three or more `## ` sections lists them beside the text (`src/components/OnThisPage.tsx`).

- **Wide screens (1180px and up):** a 200px list right of the text, 64px from it, sticky under the bar. The section being read is in ink with a 2px bar beside it; the rest are muted.
- **Medium screens (760–1179px):** a column of ticks at the right edge, one per section, the current one dark. Hover or focus opens the full list as a small card. The ticks stay hidden while the opening painting fills the middle of the screen, so they never sit over its words.
- **Phones:** no list; the margin is the gutter.
- **Which section is marked:** the last heading above the middle of the visible pane (below the bar). Scrolled to the very end, the last heading on screen. A clicked row is marked at once and stays marked until the reader scrolls, touches or presses a key, so a short or last section isn't skipped. The bar slides between rows in 160ms (none with reduced motion).

## Sections appear with their first page

A type's index (`/articles/` …) and its link in the header and the footer exist only once the type has a page. With no pages, the bar and the footer are as they were and nothing new is built. The root route's loader tells both which types have pages (`SectionLinks`).

## URLs

- Every absolute URL comes from `SITE_URL` in `apps/website/src/site.ts`. A custom domain is a one-line change there.
- Pages end in `/` (`/articles/example-page/`): the build writes `articles/example-page/index.html`, and Cloudflare serves that folder at the slash URL and redirects the slashless one. Links and canonicals use the slash form. The router keeps whatever slash it's given (`trailingSlash: "preserve"`).

## Built files

- Each type's index lists its pages, newest `updated` first. The footer links each index, so `crawlLinks` prerenders the indexes and every page they link.
- `/sitemap.xml`: the homepage, each index that has pages, and every page, with `lastmod` from `updated`.
- `/robots.txt`: allows every crawler, and points at the sitemap.
- `/llms.txt`: in the llmstxt.org format: the site's name and summary, then a section per type that has pages, each page's link and description.

All three are server routes, prerendered at build (named in the prerender `pages` in `vite.config.ts`) from the same page list the routes use.

## Nothing new in the browser bundle

Pages load through server-only functions, so the markdown, `marked` and `yaml` run at build and never reach the browser. The site has no server at runtime: pages link with plain `<a>` tags (a full load of a prerendered file), never client-side navigation that would call a loader.
