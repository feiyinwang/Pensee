# Native Font Picker Spec

> Superseded on 2026-07-18 by the select-only design in
> [`font-select-spec.md`](font-select-spec.md). This file records the previous
> AppKit implementation decision.

## Goal

Replace the settings panel's custom installed-font combobox with the native
macOS Font panel. Rename the user-facing settings section from **Fonts** to
**Typography**.

The stored keys remain `fonts.ui`, `fonts.editor`, and `fonts.mono`; this is a
picker and presentation change, not a settings migration.

## Behavior

- On macOS, the chevron in each font-stack control opens AppKit's shared
  `NSFontPanel`, initialized to the stack's primary installed family when
  possible.
- Selecting a font in the native panel updates the originating setting
  immediately. Only the selected family is taken from AppKit; the current
  user-edited fallback tail is preserved and the previous primary family is
  replaced rather than accumulated.
- The free-text stack field remains editable for CSS generic families,
  fallback ordering, and fonts unavailable to AppKit.
- `NSFontPanel` is app-global. Every open gets an opaque request token, and the
  backend atomically tracks the most recent originating window and token so a
  selection is emitted only to the control that opened the panel, including in
  a multi-window session. Closing that control/window clears a matching request
  without disturbing a newer opener.
- On non-macOS platforms, keep the editable stack field and omit the picker
  affordance rather than presenting a custom imitation of a native picker.
- The section heading and schema category are `Typography`; persisted keys and
  CSS variable bindings are unchanged.

## Design

- Replace system-font enumeration in `commands/fonts.rs` with a macOS-only
  AppKit bridge (module, setup, and handler are all compile-gated). The bridge
  follows the existing raw-`objc2` pattern in `dock_menu.rs`, so no typed
  `objc2-app-kit` dependency is needed. Register one stable action selector on
  Tauri's existing application delegate, make it the weak `NSFontManager`
  target while the panel is active, and emit `{ requestId, family }` to the
  originating Tauri window.
- Add `open_native_font_panel` and matching close/deactivate IPC commands.
  Opening is one main-thread transaction: validate the delegate bridge,
  initialize the panel font, install target/action and the route, then order the
  panel front. An async command receives the closure's explicit result over a
  oneshot channel, so setup failures reach the caller and never leave a route.
- `FontControl` subscribes to the native selection event, filters by its setting
  token, and invokes the existing `onChange` path. The component owns and
  cleans up that subscription and deactivates its matching request on unmount.
  A co-located hook delegates listener/token lifetime to a small controller:
  opening awaits listener readiness, live stack/callback values are kept out of
  stale closures, and late listener setup is unregistered after unmount.
- Settings remain optimistic, but backend writes are serialized per key in the
  settings store so rapid native changes cannot persist out of order or let a
  stale failed write roll back a newer value. This lane is webview-local, like
  the existing settings store; process-wide conflict resolution between two
  windows editing the same global setting remains the documented multi-window
  settings limitation.
- Associate each input and trigger with the visible setting label. Do not expose
  web-popover state such as `aria-expanded` for the separate native panel.
- Configure the native panel for family selection only when AppKit's validation
  hook permits it; Pensée does not store point size, face, or effects in these
  settings.
- Remove the custom portal/popover, its installed-font hook, `fontdb`, and the
  obsolete `list_system_fonts` command.

## Validation

- Existing `font-stack` unit tests continue to cover primary-family replacement
  and current-tail preservation, including repeated picks without stack growth.
- Rust unit tests cover latest-request replacement, matching-only deactivation,
  and route snapshot behavior without invoking AppKit.
- TypeScript controller tests cover listener readiness, matching-token
  acceptance, stale-token rejection, live-tail use, open failure, exact-token
  teardown, and late-listener cleanup. Deferred settings-store tests prove
  same-key persistence ordering and stale-failure rollback protection.
- Update the settings E2E coverage for the Typography heading, absence of the
  web popover, and retained free-text editing. WebDriver cannot drive AppKit's
  out-of-process native panel, so selecting a family in the panel requires a
  mandatory manual macOS smoke test. The matrix includes generic/unavailable
  initial families, row switching, A→B→A window routing, closing the origin,
  rapid changes, keyboard activation, and family-only behavior.
- Run `vp check`, `vp test`, `cargo test`, `cargo clippy`, and
  `cargo fmt --check`.
