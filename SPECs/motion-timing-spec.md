# Motion Timing Spec

## Summary

Audit every animation in the desktop app and bring it under one set of motion tokens: ease-out under 180ms for click- and state-driven motion, springs for gesture settles, and a global 0.97 press scale on buttons.

## Problem

Durations and curves were chosen per component. The compact picker morphed over 260ms on an ease-in-out curve, section rail ticks eased _in_ over 300ms, popover rows faded colour over 300ms, and Tailwind's default `transition-*` utilities used its 150ms ease-in-out curve. The app read as sluggish, and nothing pressed in under the pointer.

## Design

- Tokens in `App.css`: `--ease-out`, `--ease-spring`, `--motion-fast`, `--motion-base`, `--motion-settle`. Tailwind's `--default-transition-duration` and `--default-transition-timing-function` point at them so utility classes inherit the rule without per-call-site changes.
- The spring is a `linear()` easing sampled from a damped spring (stiffness 2000, damping ratio 0.8, ~180ms settle, 1.5% overshoot), gated behind `@supports` so WebKit without `linear()` falls back to ease-out.
- Press feedback is a base-layer `button:not(:disabled):active { scale: 0.97 }`. Tailwind's `transition-colors` and `transition-opacity` get `scale` appended in the utilities layer so buttons using them still ease the press.
- JS-driven animations (compact picker morph, section rail mount transition, mermaid fullscreen teardown timer) keep constants that mirror the CSS tokens, with comments naming the token.

## Out of scope

- `prefers-reduced-motion` handling.
- Springs for gestures with no settle target (mermaid pan/zoom, tree drag). See `docs/motion.md`.
