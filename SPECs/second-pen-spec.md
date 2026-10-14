# Second Pen Spec

## Goal

An AI that helps you think, not one that thinks for you. It writes in your
notes the way a second pen would: one line at a time, only when asked, in its
own ink, right under the line you're on. It never writes your conclusion:

- it **answers** only after you've written your own take, then (when you
  ask) breaks both into one list of points for you to work through;
- it **checks** a claim by laying out the evidence on both sides, and you
  make the call;
- it **connects** a line to what you wrote before in other notes, and you
  write how they connect;
- it **shortens** and **organizes** your own words, nothing added.

Decided from the prototype `apps/desktop/proto/thinking-pen` (2026-10-13):
Answer → *Sealed*, Check → *Both sides*, Connect → *Inline*. Rejected there:
*Guess first* (the pen asks for a guess, then answers it; it said the same
thing three times), *Hints* (three rungs, never the answer: slow when you just
need the fact), *Verdict* (one Supported / Mixed / Contradicted line: the pen
still makes the call), *Marks* (wavy underlines over the whole note: easy to
glance at the colours and not read), *Margin* echoes (pulls you out of the
text while you write) and *Review* (connections only after writing). The
earlier pills Ask me, Facts, Mix, New topic and the quiz in video and book
notes are gone. The look is unchanged from the first Second pen
(`proto/ai-writing`): Arc's box, AI ink, hollow bullets.

## Behavior

### Asking: ⌘. opens the pen's box

- **⌘.** opens a small box right above the selection (every line it touches)
  or, with no selection, the line the caret is on. Those lines turn AI-blue
  while it's open. **⌘.** again or **Esc** closes it; so does clicking away.
- Its look is Arc's: Arc's **floating button group** (soft pills in a quiet
  tray, one highlight gliding between them) and, under it, a field in Arc's
  input style (a hairline; no focus ring while you type).
- Each **pill shows its key**:

  | Pill | What it does |
  | --- | --- |
  | `!` **Answer** | writes an answer, sealed, with a line under it for your take. It opens once you've written yours |
  | `@` **Check** | the evidence for and against the line, each with a paper (or *no paper*), then a line for your call. No verdict |
  | `[[` **Connect** | up to three short points from what you wrote in other notes, each saying what it is (Supports, Example…) and linked to its note |
  | `−` **Shorten** | proposes cuts on the lines, nothing else |
  | `#` **Organize** | only with several lines selected: regroups them into an outline in your own words |

  On an empty line: **Answer** only (to what you type).
- **Nothing runs until Enter.** Clicking a pill selects it (it lights up);
  so does typing its key, `! @ [ − #` or an input method's full-width
  `！＠［【－＃`, at the start of the box or after a space, and the key isn't
  typed. Inside a word it types as usual, so "off-shore" and "why!" work. The
  same key again, a click on the lit pill, or Backspace in the empty box
  unselects it.
- **Enter runs the selected pill**, with or without anything typed. With no
  pill selected, Enter is **Answer** on what you typed.
- **What you typed goes into the note** as your own line, under the line you
  were on (or on the empty line), and the pen works under it, for Answer,
  Check and Connect. For Shorten and Organize, which change your lines, it
  only steers and adds no line.
- Picking the same pill again on the same line gives one more, after the
  ones already there, never repeating them.

### While it writes

- A line in AI ink appears right where the pen's line will land, with what
  it's doing (*Writing an answer…*, *Finding papers…*, *Reading the
  papers…*, *Reading your notes…*, *Comparing with yours…*, *Organizing your
  lines…*) and **Esc stop**.
- When it writes nothing, it says why on that same line for a few seconds
  ("No paper found for this line.").

### Where its lines go

- Right below the line you used the key on:
  - under a **bullet**, as **sub-bullets**, after the pen's sub-bullets
    already there;
  - under a **paragraph or heading**, as **plain lines** right below it (a
    blank line apart, so each stays its own line in any Markdown app), after
    the pen's plain lines already there. Your lines under a plain pen line are
    the bullets right after it.
