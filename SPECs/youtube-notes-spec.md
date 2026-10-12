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
- The player sits under the properties, the full width of the text column,
  16:9, and no taller than 38% of the pane. It is sticky: once the
  properties scroll away, it stays at the top of the note and the notes
  scroll beneath it. The band behind it has the page's background, so no
  text shows through around the video.
- Under the video is one row with a **Pin** button and its shortcut (⌘⇧M).
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
- **Pinning** (⌘⇧M or **Pin**) uses the video's current time and acts on the
  note's caret:
  - On an empty line, the line becomes `- ` plus the pin.
  - On an empty bullet, the bullet gets the pin.
  - On a block with text and no id, that block gets the pin, so a note
    written first can be pinned afterwards.
  - On a block that already has an id, a new bullet goes under it at the
    same indent, with the pin.
  - The caret ends on the pinned line, ready to type. When focus was
    elsewhere, the note's last caret position is used.

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
    `{source:"writer-yt", type:"state"|"error", t, playing}` to its parent:
    on ready, on every state change, and every 500ms while playing. It takes
    `{cmd:"seek", t}`, `{cmd:"play"}` and `{cmd:"pause"}` back.
- **Pure text (`lib/video-pins.ts`).** Pin ids, parsing, time formatting,
  the insert plan for a pin at a caret, and the note's video id from
  frontmatter.
- **Players (`lib/video-players.ts`).** A registry of mounted players by note
  path, like `book-readers.ts`, plus the last-used player and pending seeks
  for a note that is still opening. It also routes the shortcut.
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

- Play, pause and seek-back shortcuts while typing.
- Pin widgets inside linked-block embeds on other pages (they show the id
  hidden today).
- Pins on a full-screen board (it hides the player).
- Other video hosts (Vimeo, local files).
- The agent sees the video's title and current time.
