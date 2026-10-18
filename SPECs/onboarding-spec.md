# Onboarding (first run)

## Goal

Someone who just downloaded Pensée sees their own material inside a note
and their own words next to Pensée's within a minute. That means one real
loop on something they are learning, not a tour of features.

Decided from the prototype https://claude.ai/artifact/AUjNcg7kaH8dfENCfku7W5
(2026-10-16): **Sequence**, with a "What are you learning?" step.

## Built (2026-10-18)

The app follows the prototype's flow (with its _Mixed_ scenario: whatever
the Mac really has), with these differences, each because the real app
works that way:

- **When it shows.** On a launch with no folder open and `onboarding.done`
  unset (`preferences.json`). Existing users always reopen a folder, so they
  never see it. A run quit midway resumes on the AI screen. ⌘P → **Show
  Onboarding** plays it from the AI screen.
- **Screen 1** reads Obsidian's own vault list
  (`~/Library/Application Support/obsidian/obsidian.json`) and counts each
  vault's notes (`obsidian_vaults`). **Start a new folder in Documents** makes
  `~/Documents/Pensée`.
- **Screen 2** offers Claude Code only: **Use Claude Code** when signed in,
  **Sign in to Claude Code** (the existing sign-in popup) when signed out, or
  its install line with **Check again** when it isn't installed. Codex and
  Gemini CLI show under **Other options** as _Coming soon_ until the pen runs
  on them (SPECs/ai-providers-spec.md).
- **Screen 3's samples are real notes**, written into `Pensée samples/` in the
  vault (the copy says so, and that they can be deleted), because only a
  note in the vault gets the real editor, player and pen. The book is _The
  Elements of Style_ (Strunk, public domain), downloaded from Project
  Gutenberg and imported beside its page, not _Skip the Line_.
- **The pin key is ⌘S**, the app's own, everywhere (guide and carousel); the
  Library's key is ⌘G then L.
- **The guide** reads the loop's progress from the note itself: a `^yt-` pin
  or `^bk-` highlight, then the pen's ids (`^ai-p`/`^ai-n` for Check,
  `^ai-e` for Connect, `^ai-s` then `^ai-r` for Answer). On a pin sample, the
  first click in the note types the sample's line for the writer.
- **The carousel** is `feature-scenes.ts`: the prototype's scenes, drawn
  with the app's tokens. Its book covers ship in
  `src/components/onboarding/assets/` (small, for the grid only).

Journeys: docs/qa/user-journeys.md § Onboarding — ONB.

## Flow

Four screens. Each one asks one question, centred, with stacked buttons and
page dots. The likely choice is filled and runs on ↵. ↑ ↓ (or Tab) move the
filled choice, and the screen shows those keys under its choices. Esc goes
back on screens 1–2.

1. **Your notes.** Shows the ¶ mark and _Thinking, made by writing._ The
   buttons are:
   - **Open <vault>** for each Obsidian vault in Obsidian's own vault list.
     The first is filled, and each shows its note count.
   - **Open another folder… ⌘O**
   - **Start a new folder** (`~/Documents/Pensée`), as quiet text.

   An Obsidian vault opens as it is.
2. **Which AI should Pensée use?** Under it: _It runs on the plan you already
   have. Only the lines you ask about are sent._
   - Only CLIs found on this Mac get a button. A signed-in one reads
     **Use <CLI>** (filled when chosen). A signed-out one reads **Sign in to
     <CLI>**, and while it waits it shows _Finish signing in in your browser_
     with Esc to cancel.
   - **Other options** opens the CLIs that aren't installed, each with its
     install command and a copy button. It also has **Another CLI**, a
     command field for DeepSeek or a local model.
   - **Skip for now** sits beside it. With nothing installed, the options
     show open and **Skip for now** is the ↵ action.
   - The CLIs themselves are specced in the multi-provider work.
