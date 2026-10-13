# Didone display type in the app

## Problem

The brand (`docs/brand.md`) is a Didone: a thick–thin ¶ and a Bodoni Moda
wordmark, where "the thick–thin contrast is the typography", but the app had
no Didone anywhere.
Titles and headings were SF Pro at weight 600–700, and chrome labels (Spaces,
Recents, command-palette groups, the welcome and search buttons) were
monospace capitals through a `label-mono` utility, which read as a developer
tool, not a writing room.

## Behaviour

- **Display type is Bodoni Moda, regular weight.** It is used for:
  - the page title above every note (`page-title.css`)
  - editor H1 and H2 (`editor-extensions.ts`), and the same headings rendered
    in column bands and in a lifted sheet (`.wr-band`, `.wr-lift` in
    `columns.css`), so a band keeps its height when you click into it
  - space titles: Projects, Library, Inspirations, Files and user spaces
    (`.title` in `spaces.module.css`, 26px, line height 1.2).
- It is never bolded. The contrast between hairlines and stems is the emphasis.
- The browser picks the optical size from the font size
  (`font-optical-sizing: auto`), so hairlines thin out as titles grow.
- The page title no longer takes the editor's letter-spacing setting; that
  setting is for body text.
- H3–H6, body text and every control stay SF Pro.
- **Labels are tracked capitals in the UI face.** `label-mono` is replaced by
  `label-caps`: `--ui-font`, uppercase, 0.1em tracking. Command-palette group
  headings use the same voice. This matches the byline on a Library book
  cover (`.bookByline`), the in-app reference for the look.
- Monospace stays for code, math errors, number columns (the document footer's
  counts, tweet numbers) and inputs that hold codes. Library cover artwork
  (`.eyebrow`, `.paperVenue`) imitates printed objects and is not chrome.

## Font loading

- `@fontsource-variable/bodoni-moda` (OFL), imported once in `App.tsx` as
  `opsz.css` (weight and optical-size axes). Vite copies the woff2 subsets
  into the build, so the desktop app never asks Google Fonts at runtime. Each
  subset is over Vite's 4 KB inline limit, so none becomes a `data:` URL,
  which the CSP's `default-src 'self'` would block.
- Token: `--display-font: "Bodoni Moda Variable", "Didot", "Bodoni 72", serif`
  in `App.css`. The fallbacks are the macOS Didones.

## Out of scope

- Colours (the Ink/Cream theme preset is separate work).
- The website (`apps/website`): left alone and not kept in sync; it may be
  redone from scratch.
- Raw HTML `<h1>` inside markdown HTML blocks.

## Verification

- `vp test`; changed files pass `vp fmt --check`.
- e2e (`apps/desktop/e2e`, `specs/didone-type.spec.js`): computed
  `font-family`/`font-weight` of the page title, an H1, an H2, a space title,
  the sidebar labels and a palette group heading, `document.fonts.check` for
  Bodoni Moda, and screenshots.
