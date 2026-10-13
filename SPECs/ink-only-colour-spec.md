# Ink only

Status: implemented

[Ink](ink-theme-spec.md) made the brand's black and cream the default theme,
but kept fourteen other presets (Orange, Teal, High Contrast, …), an accent setting and a scatter of
hard-coded blues, oranges and teals. The brand is Ink `#0B0B0B` and Cream
`#ECE7DC` with no accent ([docs/brand.md](../docs/brand.md#colour)). This
makes Ink the only theme, everywhere. Colour work only: no font size, line
height or weight changes.

## No accent

- The colour presets are gone: `shared/themes/` holds only `ink/`, which
  `tests/settings-schema.test.ts` keeps equal to the schema's theme defaults.
  The Theme picker (`theme-preset-row.tsx`, `lib/theme-presets.ts`) is gone.
- `theme.light.accent` and `theme.dark.accent` are gone from
  `settings.schema.json` and so from Settings. Each mode keeps Background,
  Foreground, Translucent and Contrast.
- `--accent`, `--accent-solid` and `--on-accent` stay as aliases in `App.css`
  (`var(--fg-base)`, `var(--fg-base)`, `var(--bg-base)`), so rules written
  against them keep working and follow every push of the primaries.
- The ground is always flat (`--backdrop: var(--bg-base)`); the gradient, the
  OKLCH backdrop stops, `isFlatBackdrop` and `data-backdrop` are gone.

| Surface                | Now                                                                     |
| ---------------------- | ----------------------------------------------------------------------- |
| Selection              | foreground at 15% (text on it ~11:1 in both modes)                      |
| Focus ring             | 2px foreground                                                          |
| Checked task           | foreground box, ground-coloured tick                                    |
| Settings toggle        | on: foreground track, ground knob; off: foreground 20%, knob at 55% ink |
| Slider                 | foreground thumb                                                        |
| Calendar today         | foreground, at weight 600 (unchanged)                                   |
| Book highlight / flash | foreground wash at 14% / 30%                                            |
| Links                  | foreground, underlined (unchanged)                                      |
| Modal scrim            | the ground at 80% (light), the ground lifted 12% toward Cream (dark)    |

The off toggle's knob is `color-mix(fg 55%, bg)`: 4.1:1 on Cream, 5.3:1 on Ink.

## Code

Syntax highlighting is three ink tiers, no hues (`prosemark-theme.css`):

| Tier      | Tokens                                     | Value                    | On Cream / Ink |
| --------- | ------------------------------------------ | ------------------------ | -------------- |
| Ink       | keywords, names, types, properties, macros | the foreground           | 16:1 / 16:1    |
| Secondary | strings, literals, atoms, regexps          | `fg 72%` into the ground | 7.3:1 / 8.4:1  |
| Muted     | comments, italic                           | `fg 65%` into the ground | 5.8:1 / 7.0:1  |

Invalid code keeps a colour: the oxblood ink. The tiers are opaque mixes toward
the ground, never alpha. The unused hue-based `lightTheme` in
`lib/prosemark-core/syntaxHighlighting.ts` is removed.

## Writing inks

The only colours besides Ink and Cream, for things that carry meaning or a
user's choice and never for chrome: board shapes and notes, project tags,
error text. `--ink-*` in `App.css`; dark values on `:root` (the pre-hydration
ground is Ink), light values under `[data-theme="light"]`. Ratios are WCAG,
against Cream `#ECE7DC` (light) and Ink `#0B0B0B` (dark).

| Ink         | Light     | on Cream | Dark      | on Ink |
| ----------- | --------- | -------- | --------- | ------ |
| Graphite    | `#6B665E` | 4.6:1    | `#A39D92` | 7.3:1  |
| Oxblood     | `#8C2F2A` | 6.7:1    | `#D98A80` | 7.4:1  |
| Sepia       | `#8A5A2B` | 4.8:1    | `#CF9F6E` | 8.3:1  |
| Ochre       | `#8F6C14` | 3.9:1    | `#D9B65C` | 10.1:1 |
| Verdigris   | `#3F6B5A` | 4.9:1    | `#8FBFA9` | 9.6:1  |
| Indigo ink  | `#2E3F6B` | 8.4:1    | `#93A6D6` | 8.1:1  |
| Aubergine   | `#5B3A5E` | 7.7:1    | `#B893B9` | 7.4:1  |
| Rose madder | `#9A4B5C` | 4.8:1    | `#D897A6` | 8.3:1  |

Ochre was proposed as `#A8801F`, which is 2.95:1 on Cream; it is deepened to
`#8F6C14` to hold 3:1 as a stroke. `--ink-wash` is how much ink a tinted ground
takes: 14% light, 22% dark. `--text-error` is the oxblood ink (it was
referenced before but never defined).

## Boards

The palette keys stay (`ink, muted, red, orange, yellow, green, accent, blue,
purple, pink` and the nine sticky keys) because boards store them; only the
values change, so every existing board re-tints. `board.css`:

| Key      | Ink            |
| -------- | -------------- |
| `ink`    | the foreground |
| `muted`  | graphite       |
| `red`    | oxblood        |
| `orange` | sepia          |
| `yellow` | ochre          |
| `green`  | verdigris      |
| `accent` | the foreground |
| `blue`   | indigo ink     |
| `purple` | aubergine      |
| `pink`   | rose madder    |

- Soft fills mix 22% of the ink into the board surface **in OKLab**, not OKLCH:
  Cream has a little chroma, and an OKLCH mix swings a cool ink's hue toward
  it (indigo's fill came out pink-brown, `#D1BBB0`; in OKLab it is `#BEC0C3`).
- Sticky notes are paper washes: the note's ink at `--ink-wash` into Cream
  paper (`#ECE7DC`), or 22% into a dark paper `#1A1916` in dark mode, text in
  the foreground. Keys: yellow → ochre, orange → sepia, green → verdigris,
  violet → aubergine, pink → rose madder, rose → oxblood; the paler three
  (mint → verdigris, sky → indigo, lavender → aubergine) take 60% of the wash.
  Text on every note is 9.5:1 or better (12.5:1 on Cream paper). There is no separate plain sticky
  key; the paper itself is Cream.
- `board.palette`'s default drops `accent` (it is the same ink as `ink`);
  `accent` stays a valid token, so shapes and saved palettes using it keep
  working. The colour picker names the inks (Oxblood, Sepia, …).
- Selection outlines, handles, the marquee, bind hints, the drop ghost, the
  connect target's glow, quick-connect dots, search matches and the toolbar's
  active states are the foreground. The docking spark glows in the card's
  outline ink, or the foreground. Snap guides are oxblood.
- Board dark mode follows the app (`:root[data-theme="dark"]`), not the OS.
- The exported `.board.svg` carries Ink/Cream and the same inks, light and
  dark (`FILE_LIGHT` / `FILE_DARK` in `board-file.ts`); a PNG export is
  filled with Cream.

## Project tags

Tags keep their meanings (`lib/projects.ts`); the colours come from the inks:
overdue (red) = oxblood, due soon (orange) = sepia, done (green) = verdigris,
in progress (blue) = indigo, to-do and plain deadlines (gray) = graphite,
custom statuses purple / brown / pink / yellow = aubergine / umber (sepia and
graphite mixed) / rose madder / ochre. The fill is `--ink-wash` of the ink;
the text is the ink pulled 25% toward the theme's text colour (darker on
Cream, lighter on Ink). Measured on its own wash over the bare ground, every
tag reads at 5.2:1 or better on Cream (ochre is the lowest, oxblood 7.1:1) and
6.5:1 or better on Ink.

## Hard-coded colours removed

The `#ff6a00` fallbacks (block menu active tile, gutter image chip), the
gutter text chip's blue, the save-failed tab dot's macOS red (now oxblood: it is a warning),
VS Code blue link and grey fallbacks in HTML blocks, tables and wiki links,
the board's blue ghost/glow/dots and its Radix-style hues, the teal and GitHub
greys in the `.board.svg` style, the drag-lift paper's cool white and the
modal scrim's neutral greys. What stays, on purpose: black/white shadows and
scrims over pictures, mask colours, the white PDF page and iframe grounds, the
colour wheel's hue ring (it picks custom colours), Library cover tones and
the paper cover, the block menu's danger red, the crash screen, and Arc's
vendored files.

## Migration

`Settings::migrate_removed_theme_presets` (Rust, `config.rs`), run at load
with the other migrations. Per mode: if the background and foreground (stored,
or the default where unset) exactly match, ignoring case, one of the removed
presets — the fourteen deleted here plus the older `default` and `writer`,
recorded in `REMOVED_PRESETS_LIGHT` / `REMOVED_PRESETS_DARK` — that mode's
primaries are removed from the global config, so it reads as Ink. A pair that
matches no old preset was hand-made and is kept. Stored `accent` keys are
removed in both modes. A second run finds nothing to do. Only the global
config is migrated; a workspace `.writer/config` that sets theme values keeps
them. Test: `test_removed_theme_preset_migration`.

## Verification

- `tests/settings-schema.test.ts`: Ink is the only theme folder, no accent
  primary exists, and the Ink files equal the schema defaults.
- `tests/board-palette.test.ts`: the default palette drops `accent` and equals
  the schema default; every hue token is a writing ink.
- `e2e/specs/ink-theme.spec.js`: Ink in both modes with a flat ground, and no
  theme picker or accent row in Settings.
