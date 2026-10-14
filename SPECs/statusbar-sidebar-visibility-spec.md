# Status bar metrics and sidebar section visibility

## Problem

The document footer always shows all three metrics (words, characters,
paragraphs), and the sidebar always shows the Search button and the Recents
section. Writers who want a quieter chrome have no way to hide any of them.

## Behavior

### Settings

Five new boolean settings in `settings.schema.json`, all defaulting to `true`
and persisted at global scope:

- `statusbar.show-words`, `statusbar.show-characters`,
  `statusbar.show-paragraphs` — category **Status Bar** (renders after the
  Editor section in Preferences via the schema-driven panel).
- `appearance.sidebar-show-search`, `appearance.sidebar-show-recents` —
  category **Appearance**.

No settings-panel code changes: the generic boolean control renders them.

### Status bar

- `DocumentFooter` renders only the metrics whose setting is on. When all
  three are off, the footer element is not rendered at all.
- Right-clicking the footer opens a native context menu (same
  `build…Spec` + `Menu.popup()` pattern as the sidebar file menus) listing
  **every** metric as a check item — checked = visible — so a hidden metric
  can be re-shown from the same menu, not only from Settings. Toggles write
  through the settings store, so Preferences stays in sync.
- The metric list (setting key ↔ stat key ↔ labels) lives once in
  `FOOTER_METRICS` (`footer-context-menu.ts`); the footer and the menu both
  iterate it.
- The page width presets ([editor-content-width-spec.md](editor-content-width-spec.md#presets))
  are a fourth footer item, `statusbar.show-width`. The menu lists
  `FOOTER_ITEMS` (the metrics, then **Page Width**); the footer is not
  rendered when every item is off and the pen has no hint.

### Sidebar

- The Search button hides when `appearance.sidebar-show-search` is off; the
  Recents section hides when `appearance.sidebar-show-recents` is off
  (regardless of recent files existing).
- Right-clicking the sidebar surface — empty space, section headers
  (including the Recents title), or the search button — opens a native
  context menu with two check items, Search and Recents. File and folder rows
  keep their existing menus (they stop propagation, so the surface menu never
  fires for them).
- Hiding Recents does not clear recents metadata; re-enabling restores the
  section as it was.

### Typing note

`SettingsMap` cannot type boolean settings as `boolean` (TypeScript widens
JSON imports, so the `"type": "boolean"` literal never narrows). Boolean
reads go through a new `useBooleanSetting(key, fallback = true)` hook that
narrows at runtime, replacing ad-hoc `as boolean | undefined` casts.

## Verification

- Unit tests for both menu spec builders (`footer-context-menu.test.ts`,
  `sidebar-surface-context-menu.test.ts`).
- Runtime: `e2e/specs/visibility-settings.spec.js` drives the built app —
  default metric set, single-metric hide, all-hidden footer removal, Search
  button hide, Recents section hide. Native menu popups themselves are
  OS-level and not driveable from WebDriver; the menus' actions share the
  `setSetting` write path the e2e spec exercises.