- Stored as plain Markdown: the line ends with a hidden block id
  `^ai-<kind>-<rand>`: `s` a sealed answer, `r` an answer (opened) or one of
  its points after Combine, `p` the evidence for, `n` the evidence against,
  `e` an echo of an earlier note. Lines the earlier pen wrote (`q a h c f m`,
  and `v`, the comparison the earlier Answer wrote)
  keep their ink and stay hidden-id. Other apps show an ordinary line or
  bullet.
- Drawn in AI ink (`--color-ai-ink`), every word of it: labels (*For:*,
  *Supports:*), a source's time, *no paper*, the seal's words and `[[links]]`
  inside it keep that one colour (a link keeps its underline); a bullet gets a
  hollow marker. Its id is
  never shown, even with the caret on the line. A paper is always a pill,
  never its link Markdown; hovering it shows the paper's title, authors,
  journal and year, citations and link, with **Open paper**. The words fade
  in as they land.
- An empty line of yours that the pen is waiting on shows what goes there, in
  faint italics: *Your take first…*, *Your call: does your line hold? Rewrite
  it or keep it.*
- Its lines are your text: edit them, delete them, undo them like any line.

### Answer: sealed until you've written your take

- **⌘. !** on a line (a question, or anything to explain): the pen writes its
  answer under it **sealed**, blurred and unreadable, with *Sealed until you
  write your take · ⌥↵ open it now* above the words, and an empty bullet
  right **beside** it (the next line, at its level, not under it) with the
  caret in it: *Your take first…* Under a paragraph, the answer is a plain
  line and your take the bullet right after it.
- **Enter** on your take: the pen first checks it's a real attempt (wrong is
  fine; random letters or something off-topic keeps it sealed), then opens
  the answer (`^ai-s-…` becomes `^ai-r-…`, so it stays open after a reload).
  **Nothing else moves**, so you read the two side by side. No comparison is
  written. An empty bullet goes under your take, caret in it: *Put the two
  together, in your words…* and, right after those words, a quiet
  **Combine into one list `Tab`** button.
- **Enter on an empty take**: nothing opens; the bar says *A wrong guess
  counts. Write anything first, or ⌥↵ to open it now.*
- **⌥↵** on your take opens it without the check (same as Enter after it);
  on an empty take the answer opens and the take line goes.
- **Esc** on the empty take takes the sealed answer back.
- In a **video note** (transcript) or a **book note**, the answer comes from
  the source when it covers it, ending with where (`— 1:10`).
- An answer the earlier pen wrote (your take *under* it) still opens: its take
  moves beside it, so Combine works on it too. Comparisons it wrote
  (`^ai-v-…`) stay as they are.

### Combine: one list of points, you work through them

Reading the two is the moment you reconcile them, and two paragraphs rarely
line up point for point. Combine breaks both into short points you can take
one by one, and only when you ask.

- **Tab** (or the **Combine** button) on the empty line under an opened
  answer and your take. The bar says *Read both first · Tab combine them into
  one list*. *Reading yours…* shows under your take while the pen reads.
- The answer, your take and that empty line are replaced by **one list** at
  their level, built **MECE**: no two points overlap, and together they cover
  everything in your take and the answer.
  - **Your points are your words**: the take split, joining words (then, and,
    so, but) and end punctuation dropped, every word kept, nothing added or
    reworded. If the pen's split isn't word for word yours, or leaves a word
    out, your take is split at its own punctuation instead and the pen's
    points follow it, unnested.
  - **The pen's points** are only what the answer adds, short (at most 12
    words), in AI ink with the hollow bullet (`^ai-r-…`). One that says what a
    point of yours already says is left out: yours stands. One that adds a
    detail keeps only the detail. Never your words: a pen point that is a
    piece of your take is dropped in code, whatever the model labelled it,
    and when the model's pen points were all copies of your take, the
    answer's own points (split at its punctuation) stand in for them.
  - **Nested by meaning, not by who wrote it**: a point that is a part, step,
    example or reason of another sits under it, the broader one on top,
    whoever wrote either, so a point of yours can sit under one of the pen's.
    Separate branches stay side by side. One level of nesting at most (two
    spaces in); a deeper point sits beside its parent.
  - A pen point that contradicts the one it sits under or after ends with a
    faint ` — the opposite`. Never which is right.
  - No heading over the list, no colour band, no buttons on the points: the
    next step on any of them is the usual ⌘. box, or Tab under one to go
    deeper.
