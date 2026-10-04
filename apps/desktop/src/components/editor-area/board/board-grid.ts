/**
 * The board's background grid levels. The grid itself is a CSS background
 * on its own composited layer (`.wr-board-grid-layer`), re-tiled only when
 * the zoom changes; pans and zoom previews just move the layer. (A <canvas>
 * version measured slower in WebKit: 28-33ms a zoom commit against 16-24ms.)
 *
 * Spacing is GRID_STEP on screen times 4^k, the smallest that is at least
 * MIN_SPACING. The finer level fades out between FADE_FROM and MIN_SPACING
 * over a coarser layer of every fourth dot, so zooming out thins the grid
 * instead of making it vanish.
 */

/** Grid spacing in scene units. */
export const GRID_STEP = 24;
const LEVEL = 4;
/** Below this on-screen spacing the next coarser level takes over. */
const MIN_SPACING = 10;
/** At or above this spacing the finer dots are fully visible. */
const FADE_FROM = 20;

export interface GridSpec {
  /** On-screen spacing of the finer level, px. */
  spacing: number;
  /** On-screen spacing of the coarser level (every LEVEL-th line). */
  coarse: number;
  /** 0..1 opacity of the finer level's own dots or lines. */
  fineAlpha: number;
}

export function gridSpec(zoom: number): GridSpec {
  let spacing = GRID_STEP * zoom;
  // A degenerate zoom must not spin; clampZoom keeps it far from this.
  if (!(spacing > 0)) spacing = MIN_SPACING;
  while (spacing < MIN_SPACING) spacing *= LEVEL;
  const fineAlpha = Math.min(1, Math.max(0, (spacing - MIN_SPACING) / (FADE_FROM - MIN_SPACING)));
  return { spacing, coarse: spacing * LEVEL, fineAlpha };
}
