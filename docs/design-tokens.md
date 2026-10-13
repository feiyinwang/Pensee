# Design tokens

Every colour, font, type size, corner radius and shadow the app draws with is
set once, in [`apps/desktop/src/styles/tokens.css`](../apps/desktop/src/styles/tokens.css).
`App.css` imports it first. Components read tokens; they never write a value.

## Rules

- **Components use semantic tokens** (`--color-text-muted`, `--radius-field`,
  `--shadow-popover`), named by role. Never a hex, `rgb()`, font stack, px font
  size, px radius or px shadow.
- **Primitives** (`--gray-500`, `--hue-red`, `--radius-8`) are read only by
  `tokens.css` itself.
- **Legacy names** (`--text-primary`, `--surface-subtle`, `--accent`, …) are
  aliases of semantic tokens. They hold no values. New code uses the semantic
  name; old code keeps working.
- `tests/design-tokens.test.ts` scans `src/` (except `tokens.css` and Arc's
  vendored `components/arc/`) and fails on a raw colour, a font stack, a px
  font size, a px radius or a px shadow. A ring (`0 0 0 1px <token colour>`)
  is a border and is allowed. A value that cannot be a token carries a
  `token-exception: <reason>` comment on its line or just before it. Today
  that is: the colour wheel's hue ring and brightness slider, alpha masks
  (scroll fades, the tab title fade, the drag paper's fade, the task tick),
  the select chevron's stroke inside an SVG data URL, and the zero font size
  that hides markdown syntax. `components/sidebar/index.tsx` is skipped while
  a parallel change owns it; its wordmark's `text-[16px]` becomes
  `--font-size-heading-sm` when that lands.
- The same test checks that the theme defaults in `shared/settings.schema.json`
  equal the token values.

## How to swap

- **A colour everywhere**: change the primitive (`--hue-blue: …`). Every
  semantic token, board key and `.board.svg` export that uses it follows.
- **What a role uses**: point the semantic token at another primitive
  (`--color-text-muted: var(--gray-400)`), in `:root` for dark and in
  `[data-theme="light"]` for light.
- **A font**: change `--font-family-*` (the stack), or `--font-title` (which
  stack titles use). The UI, editor and code fonts are also Settings
  (`--ui-font`, `--editor-font`, `--mono-font`); the tokens give their defaults.
- **A size, radius or shadow**: change the primitive (`--font-size-14`,
  `--radius-8`, `--shadow-2`) to move every role on it, or point one role at
  another step. Tailwind's `rounded-*`, `shadow-sm/md/lg` and `text-caption /
  label / ui` read the tokens (`App.css` `@theme`).

## Where the literal values go

Code that cannot use `var()` reads the same file through
[`lib/design-tokens.ts`](../apps/desktop/src/lib/design-tokens.ts):
`tokenValue("--wr-board-red", "light")` parses `tokens.css` (imported with
`?raw`) and resolves `var()` chains to a value. The exported `.board.svg`
style (`FILE_LIGHT` / `FILE_DARK` in `board-file.ts`), the PNG export's ground
and the colour setting's fallback swatch use it, so they never hold a copy.
Vitest lets `tokens.css` through its CSS stub for this (`vite.config.ts`).

## Arc

Arc's `foundation.css` is vendored and never edited ([arc.md](./arc.md)).
`ensureArcTokens()` hands every Arc token Pensée also defines back to
Pensée, and `ARC_MAP` in `board/arc-tokens.ts` points Arc's own colour,
shadow and font tokens (`--surface`, `--background`, `--foreground`,
`--border*`, `--accent-*`, `--danger`, `--success`, `--warning`,
`--focus-ring`, `--shadow-raised`, `--shadow-floating`, `--font-body`,
`--font-display`) at the semantic ones. Arc's radii and spacing stay Arc's.

## 1. Primitives

### Colours

The warm neutral ramp and the hues
([SPECs/harvey-neutral-colour-spec.md](../SPECs/harvey-neutral-colour-spec.md)).
Each mid hue reads at 3:1 or better on every grey ground.

| Token | Light | Dark |
| --- | --- | --- |
| `--gray-50` | `#fafaf9` | same |
| `--gray-100` | `#f2f1f0` | same |
| `--gray-300` | `#cccac6` | same |
| `--gray-400` | `#8f8b85` | same |
| `--gray-500` | `#706d66` | same |
| `--gray-700` | `#33312c` | same |
| `--gray-800` | `#1c1b19` | same |
| `--gray-850` | `#161513` | same |
| `--gray-900` | `#0f0e0d` | same |
| `--white` | `#ffffff` | same |
| `--black` | `#000000` | same |
| `--hue-red` | `#cc4b3c` | same |
| `--hue-orange` | `#c46a22` | same |
| `--hue-yellow` | `#a8820a` | same |
| `--hue-green` | `#3f8f5a` | same |
| `--hue-blue` | `#3c72c9` | same |
| `--hue-purple` | `#8a5cc7` | same |
| `--hue-pink` | `#c4508a` | same |
| `--hue-gray` | `#85817b` | same |
| `--hue-red-deep` | `#b23a2e` | same |
| `--hue-red-pale` | `#e57b6c` | same |

### Library cover art

A picture of a book, not chrome: the same in both themes. `space-cover.tsx`
picks a tone (0–9) by title; `.toneN` in `spaces.module.css` reads it.

| Token | Light | Dark |
| --- | --- | --- |
| `--cover-paper-bg` | `#fbfaf6` | same |
| `--cover-paper-fg` | `#23211d` | same |
| `--cover-paper-venue` | `#8a8578` | same |
| `--cover-paper-authors` | `#5f5b52` | same |
| `--cover-paper-rule` | `#dcd8cd` | same |
| `--cover-paper-rule-soft` | `#e9e6dd` | same |
| `--cover-tone-0-bg` | `#efe6d6` | same |
| `--cover-tone-0-fg` | `#3a2e1f` | same |
| `--cover-tone-1-bg` | `#23262b` | same |
| `--cover-tone-1-fg` | `#f2ede4` | same |
| `--cover-tone-2-bg` | `#1f4d3f` | same |
| `--cover-tone-2-fg` | `#e6f2ec` | same |
| `--cover-tone-3-bg` | `#d9825b` | same |
| `--cover-tone-3-fg` | `#2b140a` | same |
| `--cover-tone-4-bg` | `#bfd7ea` | same |
| `--cover-tone-4-fg` | `#13283a` | same |
| `--cover-tone-5-bg` | `#4a2c4f` | same |
| `--cover-tone-5-fg` | `#f3e6f2` | same |
| `--cover-tone-6-bg` | `#c9d6b8` | same |
| `--cover-tone-6-fg` | `#1f2a14` | same |
| `--cover-tone-7-bg` | `#e8b4b8` | same |
| `--cover-tone-7-fg` | `#3a1418` | same |
| `--cover-tone-8-bg` | `#e3b23c` | same |
| `--cover-tone-8-fg` | `#2a1d02` | same |
| `--cover-tone-9-bg` | `#1e2f55` | same |
| `--cover-tone-9-fg` | `#e3e9f7` | same |

### Fonts

| Token | Light | Dark |
| --- | --- | --- |
| `--font-family-system` | `-apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"` | same |
| `--font-family-mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` | same |
| `--font-family-didone` | `"Bodoni Moda Variable", "Didot", "Bodoni 72", serif` | same |
| `--font-family-book-serif` | `"New York", "Iowan Old Style", "Palatino", Georgia, serif` | same |
| `--font-family-glyph-serif` | `Georgia, "Times New Roman", serif` | same |

### Type sizes

| Token | Light | Dark |
| --- | --- | --- |
| `--font-size-8` | `8px` | same |
| `--font-size-9` | `9px` | same |
| `--font-size-13` | `13px` | same |
| `--font-size-14` | `14px` | same |
| `--font-size-15` | `15px` | same |
| `--font-size-16` | `16px` | same |
| `--font-size-17` | `17px` | same |
| `--font-size-18` | `18px` | same |
| `--font-size-20` | `20px` | same |
| `--font-size-21` | `21px` | same |
| `--font-size-22` | `22px` | same |
| `--font-size-24` | `24px` | same |
| `--font-size-26` | `26px` | same |
| `--font-size-72` | `72px` | same |

### Radii

| Token | Light | Dark |
| --- | --- | --- |
| `--radius-2` | `2px` | same |
| `--radius-4` | `4px` | same |
| `--radius-6` | `6px` | same |
| `--radius-8` | `8px` | same |
| `--radius-10` | `10px` | same |
| `--radius-12` | `12px` | same |
| `--radius-16` | `16px` | same |
| `--radius-20` | `20px` | same |
| `--radius-round` | `999px` | same |

### Shadows

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-1` | `0 1px 2px rgb(0 0 0 / 6%), 0 6px 16px -6px rgb(0 0 0 / 18%)` | same |
| `--shadow-2` | `0 1px 2px rgb(0 0 0 / 6%), 0 12px 32px -8px rgb(0 0 0 / 22%)` | same |
| `--shadow-3` | `0 8px 24px rgb(0 0 0 / 18%)` | same |
| `--shadow-4` | `0 15px 35px rgb(0 0 0 / 15%)` | same |
| `--shadow-5` | `0 24px 60px rgb(0 0 0 / 32%)` | same |
| `--shadow-soft` | `0 8px 20px rgb(0 0 0 / 8%)` | same |
| `--shadow-drop` | `0 8px 24px -8px rgb(0 0 0 / 25%)` | same |
| `--shadow-lift-sm` | `0 14px 28px -10px rgb(0 0 0 / 35%)` | same |
| `--shadow-lift-lg` | `0 24px 48px -16px rgb(0 0 0 / 35%)` | same |
| `--shadow-sheet` | `0 2px 8px -4px rgb(0 0 0 / 20%)` | same |
| `--shadow-cover` | `0 1px 2px rgb(0 0 0 / 12%), 0 6px 16px -6px rgb(0 0 0 / 25%)` | same |
| `--shadow-cover-paper` | `0 0 0 1px rgb(0 0 0 / 6%), 0 1px 2px rgb(0 0 0 / 10%), 0 6px 16px -6px rgb(0 0 0 / 20%)` | same |
| `--shadow-paper-lift` | `0 1px 2px rgb(0 0 0 / 18%), 0 18px 40px -12px rgb(0 0 0 / 45%)` | same |
| `--shadow-paper-curl` | `0 10px 18px -8px rgb(0 0 0 / 45%), inset 0 -7px 12px -7px rgb(0 0 0 / 28%)` | same |
| `--shadow-knob` | `0 0 0 1px rgb(0 0 0 / 30%), 0 1px 3px rgb(0 0 0 / 30%)` | same |
| `--shadow-knob-ring` | `0 0 0 1px rgb(0 0 0 / 30%)` | same |

## 2. Setting inputs

Settings writes these on `:root` (`cssVar` in `settings.schema.json`); the
tokens give the value before settings load.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--bg-base` | `#fafaf9` (--gray-50) | `#0f0e0d` (--gray-900) | Background setting (pushed by lib/theme.ts) |
| `--fg-base` | `#0f0e0d` (--gray-900) | `#fafaf9` (--gray-50) | Foreground setting (pushed by lib/theme.ts) |
| `--ui-font` | `var(--font-family-system)` | same | UI font setting |
| `--editor-font` | `var(--font-family-system)` | same | Editor font setting |
| `--mono-font` | `var(--font-family-mono)` | same | Code font setting |
| `--pensee-editor-font-size` | `18px` (--font-size-18) | same | Editor size setting |

## 3. Semantic tokens

Dark values on `:root`, light ones under `[data-theme="light"]`. Fills marked
`--contrast` scale with the Contrast setting.

### Grounds and fills

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--color-bg-ground` | `#fafaf9` (--bg-base) | `#0f0e0d` (--bg-base) | The page ground; the Background setting |
| `--color-bg-app` | `#f2f1f0` (--gray-100) | `#0f0e0d` (--color-bg-ground) | Window chrome: sidebar, tab strip (the window backdrop) |
| `--color-bg-canvas` | `#fafaf9` (--color-bg-ground) | `#161513` (--gray-850) | The editor card, content cards, the board surface |
| `--color-bg-raised` | `#f2f1f0` (--gray-100) | `#1c1b19` (--gray-800) | A raised grey inside a card: code blocks, tags |
| `--color-bg-popover` | `#fafaf9` (--color-bg-ground) | `#0f0e0d` (--color-bg-ground) | Opaque ground of a popover or menu (Arc `--surface-raised`) |
| `--color-bg-hover` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 16%), transparent)` | same | Row and button hover |
| `--color-bg-selected` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 26%), transparent)` | same | Selected or active row |
| `--color-bg-subtle` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 18%), transparent)` | same | Quiet fill that reads on chrome and card |
| `--color-bg-subtle-strong` | `color-mix( in srgb, var(--fg-base) calc(var(--contrast) * 36%), transparent )` | same | Stronger quiet fill (hovered button) |
| `--color-bg-input` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 20%), transparent)` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 28%), transparent)` | Text fields and selects |
| `--color-bg-card` | `transparent` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 16%), transparent)` | Floating card tint (transparent in light mode) |
| `--color-bg-tab-active` | `color-mix( in srgb, var(--fg-base) calc(var(--contrast) * 24%), transparent )` | `color-mix( in srgb, var(--fg-base) calc(var(--contrast) * 34%), transparent )` | The focused tab |
| `--color-bg-kbd` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 16%), transparent)` | same | Keyboard hint chips |
| `--color-bg-code` | `#f2f1f0` (--color-bg-raised) | `#1c1b19` (--color-bg-raised) | Code blocks and inline code |
| `--color-bg-inverse` | `#0f0e0d` (--fg-base) | `#fafaf9` (--fg-base) | Filled (primary) buttons, checked boxes, switches on |

