# App entrance

When a Pensée window first paints its workspace (launch, a new workspace
window), the brand ¶ is written on the page, `PENSÉE` under it, and the splash
dissolves into the app.

## Decision

Decided 2026-10-16 from `apps/desktop/proto/entrance` (deleted), in two rounds
behind a picker with live sliders. Settle shipped first (2026-10-15); the user
then asked for a Maison-like entrance, a brand splash, and picked **Stroke**
from the second round, with the wordmark added under it and the mark made
bigger.

- **Direction: Stroke.** A splash on the canvas ground covers the window. The
  ¶ (display cut) is written left to right, like the one stroke of a pen,
  then `PENSÉE` is written the same way under it. Both hold, then the splash
  fades out while the shell settles from 98.5% to full size.
- The mark is 84px wide (the first round drew it at 58px, which read as too
  small). The wordmark is Bodoni Moda at 0.34× the mark's width, tracked
  0.2em, 0.36× the mark's width below it: the stacked lockup in
  `docs/brand.md`.
- Ink on light grounds, Cream on dark (`--color-brand-mark`, from
  `--brand-ink` and `--brand-cream` in `tokens.css`).
- Timeline, all on `cubic-bezier(0.65, 0, 0.35, 1)` (`--ease-enter`, in-out:
  the stroke is drawn at a pen's pace):
  - 0–560ms: the ¶ is written (`--motion-enter-write`, `clip-path` from the
    right edge).
  - 200–760ms: the wordmark is written (`--enter-word-delay`, set to 200ms by
    the user from 380ms).
  - Hold to 1120ms (`--enter-hold`, 360ms).
  - 1120–1500ms: the splash fades and the shell scales up
    (`--motion-enter-reveal`, 380ms; `--enter-reveal-at` is the start).
- The splash ignores the pointer, so clicks reach the app under it the whole
  time. It is hidden from assistive tech and unmounts once it has faded.
- Plays once, on the workspace layout's mount (`AppSplash` and `.app-enter`).
  Switching notes, spaces or tabs never replays it. The compact single-file
  window has no splash.
- The shell's fill is `backwards`: when it ends, no transform stays on it to
  make it the containing block for fixed-position popovers.
- A guard (`ENTRANCE_GUARD_MS`, 3s, in `app-splash.tsx`) finishes the
  entrance outright if it hasn't run by then. The window mounts hidden and is
  shown once startup resolves, and WebKit holds a hidden window's animation
  clock at the first frame, so a window that stays hidden would otherwise keep
  the splash up.
- Reduced motion: no splash and no animation; the window paints at rest.

## Rejected

Not picked. Each one's cost, as it was laid out in the comparison.

Round 2 (brand splashes):

- **Maison** (the ¶ fades up, holds, dissolves): the quietest splash, but
  only a fade; nothing about the mark is shown being made.
- **Lockup** (¶ over the wordmark, the letters closing up from wide
  tracking): the most fashion-house, but the closing letters are the motion,
  not the ¶.
- **Depth** (the ¶ comes toward you and you pass through it into the app):
  the most cinematic, but zooming through the mark blurs it as it leaves.
- **Curtain** (Cream ¶ on an Ink ground that lifts away): the boldest, but it
  flashes black over a light-theme window on every launch.

Round 1 (shipped as Settle, then replaced):

- **Settle** (the whole shell fades in, rises 6px and sharpens, 360ms): quiet
  and fast, but no brand moment, which was what was wanted.
- **Cascade** (sidebar → tabs → title → paragraphs, 55ms stagger): the last
  paragraph lands at about 800ms, and the chrome is choreographed on every
  launch.
- **Ink** (the title arrives word by word out of a blur): it animates the
  user's own words, and a long title takes over a second.
- **Current** (no entrance): the window pops on at rest.

## Code

- `apps/desktop/src/components/app-splash.tsx`: the splash, its guard, and its
  unmount once faded.
- `apps/desktop/src/components/app-layout.tsx`: the shell carries `app-enter`;
  `AppSplash` renders beside it (not inside, or the shell's scale would carry
  it).
- `apps/desktop/src/App.css`: the timing tokens, the keyframes, and the
  reduced-motion rule.
- `apps/desktop/src/styles/tokens.css`: `--brand-ink`, `--brand-cream`,
  `--color-brand-mark`.
- Journey WS-05 (`e2e/specs/journeys/workspace.spec.js`).
