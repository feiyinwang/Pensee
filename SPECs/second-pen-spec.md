# Second Pen Spec

## Goal

An AI that writes in your notes the way a second pen would: one line at a
time, only when asked, in its own ink, right under the line you're on. It asks
questions, quizzes you on what you watched or read, adds facts with their
source, offers unexpected mixes, and cuts words. You answer under its lines.
You decide when to stop: nothing happens unless you ask.

Decided from the prototype `apps/desktop/proto/ai-writing` (Second pen) and
`apps/desktop/proto/recall` (Second pen in a source note). This spec is the
keyboard and text logic only. The prototypes' quiz button and the **?** at a
note's edge are not part of it.

## Behavior

### Asking: ⌘. opens the pen's box

- **⌘.** opens a small box right above the selection (every line it touches)
  or, with no selection, the line the caret is on. Those lines turn AI-blue
  while it's open. **⌘.** again or **Esc** closes it; so does clicking away.
- On top, **pills** for what the pen can do there. Under them, always, a
  **box to type in**, with the keyboard already in it:

  | Pill (key) | In any note | In a source note (video, book) |
  | --- | --- | --- |
  | `?` **Ask me** | one question about the line. Never answers it. | **Quiz me**: one recall or follow-up question about the source |
  | `!` **Answer** | it answers your question in one or two sentences | same, from the source when it covers it, ending with where (`— 1:10`) |
  | `@` **Facts** | one fact cited to a recent paper, or says it has none | same |
  | `+` **Mix** | one unexpected link to another field | same |
  | `−` **Shorten** | proposes cuts on the lines, nothing else | same |
  | `→` **New topic** | — | in a quiz: a question on an idea not asked about yet |

  On an empty line: **Answer** (to what you type), and in a source note
  **Quiz me on everything so far**.
- What you type steers the pill you pick: a direction for its question, its
  fact, its mix or its cuts ("ask about the 2006 study"). Click a pill with
  nothing typed for the pen's own pick.
- **Enter** with something typed asks the AI: what you typed is your
  question. It goes into the note under the line (or on the empty line) in
  your ink, and the answer under it. **⌘ Enter** uses it as a direction for
  **Ask me** instead.
- While the box is empty, a pill's key picks it (`?` `!` `@` `+` `−` `→`), so
  ⌘. then a key still works without the mouse.
- One request is one line. Opening the box again on the same line and picking
  the same pill gives one more, after the ones already there.
- With nothing to stand behind, or nothing left to say, it writes nothing and
  says so in the bottom bar ("That's all I have on this line. The rest is
  yours.").
- While the pen writes, the bottom bar says **Writing…**. Esc stops it.

### What it writes

- One line, right below the line you used the key on:
  - under a **bullet**, a **sub-bullet**, after the pen's sub-bullets already
    there (so one more lands after the last);
  - under a **paragraph or heading**, a **plain line** right below it (a blank
    line apart, so it stays its own line in any Markdown app), after the
    pen's plain lines already there;
  - on an **empty line** (a quiz on everything so far, or one more in a quiz
    from an empty answer), that line becomes the question.
- Stored as plain Markdown: the line ends with a hidden block id `^ai-<kind>-<rand>`
  (`q` quiz question, `a` question, `h` hint, `c` check, `f` fact, `m` mix,
  `r` its answer to your question).
  Other apps show an ordinary line or bullet. The id is hidden like any block id.
- Drawn in AI ink (`--color-ai-ink`); a bullet gets a hollow marker. A fact's
  or check's trailing ` — source` is fainter. The words fade in as they land.
- Its lines are your text: edit them, delete them, undo them like any line.

### Answering

- **Enter on a pen line** opens an answer bullet under it, after any answers
  already there, with the caret in it. Under a plain pen line, the answers are
  the bullets right after it.
- `!` again on the same line adds one more line that goes further.
- On a **mix**, Enter also keeps that mix and removes the pen's other mixes
  on the same line that have no answers yet.
- A **quiz question** puts the caret straight into an empty answer under it.
  - **Enter** on your answer: the pen checks it, writing the source's own
    words that answer the question (`“…” — 9:00`) as a sub-bullet of your
    answer. Then it waits.
  - **Enter on an empty answer**: it is written as *I don't know*, the pen
    puts a hint under it, and a new empty answer opens beside it. A second
    empty answer gets the source under it.
  - **⌘. ?** with the caret on one of your answers asks one more on that idea,
    as a sub-bullet of that answer.
  - Once a question has its check, Enter in its answers is a plain Enter.
- **Esc** on an empty answer takes back the question (or the hint) it answers.
  Right after the pen writes facts or mixes, Esc takes back the ones you
  haven't answered.

### Shorten

- The pen proposes cuts on the target lines: struck through in red, nothing
  added, reordered or rewritten.
- Click a cut to keep those words (click again to cut them).
- **Enter** applies the cuts, **Esc** cancels. While cuts are shown the lines
  can't be edited.
- "Nothing to cut. Every word is pulling its weight." when it finds none.

### What it knows

- The note: its title and text, and which lines you asked about.
- A **video note** (a YouTube link in its properties): its transcript (the
  note's Transcript toggle), up to where the video is now. A video not played
  yet counts as seen whole (watched elsewhere, or notes from the transcript).
  A line with a pin is about that moment. With nothing to quiz on, the bar
  says so and nothing is asked.
- A **book note** (a book file in its properties): the passage on screen in
  the open book, and the note's highlights.
- Nothing else: no web search, no other files, no tools.

### The bottom bar

The empty left side of the document footer, beside the word counts, is the
pen's. The bar has the page's own solid background, so text scrolling under it
never shows through. It shows, in order of what applies:

1. **Writing…** while a request runs (nothing while the pen's box is open);
2. *(the box above the text has the pills now)*;
3. the shorten keys and the words it would save;
4. a short message, for 4 seconds (nothing left, nothing to cut, an error);
5. on an empty answer: `↵ answer  ↵ on an empty line: I don't know  Esc take it back`;
6. on a pen line: `↵ answer under it` (a mix: `↵ keep this one`);
7. right after the pen writes: `⌘. ? one more` and the like, for 5 seconds;
8. otherwise, while the caret is in the note: `⌘. ask, or be asked, about the selection or the line you're on`.

## Implementation

- **The pen's Claude.** `agent_warm` / `agent_send` / `agent_cancel` /
  `agent_reset` take a `channel`; the pen's channel is its own process per
  window, next to the chat's, so a pen request never waits on or enters the
  chat. It runs with no tools and no saved session
  (`--tools "" --no-session-persistence`). Every request gets a fresh process:
  after a reply the pen resets its process and warms the next, so a request
  never carries the last one's context. ⌘. warms it.
- `lib/second-pen.ts`: pure text. Ids and kinds, where a line goes,
  answers and checks found from the document (no hidden session state),
  prompts, reply clean-up, cuts.
- `lib/second-pen-agent.ts`: one request → one reply, over the pen channel.
- `components/editor-area/second-pen.ts`: the editor extension (arming, keys,
  decorations, the answer flow, shorten) and the bottom bar's hint.
- `components/editor-area/document-footer.tsx` shows the hint.

## Follow-ups

- Podcast notes: an audio player in the note, and the pen quizzing on its
  transcript.
- Pause the video while a quiz question waits for an answer.
- A check that seeks the video when its time is clicked.
