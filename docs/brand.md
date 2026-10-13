# Brand

Pensée's logo is a pilcrow (¶), drawn in the high-contrast serif style
fashion houses use. This doc is the reference for the mark, its colours,
the wordmark, and how to regenerate the app icon. The sources are in
[`assets/brand/`](../assets/brand/).

![The mark](../assets/brand/pensee-mark.svg)

## The idea

**Thinking is made by writing.** In a world where AI hands out answers, clear
thinking still comes from writing down what you actually care about and
working on it until it's true. The ¶ marks where a paragraph, a whole thought,
begins. The mark says that, and nothing about technology. AI is part of the
story, never part of the mark.

The visual direction comes from fashion houses (LV, Prada, Dior, early Saint
Laurent), not tech. They use Didone contrast: heavy stems and hairlines that
nearly disappear, sharp serifs, restraint, black and cream. The mark is one
part of a system: the symbol, a widely tracked wordmark in capitals, and,
later, a monogram surface.

## The name

**Pensée**: French for "a thought". It's set in capitals as `PENSÉE`, and the
accent is always kept.

- **Story:** Pascal's _Pensées_ are the loose notes he wrote to work out what
  he believed. That is thinking made by writing, which is what a notes vault
  is for.
- **Pattern:** _pensée_ is also the pansy flower, which can be the monogram
  canvas's secondary motif (see Later).

The app, the website and the CLI (`pensee`) all use the name. The app's
bundle identifier is `com.pensee.app`; the local build keeps `com.f.writer-mine`
so its settings carry over.

## The mark

The "Thick–Thin ¶", maison cut. It has four parts:

- **Heavy stem** on the left.
- **Light stem** on the right, separated by a narrow slit.
- **Top bar** joining them, as thin as the light stem.
- **Two concave serifs** set diagonally opposite, like the one stroke of a pen.
  One comes in at the top left, and one goes out at the bottom right. They are
  cut as quarter circles that hug the corner, so their tips are knife-sharp.
  The sharpness of the serifs is the point of the mark. Never round them off.

The geometry is one outline: no strokes, no overlapping parts. It has two cuts
with identical structure:

| Cut                                                                          | Heavy stem | Slit | Light stem | Bar | Top serif | Bottom serif | Height | Use                                                        |
| ---------------------------------------------------------------------------- | ---------- | ---- | ---------- | --- | --------- | ------------ | ------ | ---------------------------------------------------------- |
| **Display** ([`pensee-mark.svg`](../assets/brand/pensee-mark.svg))           | 21         | 8    | 3          | 3   | 30        | 22           | 76     | Large: website hero, print, packaging, lockups ≥ 48px tall |
| **Small** ([`pensee-mark-small.svg`](../assets/brand/pensee-mark-small.svg)) | 21         | 8    | 6          | 5   | 28        | 20           | 76     | App icon, favicon, anything under about 48px               |

Units are relative (the left stem starts at x = 0). The display cut's
hairlines disappear at small sizes, which is why the small cut exists. Fashion
houses keep two cuts for the same reason. Don't use the display cut under 48px.

Both SVGs use `currentColor`, so they take the text colour they're placed in.

## Colour

| Name  | Hex       | Use                                         |
| ----- | --------- | ------------------------------------------- |
| Ink   | `#0b0b0b` | Mark on light grounds; dark grounds         |
| Cream | `#ece7dc` | Mark and wordmark on Ink; the app-icon mark |

Black and cream only. No accent colour, no gradients on the mark. The app
icon's body may carry a faint top-to-bottom fall-off (`#1e1e1e` → `#0b0b0b`),
the way macOS icons do.

## Wordmark and lockups

- **Wordmark:** `PENSÉE` in capitals, high-contrast Didone serif, tracked at
  0.34em. Bodoni Moda (Google Fonts, regular weight, optical size on) is the
  stand-in until a custom wordmark is drawn.
- **Horizontal lockup:** the mark (display cut) then the wordmark. The mark is
  about 1.6× the cap height of the wordmark, and the gap is about half the
  mark's height.
- **Stacked lockup (hero):** the mark centred above the wordmark, on Ink, in
  Cream. An optional italic tagline sits underneath: _Thinking, made by
  writing._ The tagline is Bodoni Moda italic at about half the wordmark's
  size, 75% opacity.
- **Clear space:** keep at least the width of the heavy stem empty on every
  side of the mark.

## App icon

[`app-icon.svg`](../assets/brand/app-icon.svg) and
[`app-icon-1024.png`](../assets/brand/app-icon-1024.png):

- an Ink macOS-style squircle (an 824px body on a 1024px canvas, with a soft
  drop shadow)
- the small cut in Cream, centred, about 56% of the body's height.

Every platform icon in `apps/desktop/src-tauri/icons/` and the website favicon
are generated from the PNG. To change the icon:

```bash
python3 -I assets/brand/render-icon.py
```

```bash
cd apps/desktop && node_modules/.bin/tauri icon ../../assets/brand/app-icon-1024.png
```

```bash
cp assets/brand/favicon-512.png apps/website/public/favicon.png
```

`render-icon.py` holds the geometry (`DISPLAY`, `SMALL`) and writes the three
SVGs, the 1024px icon and the 512px favicon. Change the numbers there, not in
the SVGs by hand.

## Don't

- Round the serifs, or turn them into slabs or balls. Those cuts were explored
  and rejected.
- Make the stems equal weight. The thick–thin contrast is the typography.
- Outline the mark, add a stroke, put it in a circle or badge, or add texture.
- Add the AI sparkle (✦), a cursor, a nib or any second symbol to it.
- Use the display cut below 48px, or the small cut where the display cut fits.
- Use colours other than Ink and Cream.

## Later

- **Monogram canvas:** the ¶ repeated as a surface, like a house canvas, for a
  splash screen, packaging, merch or the website footer. The four-petal flower
  used in the exploration sits too close to Louis Vuitton's monogram flowers.
  Give the canvas its own secondary motif, for example one cut from the ¶'s
  concave serif.
- **Custom wordmark:** draw `PENSÉE` to match the mark's contrast and serif
  shape instead of using Bodoni Moda.
- **Trademark search** on the final mark before it goes on anything sold.

## How we got here

The brief and every round of exploration are in
[`assets/brand/`](../assets/brand/):

- [`logo-brief.md`](../assets/brand/logo-brief.md) has the brief, the message
  decision ("thinking is made by writing", AI kept out of the mark) and the 20
  first concepts.
- [`explorations/`](../assets/brand/explorations/) has every round, drawn and
  viewable in a browser:
  - `logo-explorations.html`: rounds 1–10. Cursors, nibs, pilcrows, AI and
    "gold" metaphors, Echo.
  - `logo-shapes.html`: a fresh set of minimal shapes.
  - `logo-concepts.html`: the 20 concepts from the brief, drawn.
  - `logo-directions.html`: directions after reviewing Logobook's archive.
  - `logo-punctuation.html`: punctuation with serifs. This is where the Twist
    ¶, its heavier versions and the Thick–Thin variants are.
  - `logo-maison.html`: the fashion-house cut, the lockups and the monogram
    canvas. The chosen direction.

What carried through:

- The concave, knife-sharp serif. It came from the "Twist cursor": an I-beam
  with only two diagonal serifs.
- Punctuation as the mark.
- Thick–thin contrast.
- A strict black-and-cream palette.

What was dropped:

- AI imagery.
- Forced combinations of two ideas.
- Outlines and textures.
- Metaphors far from writing.
