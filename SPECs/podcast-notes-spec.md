# Podcast Notes Spec

## Goal

Listen to a podcast episode inside its note and take notes while it plays,
the same way as a YouTube note
([youtube-notes-spec.md](youtube-notes-spec.md)): one shortcut plays and
pauses, one pins the moment on the line you're writing.

## Behavior

### Adding a podcast opens it

- Adding a podcast link to Library opens its note right away, from
  everywhere it can be added: the composer (⌘↵ as well as ⌘⇧↵), a Library
  tab's **+**, and ⌘O's **Add to Library** rows. The note is where the
  episode plays, so there is no "Added … Open" step in between. Other kinds
  are unchanged: ⌘↵ stays on the page and offers **Open**.
- The episode does not start on its own. ⌘⇧J starts it.

### Which notes play

- A note whose `Type` is `Podcast` and whose `url`, `link` or `source` holds
  a web address.
- Any note whose link is a podcast app's episode (Apple Podcasts, Spotify
  episodes and shows, Overcast, Pocket Casts) or an audio file (`.mp3`,
  `.m4a`, `.aac`, `.ogg`, `.opus`, `.wav`, `.flac`).
- A YouTube link is always the video player's.

### Finding the audio

The player plays the episode's audio file in a plain `<audio>` element, so it
is found from the link once per launch (`podcast_audio`,
`src-tauri/src/commands/podcasts.rs`):

- an audio file is played as it is;
- an Apple Podcasts episode (`…/id<show>?i=<episode>`) is looked up by its
  id in Apple's directory (`itunes.apple.com/lookup`, the show's latest 200
  episodes), else read from the episode page's `streamUrl`;
- a Spotify episode names no audio (its `og:audio` is a 30-second preview).
  The page gives the episode's title and show ("Listen to this episode from
  <show> on Spotify"). The show is searched in Apple's directory, and the
  episode matched by title in its latest episodes, then in its RSS feed.
  Titles match ignoring case, spaces and punctuation, or when one contains
  the other (16+ letters). A show that is only on Spotify can't be found;
- any other page: its `og:audio` / `twitter:player:stream`, else its first
  `<audio>` (or audio `<source>`), else a `streamUrl`-like key in its data.

A show's link (no episode) says so: "This links to a show. Link one of its
episodes to play it."

### The player

- Under the properties, on the text column: a card with play/pause, the
  time, the track, the length, the speed and **Pin ⌘⇧M**. Sticky at the top
  of the note once the properties scroll away, on the same frosted band as
  the video player. Over a board it is the same 320px mini player in the
  top-right corner.
- No title or cover in the bar: the page's own title and properties show
  them.
- While the audio is found, the bar says "Finding the episode…" and play is
  dimmed; ⌘⇧J pressed meanwhile plays it once found. If it can't be found or
  won't load, the bar says why and offers **Open link**.
- The track fills to the playhead; its knob shows on hover or keyboard
  focus. Dragging or clicking seeks.
- Speed: a click cycles 1× → 1.25× → 1.5× → 1.75× → 2× → 1×. **`<` / `>`**
  step through 0.5×–3× (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3) the same
  way they step a video's. The speed is remembered across episodes and
  launches (`localStorage` `writer.podcast-player`).
- Clicking the bar's buttons never takes focus from the note.

### Shortcuts and pins

The podcast player joins the video players' registry (`lib/video-players.ts`),
so everything the YouTube spec says about players holds for it:

- **⌘⇧J** plays or pauses the focused note's episode, else the one on screen,
  else the last one used.
- **⌘⇧M** / **Pin** stamps the block at the caret with the moment playing
  (`^yt-<seconds>`, the same id as a video pin); clicking the pin plays from
  there. With a board open it adds the moment to the board.
- Words typed soon after a pause pin a little before the pause.

## Not yet

- Remembering where you stopped in an episode after its note closes.
- A dropped audio file (it would need copying into the vault).
