# Teal glass theme

Status: implemented. No longer the default since 2026-10-13: a fresh install
opens in Ink ([ink-theme-spec.md](ink-theme-spec.md)); Teal is a preset.

The app's default look moves from neutral charcoal with an orange accent to a
deep teal gradient with frosted glass panels, modelled on a reference the user
supplied: a dark-to-light teal backdrop, a translucent rounded card holding the
content, monospace uppercase labels, and a white pill primary button.

## Colours

Theme defaults in `shared/settings.schema.json` (mirrored in
`shared/themes/pensee/*.json` and the `:root` pre-hydration fallbacks):

| Mode  | Accent    | Background | Foreground | Translucent | Contrast |
| ----- | --------- | ---------- | ---------- | ----------- | -------- |
| Dark  | `#8FDCD5` | `#0A6470`  | `#FFFFFF`  | 0           | 30       |
| Light | `#0E6F78` | `#E9F2F1`  | `#0B2A30`  | 0           | 22       |

Only defaults change. Anyone who set their own theme values in Preferences
keeps them, and the gradient below is derived from whatever background they
chose.

## Backdrop

`body::before` paints `--backdrop`, three layers built from `--bg-base`:

- a 155° linear gradient from `--backdrop-deep` (top-left) to the base,
- a radial `--backdrop-lift` (lighter, more saturated) centred low-right,
- a radial `--backdrop-glow` in the bottom-right corner.

The stops are OKLCH relative colours (`oklch(from var(--bg-base) …)`), which
keep the hue's chroma where sRGB mixing toward white or black turns it grey.
Relative colour syntax needs WebKit 18+, so those stops sit behind
`@supports (color: oklch(from red l c h))` with sRGB `color-mix` fallbacks
outside it; without the guard an older WebKit would treat the tokens as
invalid and the window would lose its background.

The layer's `opacity` is `--bg-opacity`, so the Translucent slider still fades
the backdrop toward OS vibrancy. It lives on a pseudo-element because a
gradient has no single colour to mix alpha into.

**The glow is weaker than the reference's** (`l + 0.13`, chroma × 0.7). The
reference puts a bright silver glow under white copy, which drops contrast
under 3:1; here the editor text column and footer sit on top of it, so it
stays dim enough to hold white text near 4.5:1 through most of the card.

## Glass panel

`.glass-panel` replaces `bg-bg` on the editor container (workspace and compact
layouts): 8px inset from the window edge, 20px radius, 1px `--glass-border`,
and a 160° white wash from `--glass-fill-start` to `--glass-fill-end` (3%→8%
dark, 40%→65% light). It has no margin on the sidebar side while the sidebar
is open, so the tab strip and toggle offsets in `app-layout.tsx` still line
up. The sidebar's right-edge rule is gone (`--sidebar-divider-right:
transparent`) because the panel edge does that job now.

Floating cards (`.surface-card`, cmdk) move from a 16px to a 20px radius to
match.

## Type

`label-mono` utility: `--mono-font`, uppercase, `0.08em` tracking. Applied to
sidebar section headings (and the compact recents heading that shares the
class), the document footer stats, cmdk group headings, and the welcome,
consent-dialog and search Replace All buttons.

## Accent on filled surfaces

The pale dark-mode accent can't carry a white glyph. `--accent-solid`
(`accent` 70% + black) is used where a white mark sits on an accent fill: the
checked task box and the sidebar drag-count badge. The search overlay's
Replace All button, previously accent-filled, becomes the primary white pill.

## Theme presets

Preferences → Appearance has a **Theme** dropdown directly under Schema.

Presets are folders under `apps/desktop/shared/themes/<slug>/` with
`light.json` and `dark.json`, each holding the five primaries. They are picked
up by glob in `src/lib/theme-presets.ts`; the slug becomes the display name.
Adding a theme is adding a folder.

**No stored preset key.** The primaries (`theme.{mode}.*`) remain the only
source of truth. Choosing a preset writes all ten primaries; the dropdown shows
whichever preset they currently match (hex compared case-insensitively, unset
keys read as schema defaults), or **Custom** once any primary is edited under
Light/Dark Theme. The unused `theme.light.preset` / `theme.dark.preset` schema
entries were removed. Reset on the row applies the default preset.

The default preset is whichever one equals the schema defaults, and it is
listed first; the rest are alphabetical. `tests/theme-presets.test.ts` fails if
the schema defaults stop matching a preset exactly.

| Preset        | Dark bg / accent      | Light bg / accent     |
| ------------- | --------------------- | --------------------- |
| Teal (default)| `#003E4A` / `#8FDCD5` | `#E9F2F1` / `#0E6F78` |
| Amber         | `#4A3600` / `#FFE08A` | `#F7F2E4` / `#80600E` |
| Ember         | `#692313` / `#FFC3A6` | `#FAF0EB` / `#AD4529` |
| Forest        | `#004123` / `#A8E6BE` | `#ECF5EF` / `#2A7549` |
| High Contrast | `#000000` / `#79B8FF` | `#FFFFFF` / `#0040A0` |
| Indigo        | `#243281` / `#BFCBFF` | `#EEF0FA` / `#3B4DB3` |
| Midnight      | `#172448` / `#93B8FF` | `#ECEFF6` / `#2D4E8E` |
| Ocean         | `#003A66` / `#A2D3FA` | `#EAF1F8` / `#1D5F99` |
| Olive         | `#303E00` / `#D8EA9C` | `#F2F5E9` / `#5A6C22` |
| Orange        | `#111111` / `#FF6A00` | `#FFFFFF` / `#FF6A00` |
| Plum          | `#63204E` / `#FFB9DD` | `#F8EEF4` / `#9E3A74` |
| Slate         | `#2A3B4F` / `#C6D3E3` | `#EEF1F5` / `#475569` |
| Violet        | `#46297F` / `#DCC4FF` | `#F2EEF9` / `#6A41B5` |
| Warm Paper    | `#1F1A14` / `#E0A269` | `#F6EFE3` / `#A45A2A` |

Orange is the original Pensée palette, values unchanged (including its
translucency). The gradient variants share the teal recipe: foreground white,
translucent 0, contrast 30 dark / 22 light, and a deep tinted-dark foreground
in light mode.

**Legibility floor.** Each gradient variant's dark background was darkened in
OKLCH, hue and chroma held, until editor body text (`--editor-text`, 72% of the
foreground) reaches 4.5:1 on the glass panel over the brightest `--backdrop-lift`
region; accents were lightened until links reach 4.5:1 there. This moved the
teal default from `#0A6470` to `#003E4A`. Orange, High Contrast and Warm Paper
keep their existing values.
