# Board colour palette

Shapes on a board get a FigJam-style default colour and a palette you can
grow, reorder and edit with a colour wheel.

## What FigJam does, and what we take from it

FigJam's shape colours are **pairs**: every hue has a pale tint for the fill
and a stronger shade of the same hue for the outline. A new shape is a pale
fill with its matching outline, never a black outline on nothing. The picker
lists the same hues in the same order everywhere: neutrals first, then round
the wheel (red, orange, yellow, green, teal, blue, purple, pink).

We copy the method but use Writer's own colours, the `--wr-board-*` tokens:

- **Strong** (outline, line, text): the token itself, e.g. `--wr-board-blue`.
- **Soft** (fill): `--wr-board-<hue>-soft`, defined as
  `color-mix(in oklch, var(--wr-board-<hue>) 22%, var(--wr-board-surface))`.
  Mixing toward the board surface rather than toward white makes it follow
  dark mode by itself: on a dark board the soft fill is a dark tint of the hue.
- Yellow and pink are added as tokens so the hue circle has no gaps. They are
  written in OKLCH, at a lightness that reads as an outline on white.

## Defaults

- A new shape (drawn, clicked, placed with R/O/D, or grown from a connect dot)
  is `f: "blue-soft"`, `s: "blue"`.
- The **file-format** default stays `s: "ink", f: "none"`. Files leave out
  values that equal the format default, so changing it would recolour every
  shape in every existing board. New shapes simply write their colours out.

## Palette

- One palette for the whole app, stored in the `board.palette` setting (a list
  of strings). Default: `ink, muted, red, orange, yellow, green, accent, blue,
  purple, pink`.
- An entry is a token name or a custom colour as `#rrggbb`.
- The Fill picker shows **No fill**, then every entry's soft version (a custom
  colour is used as it was picked). The Border picker shows every entry's
  strong version. Same order in both.
- Editing the palette never changes shapes already on a board; it only changes
  what the pickers offer.

### Editing

- **+** at the end of the swatches opens the colour wheel. **Add** saves the
  colour to the palette and applies it to the selection.
- **Edit** switches the swatches into edit mode:
  - drag a swatch to move it;
  - click a swatch to open the wheel on it; **Replace** swaps it in place,
    **Remove** deletes it;
  - **Reset** puts the default palette back.
  - **Done** leaves edit mode.
- The wheel: a hue/saturation disc, a lightness slider and a hex field. Enter
  in the hex field confirms.

## Custom colours in dark mode

A custom colour is stored exactly as picked (`#rrggbb`) and drawn through CSS
relative-colour syntax that remaps its OKLCH lightness when the board is
dark:

```
oklch(from #hex  l' c' h)
l' = l + flip · (clamp(0.25, 1.15 − l, 0.9) − l)
c' = c · (1 − 0.2 · flip)
```

`--wr-board-flip` is `0` in light mode and `1` in dark mode (set wherever the
other board tokens switch, including the style block inside every
`.board.svg`). A pale fill (L≈0.93) becomes a dark tint (L≈0.25), a mid-tone
outline stays mid-tone, near-black ink becomes near-white, and chroma drops
20% so saturated colours don't vibrate on a dark background.

Trade-off: an app that can't read relative colours (old browsers, some SVG
viewers) draws a custom colour as nothing. Writer's WebKit and current
browsers support it.

## Safety

Board files are untrusted input. A colour is accepted only if it is a known
token, a known `-soft` token, `none`, or exactly `#` plus six hex digits;
anything else is replaced with the default when the file is read.

## Not doing

- Opacity per colour.
- Separate palettes for fill and border.
- Text and mind-map branch colours stay on the fixed token list.
