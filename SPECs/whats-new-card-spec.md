# What's new card

## Problem

Pensée changes almost every day (CHANGELOG.md gets a new dated section most
days), but nobody reads a changelog. Writers miss the things that would change
how they work, like a new shortcut or a fix to something that annoyed them.

## Stories

- As a writer, when Pensée has changed since I last looked, a card in the
  corner tells me what changed that day, once, without interrupting my writing.
- As a writer, I can read the whole day in the card and open the full
  changelog when I want more.
- As a writer, once I've dismissed it, the card stays gone until the next
  update.
- As a new writer, my first launch shows onboarding, not a backlog of changes.
- As a writer who updates after a week, I see the whole week in one card,
  not a stack of cards.
- As a writer, the card only comes with an update to the app: a change to the
  website never shows in it.
- As a writer, **Read all** takes me to a page on the website that lists every
  change, opened at the day the card showed.
- As a writer who closed it too fast, I can bring it back from ⌘P.

## Behaviour

- **Source.** `CHANGELOG.md` is the app's changelog and only the app's:
  website work gets no line in it. The app reads the
  `CHANGELOG.md` it was built with (`read_changelog`, `include_str!` in
  Rust), once at launch, so the card only has news after an update. Until
  2026-10-24 it fetched `master` on GitHub every 6 hours, which showed
  changes not yet released.
- **Unseen days.** Every `## YYYY-MM-DD` section after `whatsNew.lastSeen`
  (preferences.json) is new, and the card shows them all, newest first. If
  `whatsNew.lastSeen` was never set, the newest date is recorded and nothing
  shows, so a first run stays with onboarding. While onboarding is open the
  card waits.
- **Card.** Bottom-right of the window, over the canvas. From top to bottom:
  - A painting with its credit (artist, _title_, year) on a dark fade.
  - `What's new · N changes`.
  - The day as a Didone title ("October 18"), or the run of days
    ("October 16–18", "September 30 – October 2").
  - The first sentence of the first three entries, each clamped to two lines,
    then `N more`, which opens the rest in place, scrollable.
  - **Got it** and **Read all**.
- **Dismiss.** **Got it** closes the card and records the day as seen.
  **Read all** opens the website's What's new page (`/changelog/#<newest
date>`) in the browser, then does the same. Both record the newest day.
  The card doesn't take focus and has no Esc, so typing in a note never
  reaches it.
- **⌘P → Show What's New** shows the newest day at any time, seen or not.
- **Painting.** Ten public-domain paintings of reading, writing and thinking
  rooms, bundled in `src/components/whats-new/paintings/`. The newest day picks one (a hash of its
  date), so each update has its own and the same day always shows the same one.
- **Motion.** The card rises 12px and fades in on `--motion-settle` /
  `--ease-out`, and its rows follow `--motion-stagger` apart. It leaves on
  `--motion-fast`. Under reduced motion it appears and goes still.

## The website's What's new page

`/changelog/` on the website (`apps/website/src/routes/changelog/`) lists every
day of `CHANGELOG.md`, newest first and grouped by month, read at build with
the app's own parser (`src/lib/whats-new.ts`), so the page and the card list
the same days. Only Pensée's own changes: Joel's from the project it was forked
from are in `docs/upstream-changelog.md`, which nothing displays.

- A header like the site's indexes: `Pensée · N changes`, **What's new**, and
  a line on what the page is.
- A month per row, newest first: on the left its painting, credited, the
  month in Bodoni and `2026 · N changes`, held in view while its days scroll
  by. On the right each day, its date in Bodoni and `N changes`, then each
  change in full, its first sentence (the card's line) in bold. Under 860px
  the month's painting and name sit above its days.
- **One painting per month, used once on the whole site** (the user's rule,
  2026-10-24). `MONTH_PAINTINGS` in `apps/website/src/changelog-paintings.ts`
  maps each month to its painting; the build fails when a changelog month has
  none, when two months share one, or when one already hangs elsewhere on the
  site. A new month needs a newly found painting: public domain, someone
  absorbed in reading, writing or thinking, or an empty room, downscaled to
  800px into `apps/website/public/paintings/` (or one of the card's own the
  site doesn't show yet, listed in that file). August and September 2026 hang
  Hammershøi's _Dust Motes_ and Vermeer's _Woman in Blue_; October is Gabriel
  Metsu's _Man Writing a Letter_ (c. 1664–66, National Gallery of Ireland,
  Wikimedia Commons, public domain). The card still picks from its own ten.
- Each day is an anchor (`#2026-10-21`); the date links to it. The page jumps
  to it instantly (the site's smooth scroll would be cut off on so long a
  page).
- Repo-relative links (`./docs/brand.md`) point into the repo on GitHub.
- It ends on the install line and `brew upgrade --cask pensee`.
- The header links it as **What's new** on every page, and so does the
  footer. Under 520px the header has no room beside Download, so it's only in
  the footer. It keeps its plain name: people look for a changelog by the name
  they know.

## Paintings

All from Wikimedia Commons, public domain or CC0, downscaled to 800px wide.

| File                              | Credit                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| `durer-saint-jerome.jpg`          | Albrecht Dürer, _Saint Jerome in His Study_, 1514 (NGA)                 |
| `rembrandt-philosopher.jpg`       | Rembrandt, _Philosopher in Meditation_, 1632 (Louvre)                   |
| `hammershoi-interior.jpg`         | Vilhelm Hammershøi, _Interior with a Woman Seen from the Back_, 1903–04 |
| `ter-borch-woman-writing.jpg`     | Gerard ter Borch, _Woman Writing a Letter_, c. 1655                     |
| `vermeer-woman-in-blue.jpg`       | Johannes Vermeer, _Woman in Blue Reading a Letter_, c. 1663             |
| `vermeer-geographer.jpg`          | Johannes Vermeer, _The Geographer_, 1669 (Städel)                       |
| `hammershoi-dust-motes.jpg`       | Vilhelm Hammershøi, _Dust Motes Dancing in the Sunbeams_, 1900          |
| `antonello-saint-jerome.jpg`      | Antonello da Messina, _Saint Jerome in His Study_, c. 1475              |
| `chardin-philosopher-reading.jpg` | Jean-Baptiste Siméon Chardin, _The Philosopher Reading_, 1734           |
| `carpaccio-saint-augustine.jpg`   | Vittore Carpaccio, _The Vision of Saint Augustine_, 1502                |

## Decision (from the 2026-10-19 prototype)

- Direction: a corner card with a painting on top, then the day's changes.
- Rejected:
  - **Sidebar note.** Arc's "What's new · 8 new" row at the foot of the
    sidebar. Too easy to never open, and gone when the sidebar is hidden.
  - **Deck.** One change per card, flipped with ← →. Long entries get cut to
    three lines, and it takes ten clicks to see a day.
  - **Brand marks.** The ¶ on Ink, the Paper hero, the app icon, a ¶
    monogram. They read as branding, not as something new each day.
  - **A Pascal engraving.** Didn't belong with the rest.
  - **Vermeer's _A Lady Writing_.** Pale and looking straight out, it read
    as a ghost. Every painting shows someone absorbed in their reading or
    writing, or an empty room.
- Not built yet: a "release ready" state with an Update button. That needs
  an in-app updater (Homebrew or the install script).
