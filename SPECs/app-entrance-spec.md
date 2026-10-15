# App entrance

When a Pensée window first paints its workspace (launch, a new workspace
window), the whole shell settles in as one piece instead of popping on.

## Decision

Decided 2026-10-15 from `apps/desktop/proto/entrance` (deleted), five
directions behind a picker with live sliders.

- **Direction: Settle.** The sidebar, tabs and editor arrive together, as one
  unit. No stagger and no brand splash.
- From `opacity: 0`, `translate: 0 6px`, `filter: blur(4px)` to rest.
- 360ms on `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`). Tokens:
  `--motion-enter`, `--enter-travel`, `--enter-blur` in `App.css`.
- Plays once, on `AppLayout`'s mount (`.app-enter`). Switching notes, spaces
  or tabs never replays it.
- Fill mode `backwards`: when it ends, the shell carries no filter or
  translate, so it doesn't become the containing block for fixed-position
  popovers.
- Clicks and typing work throughout; nothing waits on it.
- A guard (`ENTRANCE_GUARD_MS`, 1s, in `app-layout.tsx`) finishes it outright
  if it hasn't run by then. The window mounts hidden and is shown once startup
  resolves, and WebKit holds a hidden window's animation clock at the first
  frame, so a window that stays hidden would otherwise sit at opacity 0.
- Reduced motion: no animation, the window paints at rest.

## Rejected

Not picked. Each one's cost, as it was laid out in the comparison:

- **Cascade** (sidebar → tabs → title → paragraphs, 55ms stagger, 8px rise):
  the closest to Linear's marketing pages, but the last paragraph lands at
  about 800ms, and the chrome is choreographed on every launch.
- **Ink** (the chrome is already there; the title arrives word by word out of
  a blur, the body after it): the most editorial, but it animates the user's
  own words, and a long title takes over a second.
- **Maison** (the ¶ on the page ground, held, then dissolving into the app):
  the strongest brand moment, but it puts about a second of splash between
  the user and their notes on every launch.
- **Current** (no entrance): the baseline. The window pops on at rest.

## Code

- `apps/desktop/src/App.css`: the tokens, `@keyframes app-enter`, `.app-enter`
  and its reduced-motion rule.
- `apps/desktop/src/components/app-layout.tsx`: the shell's root carries
  `app-enter`.
- Journey WS-05 (`e2e/specs/journeys/workspace.spec.js`).
