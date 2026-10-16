# Motion

Rules for any animation in the desktop app. Tokens live in `apps/desktop/src/App.css`.

## Rules

- Click- or state-driven motion (open/close, reveal, toggles) uses `--ease-out` and finishes in under 180ms.
- Hover highlights on menu rows and tiles use `--ease-hover` at `--motion-hover`. The pointer is already on the row, so the fill has to land at once; 100ms on the ease-out curve read as lag in the block handle menu.
- Gesture-driven elements follow the pointer with no transition while the gesture is active, then settle on `--ease-spring`.
- Every real `<button>` presses in to `scale: 0.97` while active. This is global; do not re-add it per component.
- No new `@keyframes`, `ease`, `ease-in`, `ease-in-out`, or literal millisecond values in component CSS or inline styles. Reference a token.

## Tokens

| Token             | Value                                                   | Use                                                                                                              |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--ease-out`      | `cubic-bezier(0.16, 1, 0.3, 1)`                         | Every non-gesture transition. Also Tailwind's default `transition-*` timing function and its `ease-out` utility. |
| `--ease-spring`   | `linear(...)` spring, stiffness 2000, damping ratio 0.8 | Gesture release settles. Falls back to `--ease-out` on WebKit without `linear()`.                                |
| `--motion-fast`   | 100ms                                                   | Colour, opacity, press feedback. Tailwind's default `transition-*` duration is 120ms.                            |
| `--motion-hover`  | 50ms                                                    | Hover fill on menu rows and tiles. Paired with `--ease-hover`.                                                   |
| `--ease-hover`    | `ease`                                                  | Hover fills only. A flat colour change has nothing to overshoot into, so the plain curve is fine here.           |
| `--motion-base`   | 160ms                                                   | Open/close, reveal, layout moves.                                                                                |
| `--motion-settle` | 180ms                                                   | Duration paired with `--ease-spring`.                                                                            |
| `--motion-enter-icon`, `--motion-enter-write`, `--motion-enter-reveal` | 240ms, 480ms, 280ms | The launch splash only (`AppSplash`): the app icon settling in, its ¶ and the wordmark being written, then the reveal. With `--enter-mark-delay` 160ms, `--enter-word-delay` 320ms, `--enter-hold` 200ms, `--ease-enter-write` (in-out cubic) and `--ease-enter-reveal` (ease-out quart). |

Tailwind utilities (`transition-colors`, `transition-transform`, ...) already resolve to `--ease-out` at 120ms. Do not add `duration-*` or `ease-*` classes unless the element genuinely needs a different token.

## JS-driven motion

When JavaScript has to drive an animation (the compact picker frame morph, the section rail's mount transition), its duration constant and easing must match the CSS token it runs alongside, with a comment naming the token. A mismatch makes CSS-driven and JS-driven parts of the same motion land at different times.

## Gestures today

- Sidebar edge: no animation at all. A resize drag follows the pointer and lands on the dragged width, and the collapse toggle (`Cmd+[`) snaps open and closed. Do not add a transition here; the edge moves a large layout region and any tween reads as lag.
- Block and column drag (`columns-decorations.ts`): the lift follows the pointer with no transition; on release it flies to its slot (or falls away when discarded) on the spring, and the displaced columns shift into place on the spring too.
- Block handle menu: no exit animation. It opens on hover and closes 60ms after the pointer leaves the grip-to-panel corridor. That grace is only jitter tolerance; do not raise it to cover pointer travel, which the corridor rect handles.
- Board pinch zoom (`zoomGesture` in `board-canvas.ts`): the preview follows the fingers with no transition. Past a zoom limit it stretches (`stretchZoom`, at most 15%), and once the pinch rests it springs back to the limit on `--ease-spring` over `--motion-settle` (`ZOOM_SPRING_MS`), then commits. Instant under reduced motion.
- Mermaid canvas pan and pinch zoom, file-tree drag: pure direct manipulation with no settle target, so no animation runs on release. Add a spring only if a settle target appears (snap-back, momentum, fly-to-drop).
- App entrance (`AppSplash` and `.app-enter`, `SPECs/app-entrance-spec.md`): an exception to the 180ms rule. When a window first paints its workspace, a splash on the canvas ground shows the app icon as the Dock does: the tile settles in (`--motion-enter-icon` on `--ease-out`), its ¶ is written left to right (`clip-path`, `--motion-enter-write` on `--ease-enter-write`, the one in-out entrance curve: a pen's pace on something already on screen), then `PENSÉE` under it, a `--enter-hold`, then the splash fades over `--motion-enter-reveal` on `--ease-enter-reveal` (ease-out, faster than the writing) while the shell scales from 98.5% to full size. 1.28s in all. A click or key during it skips to the reveal (the reveal still plays). It plays once per mount, never on note, space or tab changes; the splash ignores the pointer, and unmounts once faded. The shell's fill is `backwards`, so no transform stays on it (one would make it the containing block for fixed popovers). None under reduced motion. `ENTRANCE_GUARD_MS` (3s, `app-splash.tsx`) finishes it and unmounts the splash if it hasn't ended, since a hidden window holds it at its first frame and sends no `animationend`. Don't add a second page-level entrance elsewhere.
- Board docking glow (`board-spark.ts`, `SPECs/board-docking-glow-spec.md`): the one ambient effect, and an exception to the 180ms rule. While a dock is offered, the lit card's halo breathes once a beat (`BEAT_MS`, 1600ms) in a rAF loop that only sets attributes, and at each peak a ring goes out from its port (960ms on `--ease-out`). On drop the cards glide from where they were let go into their slots (`GLIDE_MS`, 180ms, matching `--motion-settle`, on `--ease-out`, the spring's fallback curve) while the new arrow firms up; then a dot runs the arrow (220ms), the docked card's halo flares (120ms) and settles (480ms), and one ring plays (380ms): about 780ms in all. It decorates a finished state change: the cards and arrow are already in place, nothing waits on it, it ignores pointer events, and a press during the glide puts the cards at rest at once. Under `prefers-reduced-motion` the offer is drawn still and nothing plays on drop. Don't reuse this length for anything that gates interaction.
- Todo check celebration (`lib/prosemark-core/list/task-celebration.ts`): the one other exception to the 180ms rule. Toggling a task to `[x]` pops the box (`POP_MS`, 400ms), draws the tick in (`TICK_MS`) and bursts six dots outward (`BURST_MS`, 500ms), all WAAPI on `--ease-out`. It is started by the toggle transaction, never by a render, so opening or scrolling a note of checked todos stays still; unchecking plays nothing. Like the docking glow it decorates a finished change and ignores pointer events, and it is skipped under `prefers-reduced-motion`.
- List guides (`list/tree-rail.ts`): nothing travels. The guide of the list you are in darkens with a plain hover colour change (`--motion-hover` on `--ease-out`); the gliding accent run it replaced was removed on 2026-10-14. Instant under reduced motion.
