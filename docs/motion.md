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

Tailwind utilities (`transition-colors`, `transition-transform`, ...) already resolve to `--ease-out` at 120ms. Do not add `duration-*` or `ease-*` classes unless the element genuinely needs a different token.

## JS-driven motion

When JavaScript has to drive an animation (the compact picker frame morph, the section rail's mount transition), its duration constant and easing must match the CSS token it runs alongside, with a comment naming the token. A mismatch makes CSS-driven and JS-driven parts of the same motion land at different times.

## Gestures today

- Sidebar edge: no animation at all. A resize drag follows the pointer and lands on the dragged width, and the collapse toggle (`Cmd+[`) snaps open and closed. Do not add a transition here; the edge moves a large layout region and any tween reads as lag.
- Block and column drag (`columns-decorations.ts`): the lift follows the pointer with no transition; on release it flies to its slot (or falls away when discarded) on the spring, and the displaced columns shift into place on the spring too.
- Block handle menu: no exit animation. It opens on hover and closes 60ms after the pointer leaves the grip-to-panel corridor. That grace is only jitter tolerance; do not raise it to cover pointer travel, which the corridor rect handles.
- Mermaid canvas pan and pinch zoom, file-tree drag: pure direct manipulation with no settle target, so no animation runs on release. Add a spring only if a settle target appears (snap-back, momentum, fly-to-drop).
- Board docking spark (`board-spark.ts`): the one ambient effect, and an exception to the 180ms rule. While a dock is offered the charge re-randomises every `CRACKLE_MS` (70ms) in a rAF loop, and on drop the current-flow plays for about 870ms (`PULSE_MS`, `TRACE_MS`, `FADE_MS`). Both are decoration over a finished state change: the cards and arrow are already in place, nothing waits on the animation, and it ignores pointer events. Both are skipped under `prefers-reduced-motion` (the charge is drawn still). Don't reuse this length for anything that gates interaction.
