# YouTube Notes Spec

## Goal

Watch a YouTube video inside its note and take notes while it plays. Each
note can be pinned to the moment it was taken. Clicking the pin plays the
video from that moment. A pinned note is a normal block. On a board, the same
pin makes a rectangle by default, or a child node when a mind-map node is
selected.

## Behavior

### The player

- A note gets a player when its properties hold a YouTube link under `url`,
  `link` or `source`. These are the same keys and link shapes that Library
  covers read (`noteLink`, `youtubeVideoId` in `lib/covers.ts`).
- A link with a time plays from it, as YouTube does: `t=210`, `t=210s`,
  `t=3m30s` or `t=1h2m3s` in the query or after `#`, or an embed's
  `start=210` (`youtubeStartSeconds` in `lib/covers.ts`). The time is read
  when the player loads; editing it in the link takes effect the next time
  the note opens.
- Pasting a link with a time to a video that already has a note (⌘N then
  ⌘↵, or ⌘O's **Already in your Library** row) opens that note and plays
  its video from the pasted time (`seekVideoToLinkTime` in
  `lib/video-players.ts`; the seek waits for the player if the note wasn't
  open). A pasted link without a time opens the note as it is.
- The player sits under the properties, the full width of the pane, edge
  to edge: 16:9, but no taller than 60% of the window (past that, the frame
  keeps the width and YouTube letterboxes the picture). Its corners are
  rounded (10px) and it casts a soft shadow, the same as the mini player
  over a board. It is sticky: once the
  properties scroll away, it stays at the top of the note and the notes
  scroll beneath it. The band behind it has the page's background, so no
  text shows through around the video.
- No YouTube chrome. YouTube's controls are off (`controls: 0`) and a
  transparent shield covers its frame, so its title, share, **More videos**
  and scrubber never wake. Its start and end screens sit under the video's
  thumbnail until it plays. Clicking the video plays or pauses it. Moving
  the pointer over it shows our own bar for 2s (longer while a list is
  open, or while the pointer rests on the bar):
  - play/pause and `m:ss / m:ss`;
  - the track, split into the video's chapters with a gap at each start.
    Under the pointer the line thickens, the chapter there thickens
    more, it fills lighter up to the pointer, and a knob marks the
    playhead. A tooltip names the chapter (in full, kept inside the
    track) and the time there; click or drag seeks;
  - the current chapter's name, which opens the chapter list (current one
    marked, each with its time) to jump from;
  - **CC** (subtitles on/off) and the speed (0.25×–2×, YouTube's list).
    Both are remembered for the next video, in the app's `localStorage`
    under `writer.video-player`.
- ← / → while the pointer is over the video skip it 5s back or on,
  playing or paused as it was (a video not started yet plays from there),
  instead of moving the caret. The page tells the app when the pointer
  enters and leaves (`{type:"hover", over}`); the app sends
  `{cmd:"skip", by}`.
- Scrolling over the video scrolls the note; pinching over it reaches the
  tab columns' pinch like a pinch anywhere else.
- Under the video is one row: the keys in full, each a label then its key
  (**Play ⌘S** while paused, **Pin ⌘S** while playing, **Slower ⇧,**,
  **Faster ⇧.**), then **Transcript** when the video has captions not yet
  brought in. There are no Play or Pin buttons: ⌘S does both, the video's
  own bar plays and pauses with the mouse, and its bar sets the speed.
- **⇧, / ⇧.** step the speed down or up YouTube's list in the video's note,
  and the new speed shows on the video for a moment. They match by
  character (`<` `>`, their own key on some layouts) or by key with Shift,
  so they work with an input source such as Pinyin that types 《 》 there.
  They never type there; with nothing editable focused they act on the last
  video used; anywhere else they type.
- **⌘S** ("save the moment", SPECs/obsidian-shortcuts-spec.md#the-system),
  in the video's note, on its player, or on a board: while the video plays
  it pins the moment and pauses, so you can write about it; while paused it
  plays on. The video is the focused note's, else the one on screen (the
  last one used when several are). ⌘⇧J is gone: J meant nothing.
  Plain Space is never taken, so it always
  types. (Not ⌘⇧Space: it clashes with system shortcuts.)
- The video keeps playing while you type. When you start it by clicking in
  the player, focus goes back to where it was (the note or the board). Your
  typing lands in the note, not in YouTube's keyboard controls.
- A video whose owner forbids embedding shows a line with **Open on
  YouTube** instead.
- Changing the link in the properties loads the new video.

### Pins: the note is the record

- **Storage.** A pin is a hidden block id at the end of the block,
  `^yt-<seconds>`, for example `- the key idea ^yt-754`. A second pin at the
  same second on the same note gets `^yt-754-2`. The id only works on its
  own note, because the video comes from that note's link.
- **Shown.** The id is replaced by a small pin icon at the end of the line.
  Hovering it shows the time (`12:34`). Clicking it plays the video from
  there. The block is an ordinary block for the block handle, linked blocks,
  moving and copying.
- **Removing.** Backspace right after the pin removes it as one unit, and
  undo puts it back.
- **⌘S is the pin key** in a note that plays a video or episode, on its
  player, and on a board while a player is mounted; elsewhere ⌘S does
  nothing (notes save themselves). It was ⌘P until ⌘P became Projects.
- **Pinning** (⌘S or **Pin**) uses the video's current time and acts on the
  note's caret:
  - On an empty line, the line becomes `- ` plus the pin.
  - On an empty bullet, the bullet gets the pin.
  - On a block with text and no id, that block gets the pin, so a note
    written first can be pinned afterwards.
  - On a block that already has an id, a new bullet goes under it at the
    same indent, with the pin.
  - The caret ends on the pinned line, ready to type. When focus was
    elsewhere, the note's last caret position is used.

- **Pin by writing.** Pause the video (any way but buffering or the end)
  and start writing in its note within 15 seconds: once the caret's line
  has words (not a bare `-` or `1.`), its block gets a pin 5 seconds before
  the pause, as if ⌘S had been pressed then. Playing again cancels it. A
  block that already has an id, or one that can't carry one (code, table),
  is left alone. It waits for an IME composition to end. Paste doesn't
  count; only typing does.

### Transcript

- A video brought into a note gets its transcript at the top of the note's
  text, right under the properties and the player. Pensée shows it as the
  transcript box (below); in the file it is a closed toggle
  (**Transcript**), ordinary text for search.
- "Brought in" means: added to Library from a YouTube link, or a YouTube
  link typed, pasted or changed in an open note's properties. Opening a
  note that already had its link never changes it.
- For any other video note (an older one, or one whose transcript failed),
  **Transcript** sits next to **Pin** under the video while the note has
  none; it reads as **Getting transcript…** while it works. It is offered
  only once YouTube has listed captions for the video: a video with none, or
  one whose captions couldn't be checked, shows no **Transcript** button, and
  a link brought in for such a video adds no transcript and no notice.
- The transcript is in English: the creator's English captions, else
  YouTube's automatic English ones. A video with no English captions gets
  the language spoken (the creator's captions in it, else the automatic
  ones). YouTube's translated captions can't be read (they answer 429), so
  only the video's own tracks are used. Paragraphs are about a minute long
  (closed at a sentence end from 45s, at 90s regardless), each starting
  with its time (`12:34`).
- A video with no captions says so in a notice; a failed read says it
  couldn't get the transcript. A note keeps one transcript: with one there,
  nothing is added, even for a new link.
- Stored as plain HTML, so other Markdown apps show the same toggle:
  `<details lang="en">` (the captions' language code), then
  `<summary>Transcript</summary>`, then one `<p><small>m:ss</small> text</p>`
  per paragraph, with no blank line inside and the text escaped. A toggle
  written before the language was kept is a bare `<details>`; it reads the
  same.

### Transcript box

The transcript toggle shows as a teleprompter, never as its HTML (it used to
open into raw `<details>` source when clicked).

- A box with a **Transcript** header and about six lines of text, the edges
  fading.
- **Where it shows.** In a pane at least 900px wide it sits to the right of
  the video, as tall as the video (at least 320px wide, about a third of the
  pane), and stays pinned at the top with it while the note scrolls. In a
  narrower pane it sits in the note, under the video, and scrolls with the
  note. The pane's width counts, not the window's, so opening the sidebar
  or splitting columns can move it under. With a board open over the note
  (mini player) it isn't shown.
- **Folding.** The chevron and **Transcript** in the header fold the box to
  its header and unfold it. Folded, it is under the video (beside it there
  would be an empty column), and unfolding in a wide pane puts it back
  beside. One setting for every video note, kept across launches.
- **Language.** When the video has captions in more than one language, a
  menu next to the title names the transcript's language (**English**) and
  lists the video's caption languages, English first, as YouTube names
  them. Picking one reads the transcript again in that language and puts
  it in place of the note's toggle (the button reads **Spanish…** while it
  works); the rest of the note is untouched. A toggle written before the
  language was kept shows **Language**. With one caption language, no menu. Each line is a sentence; a long one (automatic captions have no
  full stops) is cut into even slices of up to 24 words, and a line under
  4 words joins the next.
- **Following the video.** The line being said is highlighted: the note's
  ink on a soft band, shown whole at once (no word-by-word reveal); the
  other lines are muted. The box scrolls on its own to keep it a third of the way
  down. Before the video plays, the first line is the one being said.
- **Line times.** The note keeps only each paragraph's start, so a line's
  time is where its first letter falls in the paragraph, spread over the
  time until the next paragraph (the last one assumes about 160 words a
  minute). Speech is near even within a minute, so a line lands within a
  few seconds of when it is said.
- A line's time shows in a gutter on the line being said and on the line
  under the pointer. Clicking a line plays the video from it.
- **Reading more.** Scrolling the box any way (wheel, trackpad momentum,
  dragging its scrollbar) stops it following; **Back to now**
  appears in the header and brings it back. Clicking a line also brings it
  back.
- **Copying.** Text in the box selects like any text (⌘C copies it); a
  drag that selects words doesn't seek. **Copy** in the header copies the
  whole transcript, a paragraph per block after its time (`1:15 …`), and
  reads **Copied**.
- **Asking.** **Ask** opens the Agent (bottom right) with its input
  focused. Every message to the Agent says where each open note's video is
  and carries the transcript from 90 s before to 10 s after that moment, so
  "what did he just say?" works; the full transcript is in the note.
- Clicks, scrolling and selection inside the box stay in it. A caret at
  its edge leaves it a box; only a selection inside its source, such as a
  find match, opens the source.
- **Typing around it** (`transcript-edges.ts`). The transcript is the first
  thing in the body, so a note opened at the top would put the caret at the
  block's start, drawn under the box. It goes on the line under the box
  instead, where it is drawn. Words typed against the block never touch it:
  before `<details>` they go on a line of their own above, with a blank line
  between; after `</details>`, or on the empty line right under the box,
  they go below a blank line, which other Markdown apps need to end the
  HTML block. Enter, arrow keys and clicks are left alone, so the caret can
  still reach the start of the note.

### Pins on a board

- **Where a pin goes:**
  - Focus on a board: the pin goes to the board.
  - Focus in the video's note: the pin goes to the note.
  - Focus anywhere else, such as the player: the pin goes to an open board
    on screen if there is one, else to the note.
- **What it makes:**
  - With a single mind-map node selected, it adds a child node under that
    node.
  - Otherwise it adds a rectangle the size of a drawn one, placed like a
    book highlight (`placeFromSide`, on the side facing the video).
  - The new element is selected and typing starts in it.
- **Link.** The element's `ln` is `Page#^yt-<seconds>`: the video note's
  name and the pin. It is portable like any `[[link]]`. The label stays
  plain, editable text. A pin icon in the element's top-right corner (its
  tooltip is the time) plays the video from there. If the video's note is
  closed, it opens first.
