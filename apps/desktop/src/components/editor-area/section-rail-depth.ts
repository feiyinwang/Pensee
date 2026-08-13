// Depth-axis maths for the section rail, kept free of React/Tauri/CSS imports
// so it can be unit tested on its own.

// Ticks encode *depth* on the width axis, so the active/inactive distinction
// can no longer live there too — one axis cannot carry two variables. Active
// state rides opacity instead, with only a token scale nudge left behind.
export const TICK_WIDTH_BY_DEPTH = [20, 17, 15, 13, 12, 11];
export const TICK_MAX_WIDTH = TICK_WIDTH_BY_DEPTH[0];
export const TICK_INACTIVE_SCALE = 0.88;

// The popover is a fixed 260px and every row truncates, so indenting all six
// levels would leave H6 as mostly ellipsis. Only DEPTH_WINDOW tiers are told
// apart at a time; the window slides along the depth axis instead.
export const INDENT_STEP = 12;
export const DEPTH_WINDOW = 3;

export function tickWidthForDepth(depth: number) {
  return TICK_WIDTH_BY_DEPTH[Math.min(Math.max(depth, 0), TICK_WIDTH_BY_DEPTH.length - 1)];
}

// Rows outside the window are *flattened*, never clipped: a heading you cannot
// read is worse than a heading whose depth you cannot tell.
export function indentForDepth(depth: number, windowStart: number) {
  return Math.min(Math.max(depth - windowStart, 0), DEPTH_WINDOW - 1) * INDENT_STEP;
}

// Lazy slide: the window only moves when the active heading falls outside it.
// Recentering on every scroll (windowStart = activeDepth - 1) would make rows
// twitch sideways continuously; this *is* the debounce, no timer needed. A doc
// no deeper than the window can never slide, so shallow docs pay nothing.
export function nextWindowStart(current: number, activeDepth: number | null, maxDepth: number) {
  if (activeDepth === null) return 0;
  const limit = Math.max(0, maxDepth - (DEPTH_WINDOW - 1));
  let next = current;
  if (activeDepth < next) next = activeDepth;
  else if (activeDepth > next + (DEPTH_WINDOW - 1)) next = activeDepth - (DEPTH_WINDOW - 1);
  return Math.min(Math.max(next, 0), limit);
}
