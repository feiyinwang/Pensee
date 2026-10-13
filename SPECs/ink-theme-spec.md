# Ink theme

Status: implemented

The brand is black and cream with no accent colour ([docs/brand.md](../docs/brand.md)),
but a fresh install opened in Teal glass and none of the presets was black and
cream. This adds an **Ink** preset in the brand's two colours and makes it the
default, replacing Teal ([teal-glass-theme-spec.md](teal-glass-theme-spec.md)).
Teal stays as a preset.

## Colours

`shared/themes/ink/{light,dark}.json`, mirrored as the theme defaults in
`shared/settings.schema.json` and the `:root` pre-hydration fallbacks
(dark values) in `App.css`:

| Mode  | Accent            | Background        | Foreground        | Translucent | Contrast |
| ----- | ----------------- | ----------------- | ----------------- | ----------- | -------- |
| Light | `#0B0B0B` (Ink)   | `#ECE7DC` (Cream) | `#0B0B0B` (Ink)   | 0           | 20       |
| Dark  | `#ECE7DC` (Cream) | `#0B0B0B` (Ink)   | `#ECE7DC` (Cream) | 0           | 24       |

The accent is the foreground in both modes: Ink has no accent colour. Settings
→ Theme lists Ink first (the default preset always is).

Only defaults change. A config that stores its own theme values keeps them; the
user's Orange config stores all ten primaries, so it is untouched. A config
that set only some primaries now reads the unset ones as Ink instead of Teal.

## A theme without an accent

Everything below follows from one rule: **when the accent equals the
foreground, nothing may rely on hue to stand out.**

### Flat ground

The window backdrop (`--backdrop`: a 155° gradient, a lift and a glow, and in
light mode 14% of the accent mixed into the deep stop) exists to carry the
accent's hue into the ground. A theme with no accent gets a flat ground
instead.

- `isFlatBackdrop(mode, settings)` in `lib/theme.ts` is true when the mode's
  accent equals its foreground (case-insensitive, unset primaries read as
  their schema defaults). `pushForMode` sets `data-backdrop="flat"` on `:root`
  when it is, and removes it otherwise.
- `:root[data-backdrop="flat"]` sets `--backdrop: var(--bg-base)` and makes
  the editor card's wash one colour (`--glass-fill-start` = `--glass-fill-end`).

Why derived and not a setting: a new `theme.{mode}.gradient` primary would
need its default to be Ink's (flat), which would flatten every existing config
that predates it, Orange included, unless a migration wrote the old value.
That migration can't be one-shot without a marker key (resetting the slider
removes the key and would re-trigger it). Deriving it from the colours needs
neither, and any custom theme that sets accent = foreground gets the same
flat ground.

### Links

Links are told apart by an underline, not by hue. Every link surface draws
`text-decoration: underline` in `--link-underline` (the link colour at 50%)
with `--link-underline-offset` (0.18em), both on `:root`:

- wiki links (`.cm-wiki-link`, previously no underline),
- rendered markdown links and link URLs (`syntaxHighlighting.ts`),
- links in HTML blocks, caption bands (`.wr-band a`) and EPUB text.

`--link-color` stays `var(--accent)`, so themes with an accent keep coloured
links, now also underlined.

### Glyphs on accent fills

`--accent-solid` (the accent 30% toward black) fills the checked task box, the
drag-count badge and the selected calendar day. It was always paired with a
white glyph. On Cream it is `#A5A29A`, and white on it is 2.5:1.

`--on-accent` is the glyph colour on those fills: white, or Ink when
`--accent-solid` is lighter than OKLCH L 0.56 (the grey with equal contrast
against black and white). It is a relative colour behind the same
`@supports (color: oklch(from red l c h))` guard as the backdrop stops;
without support it stays white, the old behaviour.

- The task tick moved from a white data-URL image to a `::after` mask filled
  with `--on-accent`.
- The settings toggle's knob is `--on-accent` when on (white when off).
- The drag badge's count and the calendar's `--accent-foreground` use it.

Measured (WCAG ratio of the glyph on its fill):

| Fill                           | Before (white) | After           |
| ------------------------------ | -------------- | --------------- |
| Ink light, task box            | 20:1           | 20:1 (white)    |
| Ink dark, task box (`#A5A29A`) | 2.5:1          | ~8:1 (Ink)      |
| Ink dark, toggle (Cream track) | 1.2:1          | ~16:1 (Ink)     |
| Orange, task box               | 5.4:1          | 5.4:1 (white)   |
| Orange, toggle                 | 2.9:1          | 2.9:1 (white)   |

Most other presets' dark modes have pale accents and flip to an Ink glyph too
(white on them was 2.7–3.2:1; Ink is 6–7:1). Orange keeps white in both modes.

### Checked over

- **Focus ring**: `outline: 2px solid var(--accent)`; Ink on Cream and Cream on
  Ink are both far above 3:1. The `rgba(100, 149, 237, 0.7)` fallback was
  unreachable (`--accent` is always set on `:root`) and blue, so it is gone.
- **Selection**: `--editor-selection-bg` is the accent at 30%; text on it reads
  at about 8:1 (light) and 7:1 (dark).
- **Calendar today**: drawn in `--period-current` (the link colour) at weight
  600. In Ink that is the text colour, so today is marked by weight alone,
  like the current week, month, quarter and year.
- The board colour picker labelled its accent swatch "Teal"; it is "Accent"
  now.

## Verification

- `tests/theme-presets.test.ts`: the default preset is Ink; Ink is flat in
  both modes (written and as defaults); Orange is not; the compare ignores
  case.
- `e2e/specs/ink-theme.spec.js` (fresh data dir, a seeded workspace): Ink in
  both modes with `data-backdrop="flat"` and no backdrop image, underlined
  links, `--on-accent` white on Ink and Ink on Cream, and Ink first and active
  in Settings → Theme. It saves screenshots to `$INK_SHOTS`.