- **Board over the video's own note** (**Edit here**). The board covers the
  page, so the player moves into a 320px mini player in the top-right
  corner over the board and keeps playing. The iframe is never moved or
  reloaded.
- **Lifetime.** A board pin does not need a block on the page, since the
  time is in the link itself. Deleting the rectangle or node deletes
  nothing else.

## Implementation

- **Player page.** `src-tauri/src/video_player.rs` runs a loopback HTTP
  server on `127.0.0.1` (random port). It starts on the first
  `video_player_origin` call and serves one static page,
  `assets/youtube-player.html`; any other path gets a 404.
  - YouTube refuses embeds that have no valid HTTP referrer (Error 153), and
    the shipped app's origin is `tauri://localhost`. A page served from
    `127.0.0.1` sends one. Electron apps fix the same error the same way.
  - The page runs the YouTube IFrame API. It posts
    `{source:"pensee-yt", type:"state"|"error", t, playing}` to its parent:
    on ready, on every state change, and every 500ms while playing (with
    YouTube's `state`, so a pause is told from buffering), and `release`
    after any press so the app hands focus back to the note. It takes
    `{cmd:"seek", t}`, `{cmd:"play"}`, `{cmd:"pause"}`, `{cmd:"toggle"}` and
    `{cmd:"chapters", chapters}` back. It draws the shield, poster and hover
    bar itself. It also posts `prefs` (speed, subtitles) for the app to keep,
    since its own origin changes every launch, and every `wheel`, which the
    app turns into a scroll of the note or, with ctrl (a pinch), a wheel
    event from the frame.
  - `seek` on a video that hasn't started (the note just opened) loads it
    at `t` (`loadVideoById` with `startSeconds`): `seekTo` + `playVideo`
    there buffers, then falls back to unstarted, so a pin did nothing.
    A started video seeks in place.
  - YouTube's own controls can't be hidden while paused, so they stay off
    (`controls: 0`). Subtitles go through the captions module
    (`loadModule`/`unloadModule`); `cc_load_policy` is only passed to turn
    them on, since any value turns the default track on.
- **Chapters.** The IFrame API doesn't expose chapters. `youtube_chapters`
  (Rust, `video_player.rs`) fetches the watch page and reads every
  `chapterRenderer` (the creator's chapters or YouTube's own). About one
  request in six gets a page without them (YouTube loads them separately
  there), so a page with none is fetched up to three times before the
  video counts as having none. The app keeps each video's chapters for the
  session; a failure only loses the chapters.
- **Pin glyph.** Its tip sits on the text's baseline on any line
  (`vertical-align` on `.cm-video-pin`, measured in
  `e2e/specs/youtube-pin-click.spec.js`'s probe).
- **Transcript.** `youtube_transcript` (Rust, `video_player.rs`) asks
  YouTube's player API as the Android app (`youtubei/v1/player`, client
  `ANDROID`): the watch page's caption links need a proof-of-origin token
  since 2025 and come back empty without one; the Android ones don't. It
  reads the chosen track's `srv3` file into cues (`start`, `text`).
  `lib/video-transcript.ts` builds the block; `video-transcript.ts` in the
  editor area inserts it at the top of the live editor (one read per note
  at a time) after checking the link is still the same. The player's
  `useTranscriptForNewLinks` and Library add (`use-library-add.ts`) call it.
- **Transcript box.** `html-block-decorations.ts` replaces a `<details>`
  block holding the transcript with `TranscriptWidget` unless a selection
  lies strictly inside it (`ignoreEvent` true,
  so CodeMirror leaves its clicks, keys and selection alone; the drag gate
  skips `.cm-transcript-widget`). The widget lazy-loads
  `transcript-box.tsx` (Arc `dropdown-menu` and `copy-button`), which reads
  the note's player from `lib/video-players.ts` every 250 ms while the box
  is on screen. Lines, their times and the clipboard text are pure
  (`transcriptLines`, `lineAt`, `transcriptText` in `lib/video-transcript.ts`).
  The Agent's moment is `videoMoments` in `agent-store.ts`.
- **Beside the video.** `video-player.tsx` renders a second box
  (`placement="beside"`) in the band from the toggle in the note's content
  (`transcriptSourceIn`), whenever the note has one and the box isn't
  folded, and marks the band `data-beside`. CSS alone picks which box shows:
  `[data-pane]` is the `pane` size container; at 900px or more the band
  becomes a two-column grid and the note's `.cm-transcript-widget` hides.
  The hidden box doesn't tick (its IntersectionObserver sees it off
  screen). The fold is `transcript-view.ts` (a zustand store kept in
  preferences), shared by both boxes.
