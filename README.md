# Pensée

![Pensée: the ¶ mark and PENSÉE wordmark on cream paper above the editor, open on a note called "Writing is thinking"](./assets/readme/hero.jpg)

Thinking, made by writing.

I'm making Pensée for people like me, with ADHD or a brain that works a little differently. We collect everything: the article, the video, the book a friend mentioned, the idea that shows up at 2am. Very little of it gets digested, and we wish it did, because digesting is how you come to understand the world and yourself.

Pensée is where the collecting turns into understanding. Your memory goes on the page, so your head doesn't have to hold it all. You write about each new thing you meet in your own words, and the notes link up into something you can come back to. It's meant to feel calm enough to get into the zone, and safe: every note is a file in a folder on your own computer.

The AI is a second pen, not a ghostwriter. It answers a question only after you've written your own take. It lays out the evidence on both sides of a claim and leaves the call to you. It shows where a line connects to something you wrote months ago, and you write how they connect. Your ideas stay yours.

![Asking the second pen a question: its answer stays sealed until you write your own take, then Tab combines the two into one list of points](./assets/readme/pen.gif)

_Press ⌘. on a question and the pen writes an answer, sealed. Write your own take first, and it opens beside it. Press Tab and the two become one list: your points in your words, the pen's in blue, only where it adds something._

Every note is a markdown file in your own folder, so it opens in Obsidian or any editor. Around the notes:

- **Library** keeps books, videos, podcasts and papers as notes, and opens PDFs and EPUBs beside their page so highlights land in it.
- **Boards** live inside a note: cards and arrows for mapping out an idea. Drag a card next to another and it docks there, joined by an arrow.
- **Projects** shows your project notes as a list, a kanban or a timeline, and writes changes back to each note's properties.
- **YouTube and podcast notes** play the episode inside its note, and each line you write can be pinned to the moment you wrote it.
- The **Agent** chat is Claude with your pages in view: it reads and edits them, and explains or defines what you select in a book.

![Highlighting "Vigorous writing is concise." in The Elements of Style: the line lands in the book's note, a click on it brings the page back, and a thought of your own goes under it](./assets/readme/book.gif)

_Open a book from Library and its page sits beside its note. Highlight a line and it lands in the note. Click it later and the book goes back to that spot, and you write what it means to you under it._

![Taking notes on a Huberman Lab video: ⌘S plays, ⌘S again pins the moment and pauses, then you write the line](./assets/readme/youtube.gif)

_In a YouTube note, ⌘S plays and ⌘S again pauses and pins the moment to the line you're on. Write your thought, ⌘S to play on. Each pin plays from its moment._

![Taking notes on a podcast episode the same way: each line pinned to the moment in the episode](./assets/readme/podcast.gif)

_Podcasts work the same way: listen, pin, write._

![Dragging a card next to another on a board: it docks and an arrow joins them](./assets/readme/dock.gif)

_On a board, drop a card beside another and it docks into place with an arrow._

## Install

For Macs with Apple Silicon (M1 and later). With [Homebrew](https://brew.sh):

```bash
brew install --cask feiyinwang/tap/pensee
```

Or without Homebrew, paste this into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/feiyinwang/Pensee/master/install.sh | bash
```

Both download the latest [release](https://github.com/feiyinwang/Pensee/releases) into Applications. Pensée isn't notarized by Apple yet, so both also clear the quarantine flag macOS puts on downloads; without that, macOS refuses to open the app. Update with `brew upgrade --cask pensee`, or by running the curl line again.

The second pen and the Agent run on [Claude Code](https://docs.anthropic.com/en/docs/claude-code): install it, and Pensée can sign you in from Settings.

## How it's built

It is built with Tauri v2, React, Zustand, CodeMirror, and Rust. The app keeps documents on disk, respects workspace `.gitignore` rules, supports multiple windows, and renders extended markdown such as tables and Mermaid diagrams. The logo and brand are described in [`docs/brand.md`](./docs/brand.md).

## Repository

- `apps/desktop/` — Tauri desktop app.
- `apps/desktop/src/` — React frontend.
- `apps/desktop/src-tauri/src/` — Rust commands, workspace state, watcher, and CLI integration.
- `apps/website/` — landing page.
- `assets/brand/` — logo sources and the icon render script.
- `docs/` — project and agent workflow docs.
- `SPECs/` — feature specs and design notes.

## Development

This repo uses Vite+ through the `vp` CLI. Use `vp` instead of calling the package manager or Vite tooling directly.

```bash
vp install
```

```bash
vp dev
```

## Validation

```bash
vp check
```

```bash
vp test
```

Rust validation runs from the Tauri crate (`apps/desktop/src-tauri`):

```bash
cargo test
```

```bash
cargo clippy
```

```bash
cargo fmt --check
```

## Privacy

Pensée is local-first and stays that way. It collects no usage data, and
neither does the website.

## Building

Build and install the app locally with `scripts/ship-local.sh`. It makes a release build, signs it ad hoc and installs it in `/Applications`. The app doesn't check for updates.

Publish a release with `scripts/release.sh` after bumping `version` in `apps/desktop/src-tauri/tauri.conf.json`. It builds for Apple Silicon, uploads the zip to GitHub Releases, and points the Homebrew cask in [feiyinwang/homebrew-tap](https://github.com/feiyinwang/homebrew-tap) at it.

## License

Pensée is free software under the GNU General Public License v3.0; see [`LICENSE`](./LICENSE). It is a modified version of [Writer](https://github.com/joelbqz/writer-computer) by Joel ([@joelbqz](https://github.com/joelbqz)), changed substantially since the fork.
