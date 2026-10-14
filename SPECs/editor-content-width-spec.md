# Editor Content Width Spec

## Goal

Let the user set the width of the editor's text column with a continuous
control instead of choosing between the two fixed `full` / `narrow` modes.

## Behavior

- A new **Content Width** slider lives under Preferences → Editor, next to
  Font Size and Line Height. It ranges 480–1600px in 10px steps and defaults
  to 734px — the measure `App.css` already declared as the root default.
- The value is the maximum width of the text column. When the pane is
  narrower than the value the column still fills the pane, so the top of the
  range behaves as "full width" on ordinary laptop windows.
- The frontmatter panel and the CodeMirror content share the same width, so
  they stay aligned at every value (previously the panel used the 734px root
  default while the editor used the mode value).
- Changes apply live via the existing CSS-var binding; no per-element JS.

## Implementation

- `shared/settings.schema.json`: replace the `appearance.editor-width` enum
  with `editor.content-width` (`range`, `cssVar: --pensee-editor-max-width`,
  `cssFormat: px`). The generic `applyCssVarBindings` pushes it to `:root`,
  where `--pensee-editor-outer-width` and `--pensee-text-col-inset` already
  derive from it.
- Remove `use-editor-settings.ts` and the wrapper `<div>` in `editor-pane.tsx`
  that overrode the var on the editor subtree only.
- `config.rs`: one-time `migrate_editor_width` maps a stored
  `appearance.editor-width` of `narrow` → `720` and `full` → `1600` into
  `editor.content-width` (unless already set), then drops the old key.
  Unrecognized values are dropped.
- Widen the range readout in `setting-control.tsx` so four-digit values fit.

## Validation

- `vp check`, `vp test`
- `cargo test`, `cargo clippy`, `cargo fmt --check`

## Presets

Decided 2026-10-14 from a throwaway prototype (`apps/desktop/proto/width`, deleted).
Nested outlines wrap early at 660px while the window has room to spare on
both sides, and the width was only reachable in Preferences.

- Three presets sit in the status bar, left of the word count: **Readable**
  (the schema default, 660), **Wide** (960) and **Full width** (the schema
  maximum, 1600). Each one writes `editor.content-width`, so it applies to
  every note and the Preferences slider moves with it. A width set on the
  slider that matches no preset leaves none of them checked.
- They are a radio group of icon buttons styled like the panel icon buttons
  (28px, `rounded-lg`, faint icon, subtle fill on hover, selected fill and
  primary icon when checked). The glyphs are 18px Hugeicons data: two page
  edges with two text lines between them whose length shows the width. A full
  page frame was tried first and dropped: at this size the frame read as one
  shape and the three widths looked alike.
  Clicking one keeps the caret in the editor (mousedown is prevented).
- The width changes instantly, as the sidebar edge does
  ([docs/motion.md](../docs/motion.md#gestures-today)): it reflows the whole
  editor, so a tween would read as lag.
- `statusbar.show-width` (default on) shows or hides them, from Preferences
  → Status Bar or the status bar's right-click menu (**Page Width**), which
  now lists every footer item from one registry, `FOOTER_ITEMS`.

Rejected in the prototype:

- **Drag the column's right edge.** Most control, but invisible until you
  hover the exact spot, and only the right edge was free (the ¶ block
  handle owns the left).
- **One title-bar toggle, readable ↔ full (⌘⇧\\).** Fast, but only two
  widths, and full width puts prose at about 140 characters a line.
- **Fit the outline automatically** (widen one indent per nesting level).
  No control at all, but one deep bullet widens the whole note, and
  indenting while typing would make the column jump.

Known gap: switching width keeps the scroll offset in pixels, not the line
being read, so a large change can move the view a little.