- **Languages.** `youtube_caption_languages` lists the player response's
  caption tracks once per language (the creator's name over the automatic
  one's), English first; `youtube_transcript(videoId, language)` reads the
  track for a language (exact code, then same base language, then the
  automatic track, else the spoken track) and returns the code it read.
  `changeTranscriptLanguage` in `editor-area/video-transcript.ts` replaces
  the toggle's range (`transcriptRange`) in the live editor.
- **Pure text (`lib/video-pins.ts`).** Pin ids, parsing, time formatting,
  the insert plan for a pin at a caret, and the note's video id from
  frontmatter.
- **Players (`lib/video-players.ts`).** A registry of mounted players by note
  path, like `book-readers.ts`, plus the last-used player and pending seeks
  for a note that is still opening, and the armed auto pin (note, second,
  when). `video-pin.ts` routes both shortcuts and owns `videoAutoPin`, the
  editor plugin that stamps the first typed block.
- **The band (`components/editor-area/video-player.tsx`).** A sibling of the
  header in `EditorPane`, sticky inside the scroller. The mini player over
  the board is pure CSS on `[data-pane]:has(> .wr-board-inline)`: the
  scroller isn't positioned, so `position: absolute` anchors the band to
  the pane, outside the scroll.
- **Pin widget.** `block-embed.ts` stays the one owner of block-id
  decorations. A `yt-` id gets an atomic pin widget instead of being hidden
  or shown faintly.
- **Board:**
  - `board-video-links.ts` parses and opens the links;
  - `addPinToOpenBoard` lives in `board-fullscreen.ts`;
  - the canvas gets `addPin`;
  - `MindEl` gets `ln`;
  - `board-render.ts` draws the corner pin and leaves video links out of
    the whole-label link styling.

## Follow-ups

- A seek-back shortcut while typing.
- Pin widgets inside linked-block embeds on other pages (they show the id
  hidden today).
- Pins on a full-screen board (it hides the player).
- Other video hosts (Vimeo, local files).
- The agent sees the video's title and current time.
