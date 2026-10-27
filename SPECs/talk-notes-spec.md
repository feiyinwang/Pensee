# Talk Notes Spec

## Goal

Think out loud inside a note. You press Record at the bottom of the note and talk. As you turn from one topic to
the next, the pen asks before it opens a new tab for it, and each topic's picture grows while you speak. When you
stop, the talk is in the note as plain markdown: the audio file, its transcript, and one diagram per topic you can
edit as text. You can carry on talking into the same talk later, and every recording is listed in one place.

Decided from the prototypes in `apps/desktop/proto/note-value` (Listen / **Ask** / Finish first; the writer picked
Ask on 2026-10-26) and `apps/desktop/proto/talk-notes` (Ask with Pele, audio, Continue, Recordings, Settings).

## Behavior

### Recording

- **Record** sits at the bottom centre of the note, as Granola's does (approved 2026-10-25; it never moves into a
  menu or the ⌘. box). Pressing it asks for the microphone the first time (macOS's own prompt).
- At rest Record is a red dot on a small round surface, the same on every note; hovering shows "Record". While you
  scroll the note or type, the surface fades and the dot dims to a faint mark, so it never sits on the text you're
  reading under a pinned video; it comes back 1.5 s after you stop, or as soon as the pointer comes near it. After
  a take the pill (Saved, **Continue**, **New talk**) steps aside the same way, dimming. Decided from
  `apps/desktop/proto/record-dock` (Dot + aside, 2026-10-27; rejected: the full pill, which covered a line on a
  video note; Record in the footer bar, which read as one more count; a pill that only shrank while you worked).
- While recording the pill shows a live red dot, a level trace, the time and **Stop**. The trace is the last half second of your voice's loudness, newest on the right, on a decibel scale so talking fills most of it and a quiet room leaves it flat.
- The pill and the live box size to the note's pane, not the window, so they fit a column after a pinch.
- When macOS hasn't let Pensée use the microphone it gets only silence, not an error. If nothing but exact zeros comes in for the first 3 seconds, the pill says "No sound from the microphone" and where to allow Pensée; it goes once sound arrives. A quiet room is never exactly zero, so this doesn't fire on silence you make.
- The microphone is on only while the pill shows a take. Going to another note keeps recording, and the pill follows you there with the note's name ("in Talk note") and **Stop**. Closing the note's tab stops the take and saves it to `Recordings/`. A take whose note isn't on screen at Stop (left or closed) still goes into the note: into its file, at the end, with its transcript and topics after it; what Stop asks next (the Whisper download, an error) shows on the note you're in.
- **Stop** saves the take as an audio file in `Recordings/` at the vault root, named by date and time:
  `Recordings/2026-10-25 09.14.m4a`. A later take into the same talk is `… 09.14 (2).m4a`.
- After a stop, the pill reads _Saved to Recordings/_ and offers **Continue**: it records the next take into the
  same talk (same heading in the note; tabs and pictures carry on from where they were).

### While you talk (Ask)

- A box above the pill holds the talk's topics as tabs (Arc segmented control). Each tab shows what it holds
  ("3 options", "4 slices"), morphing as it grows (Arc text morph). Asides said in passing wait as a small badge
  ("Hiring for QA +1") and never move the picture.
- A small status on the right says **Listening**; when the pen hears a turn it flips to the words it heard
  (_“Okay, next” · new topic_; affectUI thinking loader).
- **Ask:** when you turn to a new topic, a _New topic?_ card (affectUI smart recommendation) says what you said and
  how sure the pen is. **Accept new tab** opens it; **Alternatives → Aside** keeps it in the transcript without a
  tab. Both can be undone from the card. Keep talking about the new topic for one more sentence and the pen takes
  it for you. The very first topic opens without asking.
- The picture under the tabs is the current topic's diagram, drawn as you speak (see Diagrams). Clicking another
  tab pins it; **Back to what I'm saying** follows the talk again.

### The note after a stop

The talk lands under the caret's section as markdown:

````markdown
## Talk · 09:14

![[Recordings/2026-10-25 09.14.m4a]]

> [!transcript]- Transcript · 12 lines · On this Mac · Whisper Small
> [0:00](<Recordings/2026-10-25 09.14.m4a#t=0>) Okay, a few things today.
> …

### What to build next quarter

```mermaid
quadrantChart
  …
```
````

- Voice capture: people want it, a few weeks of work. [0:03](<Recordings/2026-10-25 09.14.m4a#t=3>)

`````

- The audio embed renders as a player (play, scrub, time).
- The transcript is a folded callout under its take: the words live in the note and search finds them. Opening it
  lists every line with its time; a time plays that moment.
- One `###` section per topic you accepted, in the order you opened them: its diagram, then what you said about
  it, each line with a time link into the take. Asides go under _Said in passing_.

### Diagrams (Pele, drawn with Arc)

- Every ```` ```mermaid ```` block in any note renders with **Pele** (pele.run, MIT), which reads Mermaid text and
  covers all 32 of its types. The text stays plain Mermaid, so the note opens anywhere.
- Types an Arc chart draws are drawn by that chart: pie → donut, xychart → bar or line, sankey → Sankey flow,
  radar (≤ 3 series) → radar, treemap → treemap, treeView → tree view, kanban → kanban board. A bar chart of
  categories headlines their average ("Average"), not a daily one.
- Every other type keeps Pele's layout but is drawn in Arc's style: raised surfaces with a hairline ring and soft
  shadow, 8px corners, series tints by section, quadrant or timeline period, quiet labels, 1.5px round lines, a
  lit ring on hover. Words Pele sets in its background colour on a filled box (a timeline's dates) take the ink.
  In the talk box a matrix, which shrinks to the box's height, draws its points and their names larger.
- The existing canvas behaviour stays: pan, zoom, reset, fullscreen and the source toggle; a parse error shows
  Pele's message.

### Topic boards

A topic drawn as a mind map or a flowchart is a Pensée board, not a Mermaid picture: the first time the AI draws
it, a `.board.svg` is made beside the note (as `/board` makes one) and the talk box shows it with the board's own
renderer. Charts (pie, bar, quadrant, timeline…) stay Arc charts; their section has the summary and the Mermaid block. Asides keep their lines under "Said in passing".

- **Which picture.** Things done in order ("I'll do X, then Y", "first…, next…", "once that's done…") are
  **steps**: plain rectangles drawn as Arc draws a card (a quiet grey outline, no fill), one per step, chained
  left to right in the order they happen, their words wrapped so a chain of five still reads in the box; a
  step's details sit in its label and a condition ("verified") on its arrow, whose gap widens to fit it. A topic
  drawn as a map turns into steps as soon as you tell an order. Ideas with no order (brainstorming, options,
  reasons, doubts) are a **mind map** (the board's, its branches in colour), and so is anything no other type
  clearly fits. The map is MECE: two to six branches of a different kind each, every idea under the one branch
  it belongs to and nowhere else; the AI regroups when branches overlap or one grows past six. Each turn it
  redraws the whole topic from everything said so far (renaming, regrouping, reordering), rather than adding
  the new lines at the end, and its nodes are what you mean, never your framing ("the idea is simple").
- **Say or click.** Under the picture, a row names the pictures the way you'd say them: as a mind map, as steps,
  as a matrix, as a timeline, as a chart. Saying one ("as steps", "as a flow"; "as a matrix", "on two axes",
  "compare"; "as a pie"; "as a chart", "as bars", "over time"; "as a timeline"; "as a to-do board"; "as a
  journey") or clicking it redraws the shown topic that way within a turn; the topic's current picture is
  pressed, and a clicked one pulses until it's drawn (the status says "Drawing it as steps"). A type you asked
  for stays until you ask for another. A topic shows and is written as its current type: an earlier chart of
  it stays unused. A map redrawn as steps (or back) keeps its board file while you haven't touched it; if you
  had, it gets a new board and yours stays on disk as you left it.
- **next topic**, at the end of that row, opens a tab now, titled "New topic" until the AI names it from what
  you say next; those lines go in it with no New topic? card. One empty tab at a time: the button waits while
  the new tab has nothing in it, and an empty one isn't written to the note.
- **Arrange it in the box.** Drag a mind-map topic onto another to put it under it, or onto a sibling's top or
  bottom edge to put it before or after; the topic under the pointer shows where it goes. A moved topic, and a
  sibling order you set, are yours (kept through the AI's drawings). The central topic doesn't move.
- **Click the board** in the talk box: it opens in the board editor. While it's open, what you say still goes
  to the AI, but that topic's drawing waits; it is merged when you close the editor.
- **What you change by hand stays** (`topic-board-merge.ts`). Measured against what Pensée last wrote to the
  file: a topic whose words, parent, colour or side you changed, or that you added, stays where you put it; a
  topic you deleted stays deleted (the same words can't come back); shapes, stickies and strokes you add are
  never touched. A topic you renamed still counts as the same topic when the AI says its old words. Only what
  the AI drew and you left alone follows its new drawing; what it drops goes, unless it holds something of yours.
- The AI is shown the board as it is now (its mind map as Mermaid), so its next drawing starts from your edits.
- A flowchart has no tree to merge into: once you change anything on it, the AI leaves it as it is, and the box
  says so.
- **After Stop** the topic's section holds at most two sentences of summary (the AI's, of what you concluded or
  plan), then the board (`![Title](assets/….board.svg)`) instead of a Mermaid block: the drawing shows on the
  page and opens with one click, like any board. After Stop the note scrolls to the topics and draws them at once. The heard lines aren't listed under it; they're in the transcript.
- **Nodes carry no play badges.** The take plays from the note above the board; a node is only words.


- **Free by default, on the Mac:** OpenAI's Whisper through whisper.cpp, the engine Superwhisper's free plan runs.
  Works offline; audio never leaves the Mac. Whisper Small (488 MB) downloads on first use; Whisper Large v3 Turbo
  (1.62 GB) is an optional download.
- **ElevenLabs Scribe** is opt-in in Settings with your API key (kept in the system keychain). The live view while
  you talk still uses Whisper; the saved transcript of each take comes from Scribe, sent the take's audio file
  once at Stop (`scribe_v2`, word times grouped into lines at sentence ends and pauses). Until a key is saved,
  takes use Whisper.
- Each take records which engine wrote its transcript.

### Recordings

- **Recordings** in the sidebar's Spaces lists every audio file in `Recordings/`, newest first, with its note,
  date. Choosing one shows its player and full transcript (its times play that moment), and a link to the note.

### Settings · Transcription

- A **Transcription** section in Settings, like the others: **Transcribe With** (On this Mac / ElevenLabs Scribe,
  `talk.engine`) and **Whisper Model** (Small / Large v3 Turbo, `talk.whisper-model`). Under them, whether the
  model is on this Mac with **Download**, and, with ElevenLabs chosen, the API key field: **Save** puts it in the
  keychain, then **Check key** and **Remove**. The key never goes back to the web view or into settings.json.

### Continue

- After a take, the pill offers **Continue** and **New talk** on that note. **Continue** records the next take into
  the same talk: its player goes under the last take's transcript (no new heading), the topics carry on from where
  they were, and after Stop the talk's topic sections are rewritten in place with every take's lines, each linking
  to its own take. If you edited those sections, the new ones go under the take instead.

## Implementation

Phased; each phase ships on its own after its QA pass.

1. **Pele + Arc for mermaid blocks.** `mermaid-renderer.ts` renders with Pele (sync `render`); Arc-skin CSS on
   `.pele`; chart types mount the vendored Arc chart in the canvas frame (lazy chunk, `ensureArcTokens()`).
   beautiful-mermaid goes.
2. **Record.** Microphone entitlement and usage string; `MediaRecorder` (audio/mp4) in the web view; Rust command
   writes the bytes to `Recordings/`; the audio embed widget (`![[….m4a]]`) renders the player.
3. **Whisper.** `whisper-rs` (whisper.cpp, Metal); model download to the app's data dir with progress; the web
   view streams 16 kHz mono PCM (AudioWorklet) to Rust, which transcribes a rolling window for the live view and
   the whole take at stop; the transcript callout is written with the take.
4. **Ask.** The talk's sentences go to Claude (a `talk` channel next to the pen's) which returns, per sentence:
   new topic / same / back to / aside, the topic's title, and its updated Mermaid source. The box, card and tabs
   follow the prototype.
   It runs on your model from Settings → Agent, at least Sonnet (Haiku keeps mind maps flat). The speaker
   directs the picture: "X comes after Y", "put X under Y", "rename", "drop" redraw it that way and their
   latest word wins; mind maps and flowcharts are kept MECE.
5. **Continue, Recordings, Settings.** Next take into the same talk; the Recordings space; Settings section;
   ElevenLabs Scribe at stop through `reqwest`; key in the keychain (`keyring`).

## Not doing

- No microphone-free "upload a file" flow yet.
- No live cloud streaming (ElevenLabs realtime): the cloud engine runs after each take.
- No speaker labels in the transcript.
`````
