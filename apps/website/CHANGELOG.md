# Website changelog

Changes to the website (`apps/website/`). The app's own changes are in the repo's `CHANGELOG.md`, which the app's What's new card and the website's What's new page read.

## 2026-10-24

- What's new shows only Pensée's own changes, from August 13, 2026 on. The entries Joel wrote in the project Pensée was forked from moved to `docs/upstream-changelog.md`, with his old website's entries from this file.
- What's new is laid out by month, each under a painting no other month or page on the site uses: October hangs Gabriel Metsu's _Man Writing a Letter_, new to the site; August and September two of the What's new card's paintings that weren't already on the site. Each month's painting, name and count stay in view while its days scroll by. A month with no painting of its own fails the build, so the next one is always chosen fresh.
- The header now links to What's new, after Folios, on every page. On phones it stays in the footer, where it fits.
- The website has a What's new page, `/changelog/`, linked from the footer: every change to the app, newest first, read from the repo's `CHANGELOG.md` at build. Each change opens on its first sentence in bold. The app's **Read all** opens it at the card's day. Website changes now go in this file, `apps/website/CHANGELOG.md`, so they never show in the app.
- The install line at the end of a page is readable again: its **Copy** button was white on the light page. On phones it no longer makes the page wider than the screen.

## 2026-10-23

- The website's header now links to Folios, its section of articles, next to Download for Mac, once the first one is up; the footer link is called Folios too, and they live at `/articles/…`, in `apps/website/content/articles/`. On the homepage, Folios sits at the right of the header and Download for Mac stays out of the way until you scroll past the big Download button at the top; then Folios slides over and the button comes in beside it.

## 2026-10-21

- The website can hold more pages than the homepage: guides, docs and essays, each a markdown file in `apps/website/content/`. A page gets its own title, description and link preview, set in the site's Bodoni type under an old painting and ending on the download, and is listed on its kind's page, which the footer links once the first one is there. The site also serves a sitemap, `robots.txt` and `llms.txt`, built from the same pages. There are no pages yet, so the site looks as it did.
- A page on the website can do more than plain text. It opens on its own painting edge to edge, with the title laid on it. It can show the README's demo GIFs, whole or cropped to one part, with a caption; a note file with its name; keys as keycaps; and numbered citations that link to a Sources list. Pages with three or more sections list them in an **On this page** column beside the text, marking the one you're reading; on narrower screens it folds into ticks at the edge that open the list on hover. Each page ends in a way that fits it: the next page to read, the download and install line, or the install and update commands. The site gains Joseph Wright of Derby's _A Philosopher Lecturing on the Orrery_ for a coming page.

## 2026-10-19

- The website is now one page you can download Pensée from. It opens on Rembrandt's _Philosopher in Meditation_ and the README's opening, for people who are neurodivergent, with ADHD or a brain that works a little differently. **Download for Mac** (marked Beta) gets the newest release's zip straight away. Below it, four rooms, each opening with an old painting, show all 15 features with their shortcuts: the README's GIFs, and small demos that repeat while you look at them. It ends on Hammershøi's interior with the download again and the Homebrew line to copy.
