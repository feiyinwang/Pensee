# Warm neutrals and dots

Status: implemented

Supersedes the palette parts of [ink-only-colour-spec.md](ink-only-colour-spec.md)
(the Cream/Ink pair, the writing inks, the tinted tags). What that spec says
about having no accent colour, the flat ground, links, the focus ring and the
removed presets still holds. Colour work only: fonts, the type scale
([type-scale-spec.md](type-scale-spec.md)) and Bodoni Moda titles are
unchanged.

The look follows Harvey's product pages (harvey.ai/platform/vault): a
near-white page on a slightly darker warm grey, warm neutral greys for every
step of text and line, no accent, and colour only in small dots that carry a
meaning.

## Grounds and text

The primaries (`shared/themes/ink/*.json`, the schema defaults, the
pre-hydration fallbacks in `App.css`):

| Mode  | Background | Foreground |
| ----- | ---------- | ---------- |
| Light | `#FAFAF9`  | `#0F0E0D`  |
| Dark  | `#0F0E0D`  | `#FAFAF9`  |

The ramp is named per mode in `styles/tokens.css` (primitives `--gray-*`,
semantic `--color-text-*`, `--color-border-*`, `--color-bg-*`; see
[docs/design-tokens.md](../docs/design-tokens.md)), not mixed from the
primaries, so each step lands on a measured value. A custom Background or
Foreground still moves the ground and the title text; the steps in between
stay. WCAG ratios against the ground / the raised surface:

| Step           | Token(s)                                | Light     | ratio         | Dark      | ratio        |
| -------------- | --------------------------------------- | --------- | ------------- | --------- | ------------ |
| Text           | `--text-primary`                        | `#0F0E0D` | 18.5 / 17.1   | `#FAFAF9` | 18.5 / 16.5  |
| Secondary      | `--text-secondary`, editor body copy    | `#33312C` | 12.4 / 11.5   | `#CCCAC6` | 11.8 / 10.5  |
| Muted          | `--text-muted`, unchecked task box      | `#706D66` | 4.9 / 4.6     | `#8F8B85` | 5.7 / 5.1    |
| Faint          | `--text-icon-muted`, `--text-faint`     | `#8F8B85` | 3.2 / 3.0     | `#706D66` | 3.7 / 3.3    |
| Control edge   | `--color-border-strong`                 | `#8F8B85` | 3.2           | `#706D66` | 3.7          |
| Hairline       | `--border-color`, `--line-subtle`       | `#CCCAC6` | decorative    | `#33312C` | decorative   |
| Raised surface | `--color-bg-raised`: code, tags         | `#F2F1F0` |               | `#1C1B19` |              |
| Card           | `--color-bg-canvas`: editor, board      | `#FAFAF9` |               | `#161513` |              |
| Chrome         | `--color-bg-app`: window, sidebar       | `#F2F1F0` |               | `#0F0E0D` |              |

Faint is for icons and placeholders (non-text, 3:1). Hairlines divide; they are
never the only edge of a control, which uses `--color-border-strong` or a
fill. `--color-border-subtle` (`--line-subtler`) is the hairline at 60%.

Light mode sets the window chrome on the raised grey and the editor card on
the near-white ground, like a page with sections; dark mode keeps the chrome
on the ground and lifts the card to `#161513`. The card fades with the
Translucent setting like the backdrop.

Fills that must read on both the chrome and a card (hover, selected, inputs,
`--surface-subtle`) stay foreground-on-transparent, scaled by the Contrast
setting, whose description now says so. Hairlines and text no longer follow
Contrast.

| Surface      | Now                                                    |
| ------------ | ------------------------------------------------------ |
| Selection    | foreground at 12%                                      |
| Focus ring   | 2px foreground; `--focus-border` is the foreground     |
| Checked task | foreground fill, ground-coloured tick (unchanged)      |
| Toggles      | foreground track, ground knob (unchanged)              |
| Code         | names in the foreground, strings secondary, comments muted italic, on `#F2F1F0` / `#1C1B19` |
| Error text   | `#B23A2E` light (5.7:1), `#E57B6C` dark (6.8:1)        |

## Dots

The only colours besides the neutrals: `--hue-*` primitives, read as
`--color-dot-*` and `--color-status-*` (`styles/tokens.css`), one set for both
modes. Colour sits in a small mark, never in text. Each is 3:1 or better
(non-text) on all five grounds.