### Text

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--color-text-primary` | `#0f0e0d` (--fg-base) | `#fafaf9` (--fg-base) | Titles, primary text; the Foreground setting |
| `--color-text-secondary` | `#33312c` (--gray-700) | `#cccac6` (--gray-300) | Body copy, editor text, secondary labels |
| `--color-text-muted` | `#706d66` (--gray-500) | `#8f8b85` (--gray-400) | Supporting text, timestamps, unchecked task box |
| `--color-text-faint` | `#8f8b85` (--gray-400) | `#706d66` (--gray-500) | Icons, placeholders (non-text contrast) |
| `--color-text-inverse` | `#fafaf9` (--bg-base) | `#0f0e0d` (--bg-base) | Text on `--color-bg-inverse` |
| `--color-text-error` | `#b23a2e` (--hue-red-deep) | `#e57b6c` (--hue-red-pale) | Error text and outlines, danger menu items |

### Lines, focus, selection, links

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--color-border-default` | `#cccac6` (--gray-300) | `#33312c` (--gray-700) | Hairlines that divide (decorative) |
| `--color-border-subtle` | `color-mix(in srgb, var(--color-border-default) 60%, transparent)` | same | Softer hairline: cards, glass panel edge |
| `--color-border-strong` | `#8f8b85` (--gray-400) | `#706d66` (--gray-500) | The edge of a control (3:1) |
| `--color-border-floating` | `color-mix( in srgb, var(--fg-base) calc(var(--contrast) * 45%), transparent )` | same | Half-pixel outline of a floating layer |
| `--color-focus` | `#0f0e0d` (--fg-base) | `#fafaf9` (--fg-base) | Keyboard focus ring (2px) |
| `--color-selection` | `color-mix(in srgb, var(--fg-base) 12%, transparent)` | same | Selected text |
| `--color-scrollbar` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 58%), transparent)` | same | Scrollbar thumb |
| `--color-blockquote` | `color-mix(in srgb, var(--fg-base) calc(var(--contrast) * 58%), transparent)` | same | Blockquote rule |
| `--color-link` | `#0f0e0d` (--fg-base) | `#fafaf9` (--fg-base) | Links (told apart by underline) |
| `--color-link-underline` | `color-mix(in srgb, var(--color-link) 50%, transparent)` | same | Link underline |

