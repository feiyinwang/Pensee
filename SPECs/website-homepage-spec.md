# Website homepage

Decided 2026-10-19 from a prototype with a picker (`apps/website/proto/home/`,
deleted once built). Seven directions were tried in two rounds; **Gallery** won.

## Goal

One page. Its one action is **Download for Mac**. It shows every feature, and
the first screen speaks to the person Pensée is made for, in the README's own
voice.

## Who comes, and what they need

| Who                                                                              | Why they come                      | What the page must give them                           |
| -------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| An Obsidian note-taker who collects more than they digest (neurodivergent, ADHD) | A friend or a post links it        | In five seconds, that it's for them; then what it does |
| A writer wary of AI                                                              | Expects another ghostwriter        | That the AI leaves the conclusion to them              |
| A developer from GitHub                                                          | Wants to install from the terminal | The brew line, copyable                                |
| Anyone convinced, anywhere on the page                                           | Wants to start                     | A download button always in reach                      |

## Gallery, as built

- **Look.** Old-fashioned, like the app's What's new card: public-domain
  paintings of people reading, writing and thinking, each credited (artist,
  title, year, museum). Bodoni Moda for display, the system sans for text, the
  app's warm neutrals (`#f4f2ee` page, `#fbfaf8` cards, `#0f0e0d` text).
- **Hero.** Rembrandt's _Philosopher in Meditation_ fills the screen under
  the header. The words sit on the dark stair on the right so the philosopher
  stays in view. On a phone the painting runs edge to edge on top and fades to
  black, and the words follow below it. Under the headline _Thinking, made by
  writing._ comes the README's first paragraph, with "neurodivergent" added.
- **Beta.** Said once: a gold tag (`#e9b44c`, the window light in the
  Rembrandt) inside the hero's download button. Nowhere else.
- **Rooms.** Four groups of features, each opening with a painting and a short
  intro: I Think with a second pen (Caravaggio), II Collect into notes
  (Fragonard), III Arrange your thinking (Vermeer), IV Keep it yours
  (Antonello da Messina). The README's second and third paragraphs are spread
  across these intros.
- **Feature cards.** 15 features, each a card with its demo, its shortcut as
  keycaps, a title naming the payoff, and one or two sentences. Seven demos are
  the README GIFs (the three pen GIFs zoomed 1.67× onto the note, x 335–1055 and y 75–525 of 1200×750, so their writing is readable at card size; the book GIF zoomed 1.43× onto the note and the start of the book page, so the Highlight pill and the line landing in the note are readable); two are the app's own onboarding scenes, played from `apps/desktop/src/components/onboarding/feature-scenes.ts` with the app's tokens and onboarding styles (the brain dump: the key bar shows ⌘ . then # then ↵ and the real pen box opens; the pinch between one tab and all tabs), so the site and onboarding can't drift; six are small code-built scenes in the app's dark look (Projects drawn as the app's board: a lane per status, its tag in the status colour, To-do gray, Ongoing blue, Done green)
  that play when scrolled into view and repeat every 5 seconds while on screen, like the GIFs (static under reduced motion). Cards
  rest near flat (hairline ring, 1px shadow); a deeper shadow fades in on hover
  (160ms, opacity only).
- **Closing.** Hammershøi's interior fills the screen: _Start writing what you
  think._, the download button, the brew line with **Copy**, and the honest fine
  print (Claude Code for the pen; not notarized yet).
- **Download.** The button links to
  `releases/latest/download/Pensee-arm64.zip`, so the browser gets the newest
  zip directly. `scripts/release.sh` uploads the zip under that fixed name.

## Rejected, and why

- **Today's page** (sticky headline, uncaptioned videos): no download, the pen
  never named, features out of date.
- **Manuscript** (an essay on cream paper), **Keys** (one demo stage driven by
  the app's shortcuts), **Index** (a dense catalogue): first round, before the
  old-fashioned direction. Not old-fashioned.
- **Folio** (an antique book with plates and drop caps) and **Gazette** (a
  19th-century broadsheet): old-fashioned, but Folio is slow to scan and
  Gazette's jokey framing undercuts a serious tool.
- **Gallery with the hero and closing in cards**: the paintings should fill
  the screen.
- **Beta on every button and above the headline**: one place is enough.
- **A standalone statement block under the hero**: too long; its ideas went
  into the room intros.

## Assets

The paintings live in `apps/website/public/paintings/` as WebP, downloaded
from Wikimedia Commons (all public domain). The GIFs and book covers are
imported from where they already live (`assets/readme/`,
`apps/desktop/src/components/onboarding/assets/`) so there is one copy of each.
