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
- As a writer away for a week, I see the newest day, not a stack of cards.
- As a writer who closed it too fast, I can bring it back from ⌘P.
- As a writer on an older Pensée, when a new release is out, the card tells
  me and updates the app for me, the same way I installed it.

## Behaviour

- **Source.** Pensée reads `CHANGELOG.md` from the repo's `master` on GitHub
  (`fetch_changelog`, in Rust: the webview's CSP allows no outside fetches).
  It reads it once the app has started and again every 6 hours while it
  stays open. A failed read is logged and tried again next time. Nothing is
  shown about it.
- **Unseen day.** The newest `## YYYY-MM-DD` section is the update. The card
  shows it when its date is after `whatsNew.lastSeen` (preferences.json). If
  `whatsNew.lastSeen` was never set, the newest date is recorded and nothing
  shows, so a first run stays with onboarding. While onboarding is open the
  card waits.
- **Card.** Bottom-right of the window, over the canvas. From top to bottom:
  - A painting with its credit (artist, _title_, year) on a dark fade.
  - `What's new · N changes`.
  - The day as a Didone title ("October 18").
  - The first sentence of the first three entries, each clamped to two lines,
    then `N more`, which opens the rest in place, scrollable.
  - **Got it** and **Read all**.
- **Dismiss.** **Got it** closes the card and records the day as seen.
  **Read all** opens the changelog on GitHub in the browser, then does the same.
  The card doesn't take focus and has no Esc, so typing in a note never
  reaches it.
- **⌘P → Show What's New** shows the newest day at any time, seen or not,
  with **Update** when a newer release is out.
- **Painting.** Ten public-domain paintings of reading, writing and thinking
  rooms, bundled in `src/components/whats-new/paintings/`. The day picks one (a hash of its
  date), so each update has its own and the same day always shows the same one.
- **Motion.** The card rises 12px and fades in on `--motion-settle` /
  `--ease-out`, and its rows follow `--motion-stagger` apart. It leaves on
  `--motion-fast`. Under reduced motion it appears and goes still.

## Release ready

- **Source.** `latest_release` (Rust) reads
  `api.github.com/repos/feiyinwang/Pensee/releases/latest` with the changelog,
  and returns its tag without the `v` and the running app's version (tauri's
  `PackageInfo`, from `tauri.conf.json`). `isNewerVersion` compares them
  number by number. A failed read is logged and counts as no release.
- **When it shows.** A release newer than the app brings the card up on its
  own, with the newest day, unless the writer already closed the card for that
  release (`whatsNew.releaseSeen`, preferences.json). An unseen day with a
  newer release out shows the release state too.
- **Card.** The title is `Pensée <version>` instead of the date. **Update**,
  the one filled button, sits on the left of **Got it** and **Read all**.
  Closing the card records the release as seen as well as the day.
- **Update** (`upgrade_app`) upgrades the app the way it was installed:
  - **Homebrew** (`brew list --cask pensee` succeeds, with `brew` from
    `/opt/homebrew/bin` or `/usr/local/bin`): `brew upgrade --cask pensee`.
  - **Anything else** does what install.sh does: find the release's
    `-arm64.zip`, download it, unzip it with `ditto`, copy the new app next
    to the running one (`.Pensée.app.new`), then rename it into place and
    delete the old one, and clear quarantine. Copying beside it first means a
    failed copy leaves the running app whole. A build not inside a `.app`
    (`tauri dev`) can't update itself and says so.
- **Steps.** The button reads **Downloading…** (disabled) while it runs, then
  **Restart Pensée**, which quits through the normal exit and opens the new
  app (`restart_app`). A failure shows its message in the card, in the error
  colour above the buttons, and the button becomes **Try again**. The step
  lives in the store, not the card, so closing the card mid-download and
  bringing it back from ⌘P shows how it went.
- **Stubs.** `PENSEE_RELEASE_FILE` reads the release JSON from a file, and
  `PENSEE_UPGRADE_FILE` fakes Update: after a second it succeeds when the file
  says `ok` and fails with the file's text otherwise (the e2e journeys).

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
- Kept from the prototype: the release-ready state with an **Update** button,
  built on 2026-10-19 (see Release ready). It upgrades through Homebrew or the
  install script's steps, so no updater framework or signing key is needed.