### Status, dots, tags

Colour sits in a small mark (a dot, a stroke, a tint), never in text.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--color-status-danger` | `#cc4b3c` (--hue-red) | same | Danger mark (Arc `--danger`) |
| `--color-status-warning` | `#c46a22` (--hue-orange) | same | Warning mark (Arc `--warning`) |
| `--color-status-success` | `#3f8f5a` (--hue-green) | same | Success mark (Arc `--success`) |
| `--color-status-info` | `#3c72c9` (--hue-blue) | same | Info mark |
| `--color-dot-red` | `#cc4b3c` (--hue-red) | same |  |
| `--color-dot-orange` | `#c46a22` (--hue-orange) | same |  |
| `--color-dot-yellow` | `#a8820a` (--hue-yellow) | same |  |
| `--color-dot-green` | `#3f8f5a` (--hue-green) | same |  |
| `--color-dot-blue` | `#3c72c9` (--hue-blue) | same |  |
| `--color-dot-purple` | `#8a5cc7` (--hue-purple) | same |  |
| `--color-dot-pink` | `#c4508a` (--hue-pink) | same |  |
| `--color-dot-gray` | `#85817b` (--hue-gray) | same |  |
| `--color-dot-tint` | `10%` | `16%` | Share of a dot in a tinted ground (sticky paper) |
| `--color-tag-bg` | `#f2f1f0` (--color-bg-raised) | `#1c1b19` (--color-bg-raised) | Tag and status pill ground |
| `--color-tag-text` | `#33312c` (--color-text-secondary) | `#cccac6` (--color-text-secondary) | Tag and status pill text |

