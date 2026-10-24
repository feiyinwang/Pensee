# App entrance

When a Pensée window first paints its workspace (launch, a new workspace
window), the app icon from the Dock settles in on the page, its ¶ is written,
`PENSÉE` is written under it, and the splash dissolves into the app. A click
or a key skips straight to that last step.

## Decision

Decided 2026-10-16 from `apps/desktop/proto/entrance` (deleted), over three
rounds behind a picker with live sliders:

1. Settle shipped first (2026-10-15), a quiet fade of the whole shell.
2. The user asked for a Maison-like brand splash; **Stroke** shipped (the
   display-cut ¶ written, PENSÉE under it).
3. The user asked for an option with the app's Dock icon, then for the
   options to be tuned against Emil's animation rules, and picked **Icon,
   written** with the tightened values and skip on input.

What ships:

- A splash on the canvas ground covers the window. On it, the app icon
  exactly as the Dock shows it (`assets/brand/app-icon.svg`): an Ink
  squircle, 128px, radius 22.45% (rx 185 on the 824 body), falling off from
  `#1e1e1e` at the top, with the small-cut ¶ in Cream at 64.1% of its width.
  Its colours are the icon's in both themes.
- `PENSÉE` under it in Bodoni Moda at 0.2× the icon (25.6px), tracked 0.2em,
  0.3× the icon below it; Ink on light grounds, Cream on dark
  (`--color-brand-mark`).
- Timeline (1.28s):
  - 0–240ms: the tile settles in (opacity, 96% → 100%, a 2px blur clearing)
    on `--ease-out` (`--motion-enter-icon`).
  - 160–640ms: the ¶ is written inside it, left to right (`clip-path`,
    `--motion-enter-write`, `--enter-mark-delay`).
  - 320–800ms: the wordmark is written the same way (`--enter-word-delay`).
  - Hold to 1000ms (`--enter-hold`, 200ms).
  - 1000–1280ms: the splash fades while the shell scales from 98.5% to full
    size (`--motion-enter-reveal`, 280ms).
- Two curves, from the emil-animations review: the writing is in-out
  (`--ease-enter-write`, `cubic-bezier(0.65, 0, 0.35, 1)`), a pen's pace on
  something already on screen; the reveal is the app entering, so it eases
  out (`--ease-enter-reveal`, ease-out quart `cubic-bezier(0.165, 0.84, 0.44,
1)`) and runs faster than the writing.
- **Skip on input.** A pointerdown or keydown anywhere during the splash
  finishes the tile and the writing and starts the reveal at once. The reveal
  still plays (280ms), so the app doesn't cut in. The click or key reaches the
  app as usual: the listeners are on the capture phase and don't stop it.
- The splash ignores the pointer, is hidden from assistive tech, and unmounts
  once it has faded.
- Plays once, on the workspace layout's mount (`AppSplash` and `.app-enter`).
  Switching notes, spaces or tabs never replays it. The compact single-file
  window has no splash.
- The shell's fill is `backwards`: when it ends, no transform stays on it to
  make it the containing block for fixed-position popovers.
- A guard (`ENTRANCE_GUARD_MS`, 3s, in `app-splash.tsx`) finishes the
  entrance and unmounts the splash if it hasn't ended by then. The window
  mounts hidden and is shown once startup resolves; WebKit holds a hidden
  window's animation clock at the first frame and sends no `animationend`,
  so a window that stays hidden would otherwise keep the splash up.
- Reduced motion: no splash and no animation; the window paints at rest.

### The animation review (emil-animations)

| Before (round 3 as first built)          | After                              | Why                                                                        |
| ---------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| 1.72s from launch to settled             | 1.28s                              | The app opens several times a day; the holds were waiting, not information |
| Tile in 280ms, ¶ writing from 200ms      | 240ms, from 160ms                  | Modal-sized enters stay under 300ms                                        |
| Write 560ms, wordmark at 420ms           | 480ms, at 320ms                    | Still read as handwriting, with less dead time between the two             |
| Hold 360ms                               | 200ms                              | Long enough to register the mark                                           |
| Reveal 380ms on the in-out writing curve | 280ms on ease-out quart            | The reveal is an enter: ease-out, and faster than the writing              |
| Plays to the end whatever you do         | A click or key skips to the reveal | Someone who reaches for the app has already decided                        |

Checked and unchanged: only opacity, transform (`scale`) and `clip-path` on a
small element animate; nothing enters from `scale(0)` (96%); the blur is
2px; there is a reduced-motion path.

## Rejected

Not picked. Each one's cost, as it was laid out in the comparison.

Round 3 (from the app icon):

- **Stroke** (shipped in round 2): the display-cut ¶ alone, not the icon
  people see in the Dock.
- **Icon** (the tile settles in, holds, dissolves): the shortest (0.82s), but
  nothing is made in front of you.
- **Icon, opening** (the tile grows past the window and dissolves, like an app
  opening from the Dock): 0.8s, but the zoom upscales the tile, which softens
  as it grows.

Round 2 (brand splashes):

- **Maison** (the ¶ fades up, holds, dissolves): only a fade.
- **Lockup** (the letters close up from wide tracking): the closing letters
  are the motion, not the ¶.
- **Depth** (you pass through the ¶): the mark blurs as it leaves.
- **Curtain** (an Ink ground lifts away): it flashes black over a light-theme
  window on every launch.

Round 1:

- **Settle** (the shell fades in, rises 6px and sharpens, 360ms): quiet and
  fast, but no brand moment, which was what was wanted.
- **Cascade** (sidebar → tabs → title → paragraphs): about 800ms, and the
  chrome is choreographed on every launch.
- **Ink** (the title arrives word by word): it animates the user's own words.
- **Current** (no entrance): the window pops on at rest.

## Code

- `apps/desktop/src/components/app-splash.tsx`: the splash, skip on input, the
  guard, and the unmount once faded.
- `apps/desktop/src/components/app-layout.tsx`: the shell carries `app-enter`;
  `AppSplash` renders beside it (not inside, or the shell's scale would carry
  it).
- `apps/desktop/src/App.css`: the timing tokens, the keyframes, and the
  reduced-motion rule.
- `apps/desktop/src/styles/tokens.css`: `--brand-ink`, `--brand-cream`,
  `--brand-ink-raised`, `--shadow-tile`; `--color-brand-mark`,
  `--color-app-icon-*`, `--shadow-app-icon`.
- Journeys WS-05, WS-06 (`e2e/specs/journeys/workspace.spec.js`).
