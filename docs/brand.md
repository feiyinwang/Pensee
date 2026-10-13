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
bundle identifier is `com.pensee.app`.

A few old **Writer** names stay on purpose. Nobody sees them in the app, and
renaming any of them would lose data. Moving one needs a migration that still
reads the old name
([SPECs/pensee-rebrand-spec.md](../SPECs/pensee-rebrand-spec.md)).

| Kept name             | What it is                                    | Why it stays                                                     |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `com.f.writer-mine`   | The local build's bundle identifier           | Its folder holds the settings and the workspace list             |
| `.writer/config`      | The workspace config folder inside each vault | Every existing vault already has one                             |
| `writer-board`        | The metadata id inside `.board.svg` files     | Pensée reads an existing board's scene back from it              |
| `writer.video-player` | The video player's storage key                | It holds your playback speed and subtitle choice                 |
| `Writer X Bookmarks`  | The Keychain service for the X sign-in        | Renaming it signs you out of X. It is visible in Keychain Access |

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

Black and cream only for the mark: no accent colour, no gradients on it. The
app icon's body may carry a faint top-to-bottom fall-off (`#1e1e1e` →
`#0b0b0b`), the way macOS icons do.

### The app UI

The app itself does not use Ink and Cream. It uses warm neutrals in the
manner of Harvey's product pages: a near-white page `#FAFAF9` with near-black
text `#0F0E0D` (reversed in dark mode), a raised warm grey `#F2F1F0` for the
window chrome, code and tags, and named grey steps for secondary text, muted
text, icons and hairlines
([SPECs/harvey-neutral-colour-spec.md](../SPECs/harvey-neutral-colour-spec.md)).

**The app UI has one accent, blue by default** (the **Accent** setting picks
another palette hue). It marks what is selected or on: selected text (on the
accent's pastel), the focus ring, checked tasks, switches, the calendar's
selected day and the ¶ after a selected paragraph. Links, buttons, titles and
board selection stay in the foreground
([SPECs/harvey-neutral-colour-spec.md](../SPECs/harvey-neutral-colour-spec.md)).

Where colour has to carry a meaning or a user's choice (a status, a board
shape, a sticky note), it is one of eight dot colours (red, orange,
yellow, green, blue, purple, pink, gray; `--color-dot-*` in
`styles/tokens.css`), each 3:1 or better on both grounds,
and it sits in a small mark: a 6px dot before a grey tag's label, a board
stroke, a light tint on a sticky note. Text stays neutral. Code is not
coloured: names in the foreground, strings in the secondary grey, comments in
the muted grey and italic.

## Wordmark and lockups

- **Wordmark:** `PENSÉE` in capitals, high-contrast Didone serif, tracked at
  0.2em. Bodoni Moda (Google Fonts, regular weight, optical size on) is the
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

## Type in the app

- **Display:** the page title, editor H1–H2, and space titles (Projects,
  Library, Inspirations) are set in Bodoni Moda, regular weight, optical size
  on — never bold. Use the `--display-font` token (`App.css`); the font ships
  in the app (`@fontsource-variable/bodoni-moda`, the `opsz` build), never from
  Google Fonts at runtime.
- **Text and controls:** SF Pro (`--ui-font`, `--editor-font`). H3 and below
  stay in SF Pro.
- **Labels:** section headings like Spaces and Recents, command-palette group
  headings, and label-style buttons are SF Pro in tracked capitals (the
  `label-caps` utility, 0.1em). Not monospace; monospace is for code and
  numbers in columns only.
- **Wordmark in the sidebar:** `PENSÉE` on its own row at the top of the
  sidebar, under the window buttons, on the nav's content edge (the Spaces label
  and row icons). The Search
  icon sits at the right end of the same row; there is no Search field below.
  Bodoni Moda regular, 16px, tracked 0.2em, in the theme's foreground colour;
  no ¶ beside it.

See [`SPECs/didone-display-type-spec.md`](../SPECs/didone-display-type-spec.md).

### Type sizes

Nothing in the app's chrome is smaller than **13px**. Chrome text uses one of
three tokens, defined once in `App.css` (`@theme static`); CSS reads
`var(--text-…)`, Tailwind uses `text-caption`, `text-label`, `text-ui`:

| Token            | Size | For                                                                                                     |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| `--text-caption` | 13px | Counts, timestamps, badges, kbd hints, section labels, chips, secondary lines, the status bar           |
| `--text-label`   | 14px | Sidebar items, tabs, buttons, segmented controls, menu items, settings row titles, card titles          |
| `--text-ui`      | 15px | Running text: search and text fields, palette items, settings descriptions, chat, empty states, banners |

- Need a size? Pick a token. Don't add a pixel literal; a new size is a new
  token here and in `App.css`.
- `--text-xs` is floored at the caption size, so Tailwind's `text-xs` and
  Arc's `var(--text-xs)` can't go below 13px.
- Short text beside other things (counts, dates, buttons, tab labels) stays
  on one line: `white-space: nowrap`, and `flex-shrink: 0` in a flex row.
- Not covered: glyphs drawn as text, display type, and user content (board
  text, the book reader's text size, Library cover art).
- **Editor:** body 18px, line height 1.9, a 660px column (about 66
  characters), and a 2em blank line between blocks, so paragraphs sit a full
  line apart (Ulysses' rhythm, `SPECs/writing-rhythm-spec.md`). These are the
  defaults of `editor.font-size`, `editor.line-height` and
  `editor.content-width`; headings are em-relative and the page title is
  twice the body.

See [`SPECs/type-scale-spec.md`](../SPECs/type-scale-spec.md).

## App icon

[`app-icon.svg`](../assets/brand/app-icon.svg) and
[`app-icon-1024.png`](../assets/brand/app-icon-1024.png):

- an Ink macOS-style squircle (an 824px body on a 1024px canvas, with a soft
  drop shadow)
- the small cut in Cream, centred, about 56% of the body's height.

Every platform icon in `apps/desktop/src-tauri/icons/` and the website favicon
are generated from the PNG. The desktop app has no favicon: its webview never
shows one, and the Dock and window take the platform icons. To change the icon:

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
