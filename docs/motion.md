# Motion

Rules for any animation in the desktop app. Tokens live in `apps/desktop/src/App.css`.

## Rules

- Click- or state-driven motion (open/close, reveal, hover, toggles) uses `--ease-out` and finishes in under 180ms.
- Gesture-driven elements follow the pointer with no transition while the gesture is active, then settle on `--ease-spring`.
- Every real `<button>` presses in to `scale: 0.97` while active. This is global; do not re-add it per component.
- No new `@keyframes`, `ease`, `ease-in`, `ease-in-out`, or literal millisecond values in component CSS or inline styles. Reference a token.

## Tokens

| Token             | Value                                                   | Use                                                                                                              |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--ease-out`      | `cubic-bezier(0.16, 1, 0.3, 1)`                         | Every non-gesture transition. Also Tailwind's default `transition-*` timing function and its `ease-out` utility. |
| `--ease-spring`   | `linear(...)` spring, stiffness 2000, damping ratio 0.8 | Gesture release settles. Falls back to `--ease-out` on WebKit without `linear()`.                                |
| `--motion-fast`   | 100ms                                                   | Colour, opacity, press feedback. Tailwind's default `transition-*` duration is 120ms.                            |
| `--motion-base`   | 160ms                                                   | Open/close, reveal, layout moves.                                                                                |
| `--motion-settle` | 180ms                                                   | Duration paired with `--ease-spring`.                                                                            |

Tailwind utilities (`transition-colors`, `transition-transform`, ...) already resolve to `--ease-out` at 120ms. Do not add `duration-*` or `ease-*` classes unless the element genuinely needs a different token.

## JS-driven motion

When JavaScript has to drive an animation (the compact picker frame morph, the section rail's mount transition), its duration constant and easing must match the CSS token it runs alongside, with a comment naming the token. A mismatch makes CSS-driven and JS-driven parts of the same motion land at different times.

## Gestures today

- Sidebar resize: `transition: none` during the drag, spring settle on release. The collapse toggle shares the spring so the edge always moves the same way.
- Mermaid canvas pan and pinch zoom, file-tree drag: pure direct manipulation with no settle target, so no animation runs on release. Add a spring only if a settle target appears (snap-back, momentum, fly-to-drop).