### Pictures and physical things

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--color-scrim` | `#000000` (--black) | same | Scrims over pictures and video, modal backdrop on boards |
| `--color-on-scrim` | `#ffffff` (--white) | same | Text and icons on a scrim |
| `--color-shade` | `#000000` (--black) | same | Drawn shading (paper curl, book spine) |
| `--color-highlight` | `#ffffff` (--white) | same | Drawn light (paper, glows, colour-wheel knobs) |
| `--color-page` | `#ffffff` (--white) | same | A PDF page or an embedded web page (white in both themes) |
| `--color-letterbox` | `#000000` (--black) | same | Video letterbox |
| `--color-cover-paper-bg` | `#fbfaf6` (--cover-paper-bg) | same |  |
| `--color-cover-paper-fg` | `#23211d` (--cover-paper-fg) | same |  |
| `--color-cover-paper-venue` | `#8a8578` (--cover-paper-venue) | same |  |
| `--color-cover-paper-authors` | `#5f5b52` (--cover-paper-authors) | same |  |
| `--color-cover-paper-rule` | `#dcd8cd` (--cover-paper-rule) | same |  |
| `--color-cover-paper-rule-soft` | `#e9e6dd` (--cover-paper-rule-soft) | same |  |

### Fonts

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--font-ui` | `var(--ui-font)` | same | Chrome text; the UI font setting |
| `--font-editor` | `var(--editor-font)` | same | Note text; the editor font setting |
| `--font-mono` | `var(--mono-font)` | same | Code; the code font setting (also Tailwind `font-mono`) |
| `--font-title` | `var(--font-family-didone)` | same | Page title, H1–H2, space titles (Bodoni Moda, regular weight) |
| `--font-book-serif` | `var(--font-family-book-serif)` | same | Library book covers |
| `--font-glyph-serif` | `var(--font-family-glyph-serif)` | same | The quote glyph in the block menu |

### Type sizes

The chrome uses caption, label and ui; nothing in the UI goes below caption
([SPECs/type-scale-spec.md](../SPECs/type-scale-spec.md)). The `cover-*` sizes
are drawn on Library covers and may.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--font-size-caption` | `13px` (--font-size-13) | same | Counts, timestamps, badges, hints (Tailwind `text-caption`) |
| `--font-size-label` | `14px` (--font-size-14) | same | Sidebar items, tabs, buttons, menu items (`text-label`) |
| `--font-size-ui` | `15px` (--font-size-15) | same | Running text in the chrome (`text-ui`) |
| `--font-size-heading-sm` | `16px` (--font-size-16) | same | Small headings: tweet author, mermaid title |
| `--font-size-editor` | `18px` (--pensee-editor-font-size) | same | Note text; the editor size setting |
| `--font-size-title-sm` | `20px` (--font-size-20) | same | Composer title |
| `--font-size-title-md` | `21px` (--font-size-21) | same | Book reader title |
| `--font-size-glyph` | `24px` (--font-size-24) | same | Block-menu glyph preview |
| `--font-size-title-lg` | `26px` (--font-size-26) | same | Space title |
| `--font-size-cover-micro` | `8px` (--font-size-8) | same |  |
| `--font-size-cover-fine` | `9px` (--font-size-9) | same |  |
| `--font-size-cover-small` | `13px` (--font-size-13) | same |  |
| `--font-size-cover-text` | `14px` (--font-size-14) | same |  |
| `--font-size-cover-title` | `16px` (--font-size-16) | same |  |
| `--font-size-cover-title-lg` | `17px` (--font-size-17) | same |  |
| `--font-size-cover-quote` | `18px` (--font-size-18) | same |  |
| `--font-size-cover-display` | `22px` (--font-size-22) | same |  |
| `--font-size-cover-initial` | `72px` (--font-size-72) | same |  |