3. **What are you learning right now?** _Pick one to try. Each becomes a
   note you can write around._ Four example buttons, no link field. Each
   opens a practice note marked _a sample, not saved to <vault>_, so nothing
   is written into the vault. The writer's own sources come in later, from
   the Library.

   | Sample | Capture move | Then ⌘. | Result |
   | --- | --- | --- | --- |
   | **Huberman on dopamine** (YouTube: Huberman Lab #39, "Controlling Your Dopamine For Motivation, Focus & Satisfaction", opened at Tool 7, 1:38) | A click on the empty first line and Pensée types the sample's line into it (_Rewarding yourself after studying can make studying feel worse._). The guide then says _Now ⌘P pins it to <time>_, so the writer only clicks and presses ⌘P. Typing over it stops the auto-write. After that, ↵ adds a line, ↑ ↓ or a click moves between them, and ⌘P pins the line you're on. Chapters show beside the player | `@` Check | For and Against, each with a real paper pill (Lepper 1973; Cameron 1994); _Your call_ line |
   | **Atul Gawande on writing** (How I Write with David Perell, "How to Use Writing to Improve Your Thinking") | Same: a click writes _Why do most learning tools fail?_, then ⌘P pins it to the episode's time. ⌘. runs on whichever line you're on | `!` Answer | Sealed until the writer's take; then **Combine into one list `Tab`** |
   | **Skip the Line** (James Altucher, "Idea Calculus") | Highlight the line about idea sex: select it, click it, or press H. It lands as a bullet | `[[` Connect | Echoes from other notes (Example, Supports, Another angle) |
   | Just write | A sample question | `!` Answer | Same as the podcast |

   The samples are real:
   - **YouTube:** the Huberman Lab video plays in the note through YouTube's
     player, starting at 1:38:02, and ⌘P reads the player's own time.
   - **Podcast:** Andy Matuschak on the Dwarkesh Podcast ("The reason most
     learning tools fail") streams from its RSS enclosure, and the card shows
     the show's artwork.
   - **Book:** the writer can open their own EPUB of Skip the Line. Pensée
     finds the paragraph about idea sex and shows it with its neighbours.
     Until then the page shows stand-in text.

   The choices on this screen lead with the medium (YouTube, Podcast, Book,
   Just write) and name the sample quietly on the right. Their icons are
   Phosphor regular. The rest of the app uses lucide: decide which set wins
   before building.


   A guide pill at the bottom gives one instruction at a time, with its keys,
   and counts the steps (_1 of 3_). Its only exit during the loop is a quiet
   **Skip** text button. When the loop is done it says what just happened
   (_That's Pensée: your take first, then its answer._) and offers
   **Continue ↵**. That leads to the next screen; it never leaves the flow.
   With no AI connected, the loop runs as a preview, and the guide says so.
4. **There's more when you need it.** A features carousel, laid out like
   Arc's carousel (uiarc.dev/components/carousel). One slide sits in the
   centre, with its neighbours peeking in smaller and dimmer. Under it, the
   caption has a title and one line on the left and the feature's keys on the
   right. Pill indicators and arrows sit below.

   **Each slide is a short animated demo** of the real UI, drawn in the app's
   own type and colours. It plays once when its slide becomes active, and
   **↻ Replay** reruns it. The keys pressed show in a dark key bar at the
   bottom, each key pressing down in turn, with what it does beside it. A
   cursor moves to whatever is clicked or hovered.
   - **See every tab at once** (Pinch), the first slide: four tabs are open
     and one fills the window. Two fingertips pinch in, and every tab sits
     side by side as its own column (SPECs/tab-columns-spec.md). A
     two-finger swipe scrolls the columns. Pinching out on _One idea per
     note_ shows just that tab. The switch is instant, as in the app: the
     fingers are the motion. The key bar names each gesture (Pinch in,
     Swipe, Pinch out).
   - **Map the essay before you write it** (`/board`): typing `/board` ↵
     turns the note into a board of blue rounded cards. Two loose cards are
     dragged, one after the other, near a card and let go. Each docks with
     the board's Glow + Ping (SPECs/board-docking-glow-spec.md, drawn as
     `board-spark.ts` draws it). While in reach, the card's imprint sits in
     its slot and the lit arrow is previewed. The halos breathe on the
     1600ms beat, and a ring goes out from the port. On drop, the card glides
     in (180ms), the arrow firms up, a dot runs it and the docked card flares.
     The three cards end in a row: _Why notes beat memory → One idea per
     note → Links over folders_.
   - **Find what you already wrote** (⌘ . [[): Pensée's box opens, Connect
     runs, and three echoes land. Hovering the first link opens the past note
     it came from, with the matching line marked.
   - **Check a claim against real papers** (⌘ . @): Finding papers…, then
     Reading the papers…, then For and Against with their papers. Hovering a
     paper opens its card: title, authors, journal, citations and Open paper.
   - **Turn a brain dump into a plan** (⌘ . #): five messy lines are typed
     fast, then ⌘A, ⌘ . # and ↵ turn them into an outline in your words.
     ↵ keeps it.
   - **Read a book beside its note** (⌘ L): the Library opens with real
     covers (*The Creative Act*, *How to Take Smart Notes*, *Bird by Bird*,
     *The Elements of Style*, *Building a Second Brain*, *Atomic Habits*).
     Opening *The Elements of Style* puts its page in one column and its note
     in the other. Dragging across "Vigorous writing is concise." shows the
     reader's pill, **Highlight · Define**. Highlight marks the passage, and
     the bullet lands in the note with a pin at its end. Hovering the pin
     (_III · p. 24_) flashes the passage in the book, then the writer's own
     line is typed under the bullet. The pin is new: today the app keeps a
     highlight's place as a hidden `^bk-` id with no visible marker
     (SPECs/book-reader-spec.md). Adding it is an app change. That book is public domain (Strunk, 1920: text from Project
     Gutenberg, cover scan from Wikimedia Commons), so its real page can be
     shown. The modern covers appear only in the grid.
   - **Notes pinned to the moment** (⌘ P): on the Dwarkesh Podcast episode
     with Andy Matuschak, a typed line is pinned with ⌘P twice. Each ⌘P
     lights the card's own Pin button. Clicking the first pin jumps back to
     its time.

   Both podcast cards (this slide and the practice note on screen 3) are
   the app's current player (podcast-player.css): the video frame's black
   ground, 10px radius, ring and overlay shadow, with light-on-dark text.
   Artwork sits on the left. Beside it are the title and show with back,
   play and ahead, then the timeline, then speed `< >`, volume and Pin ⌘P.

   ← → (Home, End), the arrows, the pills, a click on a neighbour, a drag,
   or a two-finger swipe on the trackpad moves the carousel. The swipe moves
   the track under the fingers, then settles on the nearest slide. The
   momentum after a swipe is ignored, so one swipe moves once. It never advances on its own. With reduced motion, each
   demo shows its end state. The slide for the feature just tried says
   _✓ You just tried this_. **Open <vault> ↵** ends the flow.

   Real screenshots of the same scenes (the e2e build on a writer's demo
   vault) are kept for the Product Hunt gallery, not for this screen.

## Rejected

- **Round 1** (2026-10-15):
  - **Guided**: a step rail plus several choices per screen.
  - **In the note**: the setup was a checklist in a Welcome note written
    into the vault.
  - **One sheet**: both choices side by side on one screen.

  All three put several decisions on one screen and explained the pen
  rather than letting the writer use it. The user: "not so elegant".
- **Round 2** (2026-10-16):
  - **Sentence**: one Bodoni sentence with inline pickers on cream.
  - **Practice**: setup chips in a banner over the blurred app.

  Sequence won: "the sequence one is great".
- **⌘. as the whole first moment.** It showed the writing half of the
  product and not the bringing-in half, which undersold it. It now ends each
  medium's loop instead of standing alone.
- **A big "Open <vault>" button inside the practice loop.** It invited
  leaving mid-sequence. Replaced by a quiet Skip; the filled button appears
  only on the last screen.
- **A tour of every feature.** Six stops would be skipped. The rest goes on
  screen 4.
- **Screen 4 as a list of six rows with keys** (2026-10-16): too much at once
  ("very overwhelming"). Replaced by the carousel, one picture at a time.
- **"The pen" in copy.** Onboarding says Pensée (2026-10-16).
- **A paste-a-link field on screen 3.** Examples only: a pasted link waits
  on a download and a transcript, and the loop is about the moves, not the
  source (2026-10-16).

## Open questions

- ~~Pinning is ⌘P here~~ Settled when built (2026-10-18): the app's ⌘S.

- **Rights to the samples.** The book covers in the carousel's Library grid
  (bundled, 300px) are shown to name the books, as the Library itself does;
  check before a public launch. Skip the Line is under copyright: the prototype
  shows stand-in text in our own words, never the book's. Shipping it as a
  sample needs the publisher's permission (or a public-domain book, as
  Pascal's _Pensées_ was). The Huberman video and Gawande episode play
  from YouTube or the podcast feed, so they need no copy, but the
  transcript and artwork come from those sources at run time.
- Whether #39 is still Huberman's most-played dopamine video: YouTube's
  counts couldn't be read when this was written.

- Do existing users see screen 2 once after an update that adds other CLIs,
  or only Settings?
- Where screen 4's list lives afterwards (a Help entry or ⌘/), so it can be
  found again.
