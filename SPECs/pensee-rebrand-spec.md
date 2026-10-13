# Pensée: the app is no longer Writer

## Why

This repo started as a fork of Joel's open-source Writer (`upstream`:
joelbqz/writer-computer). It has changed enough to be its own app, with its own
name (Pensée) and logo (see [docs/brand.md](../docs/brand.md)). Every trace of
Writer goes, except what the GPL requires.

## Decisions (2026-10-13)

- **Name:** Pensée everywhere a person can read it: app, menus, dialogs, CLI
  help, website, docs, SPECs, changelog.
- **Updates:** removed. The app no longer checks Joel's GitHub releases. There
  is no "Check for Updates…" menu and no updater plugin. Pensée is built and
  installed locally (`scripts/ship-local.sh`). An update feed of its own can
  come later.
- **Analytics:** removed. There's no PostHog transport, no consent dialog and
  no telemetry setting in the desktop app or the website. They pointed at
  Joel's PostHog project.
- **Website:** kept, rebranded to Pensée. Deploying it needs our own Cloudflare
  account.
- **The installed Writer.app:** moved to the Trash. Its data folders
  (`~/Library/Application Support/com.writer-computer*`) are left in place.
- **Kept on purpose:**
  - `LICENSE` (GPL-3.0), plus a README line saying Pensée is a modified version
    of Writer by Joel (github.com/joelbqz). GPLv3 §5(a) requires that notice.
  - Git history.
  - Names nobody sees whose rename would lose data:
    - the local bundle identifier `com.f.writer-mine` (its folder holds
      settings and the workspace list);
    - the workspace config folder `.writer/config` inside each vault;
    - the `writer-board` metadata id inside `.board.svg` files;
    - the `writer.video-player` storage key;
    - the Keychain service `Writer X Bookmarks` (renaming it would sign you
      out of X).

    Moving any of these needs a migration that reads the old name.

## Done when

- `git grep -i "writer"` finds only:
  - the licence notice and attribution line;
  - kept identifiers and persisted keys;
  - the common noun "writer" in prose (e.g. "writers who use plain text").
- `vp check`, `vp test` and `cargo test`/`clippy`/`fmt --check` pass.
- The local build installs and runs as Pensée.
