# In-context tips

## Goal

People learn a feature by using it, in the place it lives, the first time
they get there. Onboarding's features carousel (screen 4) is a tour, and the
onboarding spec already rejected tours because they get skipped. So each
feature gets one tip that shows up when you reach its page or its moment, asks
you to do one thing there for real, and goes away once you've done it.

Screen 3's practice loop already works this way: its guide reads the note to
see what you did (a `^yt-` pin, a `^bk-` highlight, the pen's ids). Tips use
that same approach everywhere else in the app.

Decided from the prototype `apps/desktop/proto/in-context-tips/` (2026-10-19):
**In the line, with the keys in the guide pill.**

## How a tip looks

- **The words go in the line.** The hint is faint italic text (`--color-text-faint`)
  where the move happens, the way the editor already writes _Your take
  first…_:
  - on an empty line, as its placeholder (the empty bullet under a video, the
    empty end of a book's note);
  - otherwise right after the line it's about (after your question);
  - otherwise in the page's nearest empty space (under the Library's shelf,
    under the calendar grid).

  It is a decoration and never written to the file.

- **The keys go in the guide pill.** The pill is the practice loop's bottom
  pill (`.onb-guide`). Here it holds only the keys for the move, the move's
  name, and **Not now**: `⌘` `S` _Pin to 1:39:16_ · Not now. Each key presses
  down while you hold it. Words appear in one place and keys in the other,
  never both.
- **If the move has no key** (open a book, drag a card), there is no pill. The
  line ends with a quiet **Not now Esc**.
- **When you've done it,** the hint line is replaced by one line saying what
  happened (_Pinned to 1:39:16. Click the pin to hear it again._). It stays
  2.4s, then fades out (150ms). The pill leaves at the same moment.
- **Motion:** the tip enters with the guide's own rise (240ms ease-out, 6px).
  Under reduced motion it appears with no animation.

## When a tip shows

- **One tip at a time** in the whole app. If two are due, the first in the
  registry's order goes; the other waits for its next trigger.
- **The pause.** A tip waits 600ms after you arrive. It never shows while
  you're typing (a key in the last 1.5s) or while a menu, popover or the pen's
  box is open, and never while onboarding is open.
- **At most twice.** If you leave without doing the move, that counts as one
  showing. **Not now** (or Esc) hides the tip until your next arrival and
  counts the same way. After two showings it never comes back.
- **Already used means never shown.** At launch, one search over the vault
  marks a tip done when its trace is already there (a `^yt-` pin, a `^bk-`
  highlight, an `^ai-` line, a `.board.svg`). This is how existing users
  get tips only for features they haven't touched.
- **One switch for all of them:** Settings → General → **Show tips**, on by
  default.
- There is no list of tips anywhere. They only appear in context.

State lives in `preferences.json`: `tips.enabled`, and per tip
`tips.<id>.shown` (a count) and `tips.<id>.done`.

## The tips

The registry, in order. **Done when** means what the tip reads from the app's
real state.

| ID                | Shows when                                                                                | Line (where)                                                                                                              | Pill keys                                                  | Done when                     |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `library-empty`   | Library opens with no items                                                               | _Try one: The Elements of Style._ under the type tabs, with **Add it** as a quiet link (imports onboarding's sample book) | —                                                          | a book is added               |
| `library-open`    | Library opens with books, no book read yet                                                | _Open a book: it reads beside its note._ under the shelf                                                                  | —                                                          | the reader opens              |
| `book-highlight`  | A book opens in the reader                                                                | _Select a line in the book. Highlighted, it lands here._ on the note's empty last line                                    | `H` _Highlight the selected line_                          | `^bk-` in the note            |
| `video-pin`       | A YouTube note opens                                                                      | _What stuck? Write it here and pin it to this moment._ on the empty line under the player                                 | `⌘` `S` _Play_ while paused, _Pin to <time>_ while playing | `^yt-` in the note            |
| `podcast-pin`     | A podcast note opens                                                                      | same as `video-pin`                                                                                                       | same as `video-pin`                                        | `^yt-` in the note            |
| `pen-answer`      | The caret leaves a line ending in `?`                                                     | _Guess first, then see Pensée's answer._ after the line                                                                   | `⌘` `.` `!` _Answer_                                       | `^ai-s-`                      |
| `pen-check`       | `pen-answer` is done, and the caret leaves a bullet with 6+ words that doesn't end in `?` | _Is it true? Pensée finds papers for and against._ after the line                                                         | `⌘` `.` `@` _Check_                                        | `^ai-p-` or `^ai-n-`          |
| `pen-connect`     | The vault has 20+ notes, and the caret leaves a line with 6+ words                        | _Written about this before? Pensée finds your notes on it._ after the line                                                | `⌘` `.` `[` _Connect_                                      | `^ai-e-`                      |
| `pen-organize`    | 3+ lines are selected                                                                     | _Sort these into topics, in your words._ after the selection                                                              | `⌘` `.` `#` _Organize_                                     | `^ai-g-`                      |
| `tabs-pinch`      | 3+ tabs are open                                                                          | _See them side by side._ in the tab strip's empty space                                                                   | _Pinch in_                                                 | columns mode turns on         |
| `board-dock`      | A board opens                                                                             | _Drag a card near another to join them._ in the canvas's empty space                                                      | —                                                          | a card docks                  |
| `go-key`          | A Space is clicked in the sidebar for the 3rd time                                        | _From anywhere_ at the row's right end                                                                                    | `⌘` `G` `L` _Go to Library_ (the row's own letter)         | a `⌘G` go is used             |
| `projects-move`   | Projects opens with cards                                                                 | _Drag a card to change its status._ under the column headers                                                              | —                                                          | a card's `Status:` is written |
| `projects-empty`  | Projects opens with no cards                                                              | _Select plans in any note, right-click, Add to Projects._ in the empty board                                              | —                                                          | a project is created          |
| `calendar-period` | The calendar panel opens                                                                  | _Click a week, month or year for its note._ under the grid                                                                | —                                                          | a period note opens           |

All copy says Pensée, never "the pen" (onboarding-spec, 2026-10-16).

## Onboarding's screen 4

Screen 4 becomes optional. When the practice loop is done, its guide offers
**Open <vault> ↵**, which finishes onboarding. Beside it is a quiet text
button, **See what else Pensée does**, which opens the carousel unchanged. The
carousel's own **Open <vault>** still ends the flow from there.
SPECs/onboarding-spec.md changes to match.

## Build notes

- **One registry**, `src/components/tips/tips.ts`: one entry per tip (id,
  trigger, anchor, line, keys, done test). Adding a tip touches that file
  only (docs/consolidation.md).
- **One store**, `tips-store.ts`: the active tip, counts and done flags,
  persisted through `lib/preferences`.
- **Editor anchors** are a CodeMirror decoration (a placeholder widget, the
  same shape as the pen's _Your take first…_). Page anchors (Library,
  calendar, sidebar, tab strip, board) are a small `<TipLine>` that each of
  those components places itself.
- **The pill** is the practice guide's markup. It's shared rather than
  copied: `PracticeGuide` and tips use one `GuidePill`.
- **Speed:** triggers hang off events the app already has (open note, caret
  line change, selection, panel open). Nothing extra runs per keystroke, and
  the vault search for "already used" runs once, off the launch path. Typing
  stays inside its 16ms budget (docs/qa/performance.md).

## Rejected (2026-10-19, prototype round 1)

- **Guide pill alone** (the whole instruction in the bottom pill, plus a ring
  on the control). It's one consistent place, but your eye goes back and
  forth between the pill and the ring.
- **Bubble** (a callout pointing at the control). It covered content: on the
  book page it hid the lines you were meant to highlight.
- **In the line with keys inline** (keycaps inside the faint text). The user
  wanted the keys standing out in the pill instead.
- **A list of every tip** (⌘P → Show tips). The user said no list.
- **Removing screen 4.** It stays, as an optional step.

## Open questions

- `tabs-pinch` without a trackpad: is there a key or menu item for columns
  to show instead?
- `pen-check` and `pen-connect` triggers are guesses at "a claim" and "a
  line worth connecting". Tune them after a week of use.
- Does a tip about a sample (`library-empty`'s **Add it**) put the book in
  `Pensée samples/` like onboarding does? Assumed yes.