| Dot    | Value     | on #FAFAF9 | on #F2F1F0 | on #0F0E0D | on #1C1B19 |
| ------ | --------- | ---------- | ---------- | ---------- | ---------- |
| red    | `#CC4B3C` | 4.3        | 4.0        | 4.3        | 3.8        |
| orange | `#C46A22` | 3.7        | 3.4        | 5.0        | 4.5        |
| yellow | `#A8820A` | 3.4        | 3.2        | 5.4        | 4.8        |
| green  | `#3F8F5A` | 3.8        | 3.5        | 4.9        | 4.3        |
| blue   | `#3C72C9` | 4.5        | 4.2        | 4.1        | 3.6        |
| purple | `#8A5CC7` | 4.5        | 4.2        | 4.1        | 3.6        |
| pink   | `#C4508A` | 4.1        | 3.8        | 4.5        | 4.0        |
| gray   | `#85817B` | 3.7        | 3.4        | 5.0        | 4.4        |

`--color-dot-tint` is how much of a dot a tinted ground takes: 10% light, 16% dark.
The failed-save dot on a tab is red.

## Tags

Project tags (`project-views.module.css`) and Library statuses
(`spaces.module.css`) are neutral grey pills (`--color-tag-bg`, text
`--color-tag-text`) with a 6px dot before the label. Tone → colour lives once,
in `TONE_COLOR` (`lib/projects.ts`), set on the element as `--tag`: overdue red,
due soon orange, done green, in progress blue, to-do and plain deadlines gray;
custom statuses purple, brown (orange pulled halfway to gray), pink, yellow.
A Library status takes the tone its word has in Projects
(`statusTextTone`). Timeline bars keep their tinted fill in the same colour.

## Boards

The palette keys stay (`ink, muted, red, orange, yellow, green, accent, blue,
purple, pink` and the nine sticky keys), so every board re-tints. `ink` and
`accent` are the foreground, `muted` the muted grey, the hues their dots. Soft
fills mix 22% into the board surface in OKLab. The board surface is the card
ground.

Sticky notes are near-neutral paper: `#F2F1F0` (dark `#1C1B19`) with
`--color-dot-tint` of their colour mixed in OKLab (the paler mint, sky and lavender
take 60%), text in the foreground. Selection, handles and the toolbar's active
states stay the foreground. The picker names the colours plainly: Default,
Gray, Red, Orange, Yellow, Green, Blue, Purple, Pink.

The `.board.svg` style carries the same values: `FILE_LIGHT` / `FILE_DARK` in
`board-file.ts` read the board tokens through `lib/design-tokens.ts`; a PNG
export is filled with the light board surface.

### Older board files

A `.board.svg` carries its colours in its own `<style>`, so a board saved
before this change would keep the old colours in the note's `<img>` preview
until saved again. `withCurrentStyle(text)` (`board-file.ts`) returns the text
with its first `<style>` replaced by the current one, or null when it is
already current or has none. `boardImageEnhancer` (`board-file-session.ts`)
reads a board not written this session, and when the style is stale shows the
restyled text from a Blob URL, cached per file and applied to every preview of
it. A save during the read wins; `refreshPreviews` revokes and drops the URL.
Files on disk are not rewritten.

## Buttons

Filled foreground buttons have 4px corners: welcome **Add Folder**, find and
replace **All**, the composer's submit button, the Spaces empty-state action
(`.emptyAction`, also the X sync bar), and the filled button in the X account
row in Settings. Pills, segmented controls and other radii are unchanged.

## Migration

`REMOVED_PRESETS_LIGHT` / `_DARK` in `config.rs` gain the retired Cream/Ink
pair (light `#ECE7DC`/`#0B0B0B`, dark `#0B0B0B`/`#ECE7DC`), so a config still
on it reads as the new defaults. `test_removed_theme_preset_migration` covers
it.

## Verification

- `tests/settings-schema.test.ts`: the theme files equal the new defaults.
- `tests/board-palette.test.ts`: every hue token is a dot colour or a neutral.
- `tests/board-file.test.ts`: `withCurrentStyle`.
- `e2e/specs/ink-theme.spec.js`: the primaries in both modes.
