# Type scale

Status: implemented

Pensée is for people who write, and its chrome was set like a dense developer
tool: 42 places at 12px, 19 at 11px, four at 10px, five at 9px and one at
10.5px, with a 16px editor body. This raises the whole scale so the app reads
comfortably, with one floor and three sizes for the chrome, and a larger
editor default. Colours are out of scope (a separate change).

## The rule

**Nothing in the app UI is below 13px.** Chrome text takes one of three sizes:

| Token            | Size | Line height | For                                                                                                                                                  |
| ---------------- | ---- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--text-caption` | 13px | 1.4         | Counts, timestamps, badges, kbd hints, section labels (tracked caps), chips, tooltips' small print, secondary lines under a title, the status bar    |
| `--text-label`   | 14px | 1.4         | Sidebar items, tabs, buttons (including tracked-caps buttons), segmented controls, menu items, settings row descriptions, card titles                      |
| `--text-ui`      | 15px | 1.5         | Running text in the chrome: search and text fields, palette items, settings row titles, chat messages, empty-state lines, banners, status messages |

The tokens live once, in `App.css`'s `@theme static` block. Plain CSS reads
`var(--text-caption)` and friends; Tailwind gets `text-caption`, `text-label`
and `text-ui` from the same block. `--text-xs` is redefined there as the
caption size, so Tailwind's `text-xs` and every vendored Arc rule that uses
`var(--text-xs)` (badges, the kanban toolbar, the dock's labels, the
calendar's weekday row) can't drop below the floor either. Arc's
`--text-sm` is already 14px.

A new chrome size is a new token, not a new literal. Literal pixel sizes stay
only for glyphs drawn as text (the tab close ×, the block menu's `T`/`{ }`/`”`
tiles, the book reader's small and large `A`, the mermaid zoom glyphs),
display type (space titles, the composer title) and user content.

## Editor defaults

| Setting                | Was   | Now   |
| ---------------------- | ----- | ----- |
| `editor.font-size`     | 16    | 18    |
| `editor.line-height`   | 1.8   | 1.7   |
| `editor.content-width` | 734px | 680px |

680px holds about 68 characters of SF Pro at 18px, a comfortable measure for
prose. The content-width slider's range (480–1600) is unchanged. Only the
defaults change: a config that stores its own value keeps it (the settings
file is sparse, so anyone who never touched these gets the new ones).

The pre-hydration fallbacks follow the schema: `--pensee-editor-*` in
`App.css`, the `var(--pensee-editor-*, …)` fallbacks in `prosemark-theme.css`,
`columns.css`, `syntaxHighlighting.ts`, `codeFenceExtension.ts` and the book
reader, and the numeric fallbacks in `table-decorations.ts` and
`columns-decorations.ts`.

Headings already scale from the body (`1.6em`/`1.4em`/`1.2em` in
`HEADING_FONT_SIZES`), and the page title is `2 ×` the body size, so they grow
with it: 28.8 / 25.2 / 21.6px and a 36px title at the new default. Their
family and weight are unchanged. A rendered caption band's headings
(`.wr-band h1…h6`) now take the editor line height instead of a hard-coded
1.8, so the band and its source still land on the same box. Code in the editor
stays relative to the body.

## Not changed

- **User content sizes**: board text sizes, the book reader's text-size
  ladder, the font-size setting's values, the board frame label (drawn in
  board coordinates, scaled with zoom), exported `.board.svg` content.
- **Library cover art** (`spaces.module.css`: book bylines, paper venue and
  authors, course eyebrows, tweet avatar initials, 8–9px). These are
  miniature printed covers on 128–220px tiles; their text is part of the
  picture and repeats the title and author shown at readable size under the
  cover. Raising them to 13px would wrap and break the covers.
- **The sidebar Search button** (`sidebar/file-browser.tsx`, 13px label and an
  11px ⌘F hint) and the sidebar wordmark (`sidebar/index.tsx`): another
  change owns that row. The ⌘F hint should become `text-caption` there.
- **Unused vendored Arc sizes**: the kanban avatar face (10px; Projects has no
  assignees) and the dock's count badge (11px; the board dock shows none).
  Arc's small badge (11px) is overridden for project tags in
  `project-views.module.css`.

## Fit

Short text that sits beside other things (counts, dates, status words,
buttons, tab labels) keeps to one line (`white-space: nowrap`, and
`flex-shrink: 0` where it sits in a flex row). Where a control grew:

- Block menu confirm buttons, board panel text buttons, Library cover-bar
  buttons and the timeline's Today button: 26/24px → 28px.
- The backlink count pill: 16px → 18px tall, 20px minimum width.
- Library item subtitle: 16px → 18px minimum height.
- Composer type chip: 124px → 132px minimum (Podcast at 14px).
- Find-in-page: the field's right padding 64px → 88px so "No matches" never
  sits on the query; the board's find count 64px → 72px.
- The agent composer's line box 21px → 22px (and its six-line cap with it).

Fixed-height rows (sidebar 32px, tabs, settings controls 36px, the link and
HTML embed headers whose heights `link-preview.ts` and
`html-embed-widget.ts` hard-code) keep their heights; the larger text fits
inside them with room to spare. The video Pin row stays 24px so its band's
height doesn't move.


A settings row's title is `text-ui` (15px, medium) and its description
`text-label` (14px, muted): the title leads, the description never outsizes it.
