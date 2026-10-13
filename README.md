# Pensée

Thinking, made by writing. A local-first markdown app for the notes you think with.

![Pensée](./assets/screenshot.png)

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

## License

Pensée is free software under the GNU General Public License v3.0; see [`LICENSE`](./LICENSE). It is a modified version of [Writer](https://github.com/joelbqz/writer-computer) by Joel ([@joelbqz](https://github.com/joelbqz)), changed substantially since the fork.