### Radii

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--radius-hairline` | `2px` (--radius-2) | same | Paper, thin bars |
| `--radius-button` | `4px` (--radius-4) | same | Filled buttons, small chips |
| `--radius-chip` | `6px` (--radius-6) | same | Tags, chips, small controls |
| `--radius-field` | `8px` (--radius-8) | same | Inputs, menu rows, tabs |
| `--radius-menu` | `10px` (--radius-10) | same | Menus, board cards, video |
| `--radius-card` | `12px` (--radius-12) | same | Cards, popovers |
| `--radius-sheet` | `16px` (--radius-16) | same | Sheets |
| `--radius-window` | `20px` (--radius-20) | same | The editor glass panel, floating surfaces |
| `--radius-pill` | `999px` (--radius-round) | same | Pills, round buttons |

### Shadows

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--shadow-card` | `var(--shadow-1)` | same | Small floating bars (toolbars, reader controls) |
| `--shadow-popover` | `var(--shadow-2)` | same | Menus and popovers |
| `--shadow-overlay` | `var(--shadow-3)` | same | Banners, video |
| `--shadow-surface` | `var(--shadow-4)` | same | Floating surface card (command palette) |
| `--shadow-dialog` | `var(--shadow-5)` | same | Dialogs |
| `--shadow-picker` | `var(--shadow-soft)` | same | Compact picker |
| `--shadow-menu` | `var(--shadow-drop)` | same | Board context menu |
| `--shadow-lift` | `var(--shadow-lift-lg)` | same | A dragged tab column |
| `--shadow-lift-hover` | `var(--shadow-lift-sm)` | same | A Library cover lifted on hover |
| `--shadow-page` | `var(--shadow-sheet)` | same | A PDF page |
| `--shadow-book-cover` | `var(--shadow-cover)` | same | A Library cover |
| `--shadow-paper-cover` | `var(--shadow-cover-paper)` | same | A Library paper cover |
| `--shadow-drag-paper` | `var(--shadow-paper-lift)` | same | A dragged block, as paper |
| `--shadow-drag-curl` | `var(--shadow-paper-curl)` | same | A dragged block crumpled |
| `--shadow-swatch-knob` | `var(--shadow-knob)` | same | Colour-wheel knob |
| `--shadow-swatch-ring` | `var(--shadow-knob-ring)` | same | Colour-slider knob |