- An empty last line: *Add a point, or go deeper on any line above…* with
  **Undo `⌘Z`** right after the words. **Undo** (or ⌘Z) puts the opened
  answer, your take and the Combine line back exactly. Undo goes once you type
  anywhere; ⌘Z still works as usual.
- **Click another line** while that last line is still empty and it goes (not
  an undo step).
- The lines move from where their words were into their rows
  (`--motion-base`, `--ease-out`); a line whose words weren't found fades in.
  Nothing moves under reduced motion.
- Decided from the prototype `apps/desktop/proto/pen-reconcile` (2026-10-13):
  *Combine*. Rejected there: the shipped comparison line (the two points often
  didn't belong together, and overlaps were hard to see), *Woven* (the pen's
  points tucked under yours: three levels deep; nesting by meaning, one level,
  came back on 2026-10-13 after the flat list put a detail beside the point it
  belongs to), *Mixed* (the pen fused the
  overlaps into one sentence: it did the mixing for you), *Ledger* (two
  columns, keep or drop each side: a table in the middle of the note), *Line*
  (only an empty line: no help finding the overlaps), *Split* (both split but
  nothing paired), *Under each* (a reply line under every pen point: built
  around the pen's points, not yours). Also rejected: splitting the moment
  it opens (you need to read first), a bracket or tinted band joining pairs,
  per-point Break down / Research buttons, a "Your take and the pen's,
  together" heading, and *Now your version, in one line…* as the last line
  (the next step is to go deeper, not to summarise).

### Check: both sides, you make the call

- **⌘. @** on a claim: the pen searches recent, well-cited papers (OpenAlex)
  and writes two lines under it: **For:** the strongest support it found,
  then **Against:** the strongest challenge or limit. Each ends with its
  paper's pill, or *no paper* when it is a limit of the evidence rather than a
  finding (one small study, never measured). It never writes a verdict.
- An empty bullet under *Against* waits, caret in it: *Your call: does your
  line hold? Rewrite it or keep it.*
- A line that ends with `?` is a question: *That's a question, not a claim.
  Nothing to check.* No paper found: *No paper found for this line.*
- **Esc** on the empty *your call* bullet takes both lines back.
- One more never cites a paper already there.

### Connect: what you wrote before

- **⌘. [** on a line: the pen looks through your other notes for lines on the
  same idea and writes up to three **echoes** under it. Each is short: a
  label saying what it is, one sentence (two at most, about 20 words) in the
  pen's words on what you found or thought there, and the note as a link. The
  link keeps the original, so the echo never copies the whole line:
  `Supports: You remembered more after eight hours of sleep before an exam. — [[Sleep log]]`.
  The labels: *Supports*, *Contradicts*, *Example* (your own experience
  included), *Definition*, *Summary* (the same idea, said before), *Answer*
  (to the line's question), *Another angle*. The label is in the same ink as
  the rest of the line.
- A note already echoed under the line isn't offered again.
- **Fast.** The search runs on an index of every note's own lines
  (`LINE_INDEX` in `commands/search.rs`, on `file_cache.rs`): kept on disk in
  the app cache folder, keyed by each note's modified time and size, and
  brought up to date in the background when a vault opens. A search only
  `stat`s each note (about 15ms for 5,500 notes); it never reopens a note
  that hasn't changed, which on an iCloud vault with offloaded notes meant
  downloading them and took minutes. A search never waits on iCloud: a note
  offloaded to iCloud and not yet indexed is skipped until the background
  pass has downloaded it, and the search doesn't wait for that pass. The
  pen's pick takes about 2.5s on Haiku, so a Connect lands in a few seconds,
  the first one after opening a vault included. It searches the line's own words first;
  only when that finds fewer than six lines does the pen name more words
  (`connectQuery`), so most Connects make one call to the pen, the pick.
- **Enter** on an echo opens an empty bullet under it, for anything you want
  to add; every echo stays. A click on its link opens that note. Echoes go
  only when you remove them: delete them like any line, or press **Esc**
  right after they land to take back the ones just written.
- Nothing found: *None of your other notes mention this yet.* Found, but
  nothing on the same subject: *Your notes mention this, but nothing that
  meets this line yet.*

### Organize

- With two or more lines selected, the pen regroups them into an outline:
  related lines together, details nested under their point, in order. It
  keeps your own words: it only reorders, regroups, indents, merges exact
  repeats and adds a few short group labels. Block ids stay on their lines.
- The outline replaces your lines, tinted, and the text waits: **Enter**
  keeps it, **Esc** puts your lines back exactly as they were.

### Shorten

- The pen proposes cuts on the target lines: struck through in red, nothing
  added, reordered or rewritten. It never cuts a block id (`^…`, hidden or
  not), a `[[link]]` or a paper's citation.
- Click a cut to keep those words (click again to cut them).
- **Enter** asks before deleting: *Delete 12 words?* under the lines and in
  the bar. **Enter** again deletes them; **Esc** goes back to reviewing the
  cuts (and clicking a cut does too). **Esc** while reviewing cancels, your
  lines as they were. While cuts are shown the lines can't be edited.
- "Nothing to cut. Every word is pulling its weight." when it finds none.

### What it knows

- The note: its title and text, and which lines you asked about.
- **Answer** in a video note (a YouTube link in its properties): its
  transcript up to where the video is now (a video not played yet counts as
  seen whole). In a book note: the passage on screen in the open book.
- **Check**: the titles and abstracts of the papers its search returns.
- **Connect**: lines from your other notes that contain the words it searched
  for (at most 40, this note's own lines left out), with their note's name.
  Nothing else from those notes.
- No web search beyond the paper search, no tools.

### The bottom bar

The empty left side of the document footer, beside the word counts, is the
pen's. The bar has the page's own solid background, so text scrolling under it
never shows through. It shows, in order of what applies:

1. **Writing…** while a request runs (nothing while the pen's box is open);
2. the shorten keys and the words it would save, then *Delete N words?*;
3. a short message, for 4 seconds (nothing found, an error);
4. on your take beside a sealed answer: `↵ open it  ⌥↵ open it now`; on the
   empty line under an opened answer and your take: `Read both first  Tab
   combine them into one list`; on the empty line under a combined list, while
   Combine was the last change: `⌘Z back to the two  ⌘. on any line to go
   deeper`;
5. on a pen line (an echo too): `↵ reply under it`;
6. right after the pen writes: `Esc take them back` and the like, for 5 seconds;
7. otherwise, while the caret is in the note: `⌘. answer, check or connect the line you're on`.

## Implementation

- **The pen's Claude.** `agent_warm` / `agent_send` / `agent_cancel` /
  `agent_reset` take a `channel`; the pen's channel is its own process per
  window, next to the chat's, so a pen request never waits on or enters the
  chat. It runs with no tools and no saved session
  (`--tools "" --no-session-persistence`). Every request gets a fresh process:
  after a reply the pen resets its process and warms the next, so a request
  never carries the last one's context. ⌘. warms it.
- `lib/second-pen.ts`: pure text. Ids and kinds, where a line goes, the
  sealed-answer and echo flows read from the document (no hidden session
  state), prompts, reply clean-up (answers, both sides, echoes, cuts).
- **Connect's search**: `find_lines_mentioning` (`commands/search.rs`) scans
  the workspace's indexed markdown files in parallel for lines containing any
  of the pen's search words (case-insensitive), the current note excluded,
  best matches first, capped at 40; the pen's own lines and empty lines never
  count. One scan at a time, like `find_block_references`.
- `lib/second-pen-agent.ts`: one request → one reply, over the pen channel.
- `components/editor-area/second-pen.ts`: the editor extension (the box as
  a CodeMirror tooltip, the progress line as a block widget, decorations
  (the seal, the For / Against labels, the waiting-line placeholders), the
  sealed answer, both sides, echoes, shorten, organize) and the bottom bar's
  hint.
- `components/editor-area/pen-box.tsx`: the box's React (Arc's floating button
  group and the field), loaded on first use and prefetched when idle.
- `components/editor-area/document-footer.tsx` shows the hint.

## Follow-ups

- Connect by meaning, not only shared words (embeddings), so an echo can find
  a note that says the same thing in other words.
- An answer's time (`— 1:10`) that seeks the video when clicked.
