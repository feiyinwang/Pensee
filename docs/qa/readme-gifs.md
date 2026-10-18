# README GIFs

The GIFs in `assets/readme/` are filmed from the debug e2e build on a made-up
vault, so they never show real notes, and can be filmed again after the UI
changes. Everything lives in `apps/desktop/e2e/readme-gifs/`:

| File                 | What it does                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `film.sh`            | Builds, seeds, films the scenes you name, stitches them and writes `assets/readme/<scene>.gif`                      |
| `scenes.spec.js`     | One `it("<scene>")` per GIF: `check`, `connect`, `pen`, `book`, `youtube`, `podcast`, `dock`                        |
| `seed-demo.mjs`      | Writes the "Pensée demo" vault into `~/Library/Application Support/com.pensee.app.e2e` and clears the saved session |
| `make-book-pdf.py`   | Writes the book's PDF: rules 13–14 of Strunk's _The Elements of Style_ (1918, public domain)                        |
| `reading-slowly.pdf` | The demo paper in the Library                                                                                       |
| `stitch.py`          | Turns a scene's frames into a GIF at their real pace, with one shared palette                                       |

## Filming

Filming takes over the screen: the app comes to front for each step, and
whatever you type or click while it runs lands in the note. Leave the keyboard
and mouse alone until it prints the last GIF. An agent asks the user before it
starts a run.

```bash
apps/desktop/e2e/readme-gifs/film.sh pen book
```

- `--no-build` reuses the last debug build (the frontend is unchanged);
  `PENSEE_E2E_APP=<…/MacOS/desktop>` films another checkout's build.
- `--stitch-only <scene>` re-stitches the frames of the last run without
  filming, to try another crop or cut.
- `all` films every scene.

Each scene gets a fresh seed and its own app launch. Frames stay in
`$TMPDIR/pensee-readme-gifs/<scene>/` (set `FRAMES` to change it). The
crop and cut for each scene are in `stitch_args` in `film.sh`. A crop is
either CSS pixels or `@name`, a box the spec measured with `saveRegion()`
(YouTube and the podcast: the player and the lines under it), so it holds
whatever the layout or screen scale was. `--until <mark>` cuts where the spec
called `mark("<mark>")`: the YouTube and podcast GIFs stop before the pin click. The
YouTube scene scrolls the note's title and properties away first, so the
video sticks to the top and the lines being written show under it.
The `check`, `connect` and `pen` scenes ask the AI, so they need the Claude
this Mac is signed in to.
The GIFs follow the Mac's light or dark appearance.

Look at every GIF before committing it. The spec logs each note's final text
(`FINAL …`) so you can check what was written.

## Traps

Learned on 2026-10-18, filming the GIFs the README has now.

- **A window in the background paints no frames.** Its columns stay at
  opacity 0 and the reader's Highlight pill never shows. `film()` and every
  step that clicks or types call `front()` first.
- **Typing a word a frame stutters.** A screenshot takes 100–400ms, so a
  word per frame shows the text in jumps with stalls between. `typeLive()`
  types two letters a frame and stamps each frame 70ms after the last,
  whatever the screenshot took, so the GIF types at an even pace.
- **Your own keys leak in.** With the window in front, real keystrokes (an
  IME too) go into the note and garble it. Hands off.
- **Activating the window collapses a scripted PDF selection.** Bringing it to
  front hands focus back to the note's editor, which puts its caret over the
  selection. Order: `front()`, blur the active element, then select and send
  the `mouseup` in one `execute` (the `book` scene).
- **Scripted clicks don't move column focus.** Dispatch a `pointerdown` on the
  note's `.tab-column` before clicking into it.
- **Enter in the middle of a line with a hidden id splits it before the id.**
  Lines ending in `^bk-…` or `^yt-…` hide the id; press End before Enter.
- **Frame size depends on the screen, and can change mid-run.** The window is
  set to 2880×1800 device pixels, but runs came out 4112×2580 on a screen
  scaled further, one switching partway through a scene. Crops are in CSS
  pixels, and `stitch.py` scales each frame by its own width over the
  `viewport.json` the spec writes beside the frames.
- **The layout isn't the same from run to run.** The sidebar may or may not
  show, and a note may open scrolled or not, so a fixed crop can miss. Crop
  to a box the spec measures (`@notes`).
- **One palette for every frame.** A palette per frame makes each frame store
  every pixel again (book GIF: 3.1 MB). A shared palette lets unchanged pixels
  keep their index (0.28 MB).
- Only one WebDriver run per machine: `film.sh` stops if a QA run is going or
  an e2e app holds port 4445 ([qa-checklist.md](./qa-checklist.md) harness
  notes).
