# Warm neutrals and dots

Status: implemented

Supersedes the palette parts of [ink-only-colour-spec.md](ink-only-colour-spec.md)
(the Cream/Ink pair, the writing inks, the tinted tags) and its "no accent"
rule (see Accent below). What that spec says about the flat ground, links and
the removed presets still holds. Colour work only: fonts, the type scale
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
| Selection    | the accent's pastel (see Accent)                       |
| Focus ring   | 2px accent; `--focus-border` is the accent             |
| Checked task | accent fill, white tick                                |
| Toggles      | accent track, white knob                               |
| Code         | names in the foreground, strings secondary, comments muted italic, on `#F2F1F0` / `#1C1B19` |
| Error text   | `#B23A2E` light (5.7:1), `#E57B6C` dark (6.8:1)        |

## Dots

The only colours besides the neutrals: `--hue-*` primitives, read as
`--color-dot-*` and `--color-status-*` (`styles/tokens.css`), one set for both
modes. Every hue sits at one level, `oklch(0.60 0.12 h)`, so none is louder or
darker than another: red 25°, orange 58°, yellow 92°, green 155°, blue 245°,
purple 300°, pink 350° (gray is the warm grey). Each is 3:1 or better
(non-text) on all four grounds.

Each hue also has a pastel, Harvey's pill level: the same hue at lightness
0.86 and half-ish its chroma (0.07) in light mode, lightness 0.36 and chroma
0.06 in dark mode. It is written once as `oklch(from <hue>
var(--color-tint-l) calc(c * var(--color-tint-chroma)) h)`, so it follows any
hue, including a tag's or the accent. Text on a pastel is the primary text.

| Hue    | Mid       | on #FAFAF9 | on #F2F1F0 | on #0F0E0D | on #1C1B19 | Light pastel | ink on it | Dark pastel | text on it |
| ------ | --------- | ---------- | ---------- | ---------- | ---------- | ------------ | --------- | ----------- | ---------- |
| red    | `#BD615B` | 4.0        | 3.7        | 4.6        | 4.1        | `#FCC0BA`    | 12.3      | `#59302D`   | 10.7       |
| orange | `#B56C2D` | 3.9        | 3.6        | 4.7        | 4.2        | `#F5C6A4`    | 12.4      | `#55351B`   | 10.5       |
| yellow | `#9A7D0B` | 3.8        | 3.5        | 4.9        | 4.4        | `#E1D09D`    | 12.6      | `#483C13`   | 10.4       |
| green  | `#389560` | 3.6        | 3.3        | 5.2        | 4.6        | `#ADDFBD`    | 12.9      | `#20462F`   | 10.2       |
| blue   | `#3786C3` | 3.8        | 3.5        | 4.9        | 4.4        | `#ABD7FD`    | 12.7      | `#1F405B`   | 10.4       |
| purple | `#8C6EBD` | 4.0        | 3.7        | 4.7        | 4.2        | `#D8C7F9`    | 12.4      | `#423658`   | 10.6       |
| pink   | `#B4608A` | 4.0        | 3.7        | 4.6        | 4.1        | `#F6BFD7`    | 12.3      | `#552F42`   | 10.7       |
| gray   | `#85817B` | 3.7        | 3.4        | 5.0        | 4.4        | near-grey    |           | near-grey   |            |

`--color-dot-tint` is how much of a dot a tinted ground takes: 10% light, 16% dark.
The failed-save dot on a tab is red.

## Tags

Project tags (`project-views.module.css`) and Library statuses
(`spaces.module.css`) are Harvey's pills: the pastel of the tag's colour, its
label in the primary text, no dot. Tone → colour lives once,
in `TONE_COLOR` (`lib/projects.ts`), set on the element as `--tag`: overdue red,
due soon orange, done green, in progress blue, to-do and plain deadlines gray;
custom statuses purple, brown (orange pulled halfway to gray), pink, yellow.
A Library status takes the tone its word has in Projects
(`statusTextTone`). Timeline bars keep their tinted fill in the same colour.

## Accent

One accent, `--color-accent`, set by **Accent** (`appearance.accent`, under
Appearance): blue by default, or green, yellow, orange, red, purple, pink or
gray. The setting stores the hue's name; `cssFormat: "hue"` writes
`var(--hue-<name>)` into `--accent-hue` (`lib/theme.ts`). It is the same in
both modes.

| Where                              | How                                               |
| ---------------------------------- | ------------------------------------------------- |
| Selected text (editor)             | the accent's pastel (`--color-selection`)         |
| Keyboard focus ring                | 2px accent (`--color-focus`, also Arc's ring)     |
| Checked task                       | accent box, white tick                            |
| Settings switches                  | accent track, white knob                          |
| Calendar's selected day            | the accent's pastel, number in the text colour (white on the accent is under 4.5:1) |
| ¶ after a selected paragraph       | the accent                                        |

Links, filled buttons, titles, the drag count badge and board selection stay
in the foreground. Boards keep their `accent` key as ink.

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

- `tests/settings-schema.test.ts`: the theme files equal the new defaults;
  the accent is one setting whose every option names a `--hue-*` token.
- `tests/board-palette.test.ts`: every hue token is a dot colour or a neutral.
- `tests/board-file.test.ts`: `withCurrentStyle`.
- `e2e/specs/ink-theme.spec.js`: the primaries in both modes.
