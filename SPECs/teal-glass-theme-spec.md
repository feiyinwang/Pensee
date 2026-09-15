# Teal glass theme

Status: implemented

The app's default look moves from neutral charcoal with an orange accent to a
deep teal gradient with frosted glass panels, modelled on a reference the user
supplied: a dark-to-light teal backdrop, a translucent rounded card holding the
content, monospace uppercase labels, and a white pill primary button.

## Colours

Theme defaults in `shared/settings.schema.json` (mirrored in
`shared/themes/writer/*.json` and the `:root` pre-hydration fallbacks):

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
