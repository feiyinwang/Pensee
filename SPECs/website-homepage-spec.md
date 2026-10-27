# Website homepage

Decided 2026-10-19 from a prototype with a picker (`apps/website/proto/home/`,
deleted once built). Seven directions were tried in two rounds; **Gallery** won.

## Goal

One page. Its one action is **Download**, for the computer the visitor is on:
**Download for Mac**, or **Download for Windows** on Windows. It shows every feature, and
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

- **Header.** A floating bar: a rounded card (16px corners) held 12px off the
  top and sides (8px on phones), frosted cream, with the page showing around
  it; the homepage hero slides up under it, so the painting frames it. The
  lockup on the left; on the right the section links (once a
  section has a page), then Download at the far right. On the homepage
  the header has no card while the hero is under it, only light words on the
  painting, and no Download: it takes no room then, so the
  links sit at the right edge. Once the hero's bottom edge has scrolled up
  under the header, the cream card fades in (200ms ease-out) and Download's
  column opens (200ms ease-out; 150ms back; none with reduced motion): the
  links slide left and the button fades in on their right. The page never
  shows two Download buttons at once.
- **Look.** Old-fashioned, like the app's What's new card: public-domain
  paintings of people reading, writing and thinking, each credited (artist,
  title, year, museum). Bodoni Moda for display, the system sans for text, the
  app's warm neutrals (`#f4f2ee` page, `#fbfaf8` cards, `#0f0e0d` text).
- **Hero.** Rembrandt's _Philosopher in Meditation_ fills the screen under
  the header. The words sit on the dark stair on the right so the philosopher
  stays in view. On a phone the painting runs edge to edge on top and fades to
  black, and the words follow below it. Under the headline _Thinking, made by
  writing._ comes the README's first paragraph, with "neurodivergent" added.
  Every painting (hero, rooms, closing) hangs as cloth
  (`components/Cloth.tsx`, mounted by `Painting`); the demo GIFs and book
  covers stay still. Each rests still, and a
  mouse stroke across it sends a broad wave (21px folds, 290px reach) that
  settles back flat quickly.
  No wind, so it never moves on its own and the loop stops when calm; reduced
  motion and browsers without WebGL2 get the still painting.
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
- **Talk.** The first section under the hero, before the rooms (the
  hero's _See what it does_ goes to it): one section with one large demo the
  visitor plays (`components/TalkDemo.tsx`, the talk in `src/talk-script.ts`).
  Decided 2026-10-27 from a picker (`apps/desktop/proto/voice-section/`,
  deleted once built); see _Talk section_ below.
- **Closing.** Hammershøi's interior fills the screen: _Start writing what you
  think._, the download button, the brew line with **Copy** (hidden on Windows:
  Homebrew is the Mac's), and the honest fine print (Claude Code for the pen;
  not notarized on the Mac, not signed on Windows yet).
- **Download.** The button links to
  `releases/latest/download/Pensee-arm64.zip`, so the browser gets the newest
  zip directly. `scripts/release.sh` uploads the zip under that fixed name. On
  a Windows visitor's screen (`src/visitor-os.ts`; pages are prerendered as
  Mac, the button switches as the page hydrates) it reads **Download for
  Windows** and links to `releases/latest/download/Pensee-windows-x64-setup.exe`,
  which `.github/workflows/release-windows.yml` attaches to each release. A
  Windows visitor is offered only Windows: the line under the button reads
  _Free and open source · Windows 10 and 11_, the brew line is hidden, and the
  fine print speaks of the installer. Everyone else sees the Mac button, and
  the line under it names both systems, each a link to its own download, so a
  Mac visitor can fetch the Windows build for another computer.

## Talk section

**Try it** won. The section shows Talk (voice → pictures) by letting the
visitor run a real one.

- **Head.** Like a room head without a painting: a **New** tag (the record
  dot's red deepened to `--hue-red-deep` for white text; gold stays the
  beta's), the eyebrow _Talk to a note_, _Talk it through. Watch it take shape._, and one paragraph. The copy
  says Whisper writes the transcript on the Mac and nothing more: the topics
  are drawn by Claude, so the page never claims nothing leaves the computer.
- **The demo.** A card holding the app's dark look: a note (_Lisbon?_) with
  the talk box over it and the recording pill under it. One 48-second talk
  about taking a job in Lisbon, written the way people talk ("It's, yeah,
  basically the same"), in three topics: _Lisbon or Berlin_ (mind map, or a
  matrix), _The move_ (steps, or a timeline), _Rent_ (a bar chart whose
  average follows its bars). Every piece of a picture carries the id of the
  line that said it, so a redraw keeps what's been heard.
- **At rest it shows the finished talk.** Nothing plays on load or on scroll
  (marketing motion rule: motion follows the visitor). Everything works at
  rest: the topic tabs, the picture buttons, **Stop**.
- **Play the talk** plays it from the start: under the card, the line being
  said lights word by word (Bodoni, 200ms a word); the pill's red trace rises
  while words come and goes flat between lines; each line's pieces appear when
  it ends, 110ms apart (opacity + scale 0.96 → 1, 220ms ease-out). "Okay,
  next" shows **New topic?**, and the tab opens three words later, as in the
  app. **next topic** opens the next tab early.
- **Stop** shows the note the app writes: the player, a two-sentence
  conclusion, and each topic as a board in the picture the visitor last chose.
- Reduced motion: the words and pieces still come in order (the visitor asked
  for it), with no fades, scales or moving trace.
- Phones: the pictures shrink with their box (`min(1em, 2.35cqw)`) so no
  label is cut off; they read small there.

Rejected:

- **Room** (a fifth room with four looping demo cards): fits the page, but
  splits one story into four small pieces, and it's the least memorable.
- **Spoken** (full-bleed Wright of Derby, three spoken quotes lighting up
  beside the box): striking, but the box covers the painting's lit centre and
  it adds a third full-screen painting to the page.
- **Afterwards** (drag between the raw transcript and the finished note):
  sells the result, but never shows the pictures appearing while you talk,
  which is the feature.

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