### Boards

The keys are the ones boards store, so a value changed here re-tints every
board and every exported `.board.svg`. `*-soft` fills mix 22% of the stroke
into the surface in OKLab; stickies mix `--wr-board-sticky-wash` into the
paper.

| Token | Light | Dark |
| --- | --- | --- |
| `--wr-board-ink` | `#0f0e0d` (--color-text-primary) | `#fafaf9` (--color-text-primary) |
| `--wr-board-muted` | `#706d66` (--color-text-muted) | `#8f8b85` (--color-text-muted) |
| `--wr-board-accent` | `#0f0e0d` (--color-text-primary) | `#fafaf9` (--color-text-primary) |
| `--wr-board-red` | `#cc4b3c` (--color-dot-red) | same |
| `--wr-board-orange` | `#c46a22` (--color-dot-orange) | same |
| `--wr-board-yellow` | `#a8820a` (--color-dot-yellow) | same |
| `--wr-board-green` | `#3f8f5a` (--color-dot-green) | same |
| `--wr-board-blue` | `#3c72c9` (--color-dot-blue) | same |
| `--wr-board-purple` | `#8a5cc7` (--color-dot-purple) | same |
| `--wr-board-pink` | `#c4508a` (--color-dot-pink) | same |
| `--wr-board-ink-soft` | `color-mix(in oklab, var(--wr-board-ink) 22%, var(--wr-board-surface))` | same |
| `--wr-board-muted-soft` | `color-mix(in oklab, var(--wr-board-muted) 22%, var(--wr-board-surface))` | same |
| `--wr-board-red-soft` | `color-mix(in oklab, var(--wr-board-red) 22%, var(--wr-board-surface))` | same |
| `--wr-board-orange-soft` | `color-mix(in oklab, var(--wr-board-orange) 22%, var(--wr-board-surface))` | same |
| `--wr-board-yellow-soft` | `color-mix(in oklab, var(--wr-board-yellow) 22%, var(--wr-board-surface))` | same |
| `--wr-board-green-soft` | `color-mix(in oklab, var(--wr-board-green) 22%, var(--wr-board-surface))` | same |
| `--wr-board-accent-soft` | `color-mix(in oklab, var(--wr-board-accent) 22%, var(--wr-board-surface))` | same |
| `--wr-board-blue-soft` | `color-mix(in oklab, var(--wr-board-blue) 22%, var(--wr-board-surface))` | same |
| `--wr-board-purple-soft` | `color-mix(in oklab, var(--wr-board-purple) 22%, var(--wr-board-surface))` | same |
| `--wr-board-pink-soft` | `color-mix(in oklab, var(--wr-board-pink) 22%, var(--wr-board-surface))` | same |
| `--wr-board-flip` | `0` | `1` |
| `--wr-board-dot` | `color-mix(in srgb, var(--fg-base) 16%, transparent)` | same |
| `--wr-board-surface` | `#fafaf9` (--color-bg-canvas) | `#161513` (--color-bg-canvas) |
| `--wr-board-frame-bg` | `color-mix(in srgb, var(--fg-base) 3%, transparent)` | same |
| `--wr-board-frame-edge` | `color-mix(in srgb, var(--fg-base) 14%, transparent)` | same |
| `--wr-board-sticky-paper` | `#f2f1f0` (--gray-100) | `#1c1b19` (--gray-800) |
| `--wr-board-sticky-wash` | `10%` (--color-dot-tint) | `16%` (--color-dot-tint) |
| `--wr-board-sticky-pale` | `calc(var(--wr-board-sticky-wash) * 0.6)` | same |
| `--wr-board-sticky-yellow` | `color-mix( in oklab, var(--wr-board-yellow) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-orange` | `color-mix( in oklab, var(--wr-board-orange) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-mint` | `color-mix( in oklab, var(--wr-board-green) var(--wr-board-sticky-pale), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-green` | `color-mix( in oklab, var(--wr-board-green) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-sky` | `color-mix( in oklab, var(--wr-board-blue) var(--wr-board-sticky-pale), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-lavender` | `color-mix( in oklab, var(--wr-board-purple) var(--wr-board-sticky-pale), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-violet` | `color-mix( in oklab, var(--wr-board-purple) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-pink` | `color-mix( in oklab, var(--wr-board-pink) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-rose` | `color-mix( in oklab, var(--wr-board-red) var(--wr-board-sticky-wash), var(--wr-board-sticky-paper) )` | same |
| `--wr-board-sticky-ink` | `#0f0e0d` (--color-text-primary) | `#fafaf9` (--color-text-primary) |
| `--wr-board-sticky-edge` | `color-mix(in srgb, var(--fg-base) 8%, transparent)` | same |

