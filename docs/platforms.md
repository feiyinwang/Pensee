# Platforms: macOS and Windows

Pensée is one Tauri v2 codebase that builds for macOS and Windows. Tauri runs the same React frontend in the system webview: WKWebView (Safari's engine) on macOS, WebView2 (Edge's Chromium) on Windows. The Rust backend compiles natively for each. Nothing is translated at runtime, so neither build pays for the other.

The rule: **macOS behaviour never changes for Windows.** Every Windows difference is a branch that is a no-op on macOS, in one of the places below. If a fix for Windows would change what a Mac user sees or how fast it runs, it is the wrong fix.

## Where platform differences live

| Layer             | Where                                             | What it does                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window            | `src-tauri/tauri.windows.conf.json`               | Tauri merges it over `tauri.conf.json` on Windows only. macOS keeps its overlay title bar, traffic lights and vibrancy; Windows gets a native title bar and an opaque window.                                                                                                                                                                 |
| Rust              | `#[cfg(target_os = "macos")]` / `#[cfg(windows)]` | Mac-only modules (`macos.rs`, `dock_menu.rs`, `shell_install.rs`, Apple Books' reader) are compiled out elsewhere, each with a fallback that reports "only on macOS".                                                                                                                                                                         |
| Paths over IPC    | `src-tauri/src/path_ext.rs`                       | `to_ipc_lossy()` and `canonical()` replace `to_string_lossy()` and `canonicalize()` for any path the frontend sees. On macOS they are exactly the std calls. On Windows they drop the `\\?\` prefix and write `/`, so the frontend's path keys (tabs, pins, watcher events) are spelled one way. A new command that returns a path uses them. |
| Frontend          | `src/lib/platform.ts`                             | `IS_MAC`, `isModKey(e)` (⌘ on macOS, Ctrl elsewhere), `keyLabel("⌘⇧Z")` ("Ctrl+Shift+Z" off macOS), `isPinchWheel(e)`, `WINDOW_CONTROLS_INSET`. Shortcut labels are written the macOS way and pass through `keyLabel`.                                                                                                                        |
| CSS               | `:root[data-platform="windows"]` in `App.css`     | `main.tsx` sets `data-platform` on `<html>`. Windows-only CSS goes under that selector.                                                                                                                                                                                                                                                       |
| Mac-only features | gated on `IS_MAC`                                 | Apple Books import and sync, Full Disk Access, the translucency slider, the `pensee` CLI menu item, the dock menu.                                                                                                                                                                                                                            |

## What differs on Windows, and why

- **Title bar.** macOS draws the traffic lights over the content, so the top-left chrome leaves 92px for them. Windows keeps its own title bar above the content, and the inset drops to the 12px edge.
- **Translucency.** Only macOS has the vibrancy behind the see-through backdrop. On Windows the window is opaque and the backdrop stays at full opacity.
- **Scrollbars.** Chromium ignores `::-webkit-scrollbar` while `scrollbar-color` is set and would draw classic bars. On Windows `scrollbar-color` goes back to `auto`, so the same thin hover-only bars apply.
- **Ctrl-wheel.** WebKit sends a trackpad pinch as a Ctrl-wheel. On Windows a mouse's Ctrl-wheel is one too, at about 100px a notch, so only small deltas get the pinch gain.
- **Asset URLs.** Tauri serves `asset:` as `http://asset.localhost` on Windows, so the CSP allows that origin beside `https://asset.localhost`.
- **Claude Code.** No login shell to ask for PATH, and the app's own PATH is its launcher's (an installer or a browser opened before Claude Code was installed hands down one without it). So the PATH comes from the registry (user, then machine, as a new sign-in would get it), then the app's own, then npm's and WinGet's folders, and `claude.exe` (native installer) or `claude.cmd` (npm) is found there or in `~/.local/bin`. Child processes start with `CREATE_NO_WINDOW` so no console flashes.
- **Obsidian vaults.** Read from `%APPDATA%\obsidian\obsidian.json`.
- **Menu.** No app menu, Services or Hide on Windows: the first menu is File (Preferences, About, Exit).
- **Ctrl+,.** A focused WebView2 keeps keys from the native menu, so its accelerators don't fire. Preferences' Ctrl+, is bound in the page (`use-keyboard-shortcuts.ts`) off macOS; zoom was already bound there. A new menu item with a shortcut needs the same.
- **First run.** The window opens maximized, as Windows apps do, while onboarding's first screen shows (`onboarding-store.ts`). The Mac keeps its centred window.
- **Words.** Labels say Ctrl, Alt and Shift, and "touchpad" where the Mac says "trackpad". A setting's description that spells out "Cmd+" goes through `keyLabel` too.

## Checking a change on both

- **CI** (`.github/workflows/ci.yml`) runs `cargo fmt`, `clippy` and `cargo test` on `macos-15` and `windows-latest` on every push.
- **On a Mac**, cross-check the Windows build before pushing:

  ```bash
  brew install llvm && rustup target add x86_64-pc-windows-msvc && cargo install cargo-xwin --locked
  cd apps/desktop/src-tauri
  PATH="/opt/homebrew/opt/llvm/bin:$PATH" CARGO_TARGET_DIR="$TMPDIR/pensee-win" cargo xwin clippy --all-targets --target x86_64-pc-windows-msvc
  ```

  Keep `CARGO_TARGET_DIR` outside the repo, or `vp check` formats the build output. The QA journeys (`pensee-qa`) only run on macOS. There is no Windows journey run yet, so a Windows-only UI change needs a look on a Windows machine.

## Releasing

`scripts/release.sh` publishes the Mac build as a GitHub Release. Publishing it starts `.github/workflows/release-windows.yml`, which builds the NSIS installer on a Windows runner and attaches `Pensee-<version>-windows-x64-setup.exe`, plus `Pensee-windows-x64-setup.exe` under a name that never changes. Run it by hand from Actions to rebuild one release. The installer is not code-signed, so SmartScreen warns on first run until it is.
