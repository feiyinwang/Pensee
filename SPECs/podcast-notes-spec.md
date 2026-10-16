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
  tab's **+**, and ⌘F's **Add to Library** rows. The note is where the
  episode plays, so there is no "Added … Open" step in between. Other kinds
  are unchanged: ⌘↵ stays on the page and offers **Open**.
- The episode does not start on its own. ⌘S starts it.

### Which notes play

- A note whose `Type` is `Podcast` and whose `url`, `link` or `source` holds
  a web address.
- Any note whose link is a podcast app's episode (Apple Podcasts, Spotify
  episodes and shows, Overcast, Pocket Casts) or an audio file (`.mp3`,
  `.m4a`, `.aac`, `.ogg`, `.opus`, `.wav`, `.flac`).
- A YouTube link is always the video player's.

### Finding the episode

The player plays the episode's audio file in a plain `<audio>` element and
shows its artwork, title and show, all found from the link once per launch
(`podcast_episode`, `src-tauri/src/commands/podcasts.rs`). The artwork is
found even when the audio isn't, so a Spotify-only episode still shows whose
it is. The audio:

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

The artwork, title and show:

- Apple: the episode's entry in Apple's directory (`artworkUrl600`, else the
  show's), its `trackName` and `collectionName`; a show link, the show's;
- Spotify: the page's `og:image` (the episode's artwork), with the title and
  show read for the audio;
- any other page: `og:image`, `og:title`, and `og:site_name` as the show
  unless it names a podcast app (Apple Podcasts, Overcast, Pocket Casts…);
- an audio file has none: the card shows the note's name and the link's host.

A YouTube link is the video player's, so its "thumbnail" is the video itself.
In Library a Podcast note with a YouTube link shows the video's thumbnail as
its cover, and **Get cover** saves it, the same as a video's.

### The player

Under the properties, on the text column: a card, laid out like a music
player.

- **Artwork** on the left, 104px square: the note's own `Cover:` if it has
  one, else the episode's artwork. A plain tile with a microphone shows while
  it loads (the picture fades in) and stays when there is none. The whole
  picture always shows, never cropped: artwork that isn't square sits over a
  blurred, dimmed copy of itself that fills the rest of the square.
- **Title and show** beside it, one line each, cut with an ellipsis (the
  whole text on hover). Until the episode is found: the note's name and where
  the link points ("Spotify", "Apple Podcasts", or the host).
- **Transport** to the right of the title: back 15 s, play/pause, ahead 30 s,
  the skips podcast apps use (re-hear a line; jump an ad). Play and pause
  swap in place with a short fade; hovering play shows _Play_ / _Pause_ and
  its keys, ⌘ S, while paused.
- **Timeline** under them: the time, the track, the length. The track fills
  to the playhead; its knob shows on hover or keyboard focus. Dragging or
  clicking seeks.
- **Speed and volume** along the bottom. There is no Pin button: under the
  card, outside it and ending on its edge, a line names every key in full,
  each a label then its key as in a YouTube note's row: **Play ⌘S** while
  paused (**Pin ⌘S** while playing, since ⌘S pins then), **Slower ⇧,**,
  **Faster ⇧.**. Speed: a click
  cycles 1× → 1.25× → 1.5× → 1.75× → 2× → 1×; **⇧, / ⇧.** step through 0.5×–3× (0.5,
  0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3) the same way they step a video's.
  Volume: the speaker mutes and unmutes (back to the last volume), the slider
  sets it. Speed and volume are remembered across episodes and launches
  (`localStorage` `writer.podcast-player`).
- One episode per note, so there is no playlist (the reference player's
  queue): the note's pins are its list of moments.
- Sticky at the top of the note once the properties scroll away, on the same
  frosted band as the video player, at the same size (nothing jumps). Over a
  board it is the 320px mini player in the top-right corner: 64px artwork,
  no show line, no skips, volume down to its mute button.
- While the episode is found, the timeline says "Finding the episode…" and
  play is dimmed; ⌘S pressed meanwhile plays it once found. If it can't be
  found or won't load, the timeline's place says why, the transport goes,
  and **Open link** takes the place of the bottom row.
- Clicking the card's buttons never takes focus from the note.

### Shortcuts and pins

The podcast player joins the video players' registry (`lib/video-players.ts`),
so everything the YouTube spec says about players holds for it:

- **⌘S** while it is paused plays the focused note's episode, else the one
  on screen, else the last one used; while it plays, ⌘S pins and pauses.
- **⌘S** / **Pin** stamps the block at the caret with the moment playing
  (`^yt-<seconds>`, the same id as a video pin); clicking the pin plays from
  there. With a board open it adds the moment to the board.
- Words typed soon after a pause pin a little before the pause.

## Not yet

- Remembering where you stopped in an episode after its note closes.
- A dropped audio file (it would need copying into the vault).