## 4. Legacy names

| Legacy name | Points at |
| --- | --- |
| `--accent` | `var(--color-text-primary)` |
| `--accent-solid` | `var(--color-bg-inverse)` |
| `--on-accent` | `var(--color-text-inverse)` |
| `--display-font` | `var(--font-title)` |
| `--text-primary` | `var(--color-text-primary)` |
| `--text-secondary` | `var(--color-text-secondary)` |
| `--text-muted` | `var(--color-text-muted)` |
| `--text-icon-muted` | `var(--color-text-faint)` |
| `--text-error` | `var(--color-text-error)` |
| `--border-color` | `var(--color-border-default)` |
| `--line-subtle` | `var(--color-border-default)` |
| `--line-subtler` | `var(--color-border-subtle)` |
| `--focus-border` | `var(--color-focus)` |
| `--surface-primary` | `var(--color-bg-ground)` |
| `--surface-card` | `var(--color-bg-card)` |
| `--surface-subtle` | `var(--color-bg-subtle)` |
| `--surface-subtle-strong` | `var(--color-bg-subtle-strong)` |
| `--surface-input` | `var(--color-bg-input)` |
| `--surface-selected` | `var(--color-bg-selected)` |
| `--item-hover-bg` | `var(--color-bg-hover)` |
| `--item-active-bg` | `var(--color-bg-selected)` |
| `--tab-active-bg` | `var(--color-bg-tab-active)` |
| `--code-bg` | `var(--color-bg-code)` |
| `--kbd-bg` | `var(--color-bg-kbd)` |
| `--scrollbar-thumb` | `var(--color-scrollbar)` |
| `--blockquote-border` | `var(--color-blockquote)` |
| `--link-color` | `var(--color-link)` |
| `--link-underline` | `var(--color-link-underline)` |
| `--editor-selection-bg` | `var(--color-selection)` |
