# Configurable Default Terminal Spec

## Goal

Let users choose which terminal Pensée opens from the sidebar's **Open in Terminal** action.

## Behavior

- Preferences includes a **Default Terminal** text setting in the Workspace section.
- Its exact description is: **Terminal application name on macOS, or executable name/full path on Windows and Linux. Leave blank for Pensée's platform default; arguments are not supported.**
- The input placeholder is **Platform default**.
- The setting persists at global scope through the existing settings pipeline. Like other global settings in the current multi-window architecture, each already-open window uses its independently hydrated value until that window reloads settings; new windows read the latest persisted value.
- Global writes are serialized process-wide and merge against the latest on-disk config, so a stale already-open window cannot erase preferences written by another window.
- A manually authored workspace override does not replace this app-level preference.
- An empty value keeps Pensée's current platform behavior:
  - macOS opens Terminal.app.
  - Windows opens Command Prompt.
  - Linux tries `$TERMINAL`, then Pensée's existing launcher fallback list.
- A non-empty value overrides those defaults:
  - macOS treats it as an application name and passes it as one argument to `open -a`.
  - Windows and Linux treat it as an executable name or executable path and launch it with the workspace as the current directory.
- Leading and trailing whitespace is trimmed at the settings boundary so the displayed, persisted, and effective values agree. A whitespace-only value becomes the unmodified empty default.
- The preference is never evaluated by a shell and does not accept command-line arguments. Launch failures continue to surface to the user.
- macOS waits for the short-lived `open` helper and treats a non-zero exit as a launch failure; Windows and Linux terminal processes remain detached.
- A custom-launch failure identifies the configured value and directs the user to clear or reset **Default Terminal** in Preferences. The frontend uses the neutral prefix **Failed to open terminal**.
- Resetting the preference returns to the empty platform-default value.

## Ownership

- `apps/desktop/shared/settings.schema.json` owns the key, label, description, type, category, and default.
- The generic settings panel renders and persists the text field without terminal-specific frontend state.
- The Rust settings boundary snapshots the invoking window's global/default value without holding the lock during launch; the workspace command owns platform-specific construction and execution.
- Schema-aware config parsing preserves the raw lexical value of declared string settings before boolean/number inference, so executable names such as `TRUE`, `00123`, and `1e3` round-trip exactly.
- The process-wide app state owns global-config write serialization; initialization/migrations and each writer refresh the per-window global layer from disk inside that critical section before applying one mutation. Global reads are fallible: a missing file becomes an empty layer, while any other read error aborts without mutating memory or writing a replacement config.

## Tests

- TypeScript schema coverage asserts the setting contract shown by Preferences.
- Rust tests cover exact default/custom launch specs on every modeled platform, settings-boundary trimming, shell-free argument construction, global/default lookup, macOS launcher-status failure mapping, and custom-preference reset/reload round trips (including lexically sensitive boolean- and number-looking strings such as `TRUE`, `00123`, and `1e3`).
- Rust tests use two independently hydrated settings instances to prove later unrelated writes and resets preserve the first window's terminal preference, cover missing/read-error reload behavior, and exercise the shared serialization lock concurrently with initialization/migration.
- Run `vp check`, `vp test`, `cargo test`, `cargo clippy`, and `cargo fmt --check`.
- Launch the desktop app in development to verify the row renders in Preferences when the GUI environment permits.
