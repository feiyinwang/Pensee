// Layout maths for the section rail, kept free of React/Tauri/CSS imports so
// it can be unit tested on its own.

// The list is a fixed 260px and every row truncates, so indenting all six
// levels would leave H6 as mostly ellipsis. Only DEPTH_WINDOW tiers are told
// apart at a time; the window slides along the depth axis instead.
export const INDENT_STEP = 12;
export const DEPTH_WINDOW = 3;

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

// The rail is one line down the pane, cut into a segment per heading. A
// segment is as long as its section's share of the note, so the line reads as
// a map: long sections are long. Every segment keeps SEGMENT_MIN so a one-line
// section can still be hovered and clicked; a note with more headings than fit
// shrinks the gaps, then the minimum, before it overflows.
export const SEGMENT_GAP = 4;
export const SEGMENT_MIN = 6;
const SEGMENT_TIGHT_GAP = 2;

export interface Segment {
  top: number;
  height: number;
}

export function segmentLayout(sizes: number[], track: number): Segment[] {
  const n = sizes.length;
  if (n === 0 || track <= 0) return [];
  let gap = SEGMENT_GAP;
  let min = SEGMENT_MIN;
  if (n * min + (n - 1) * gap > track) {
    gap = SEGMENT_TIGHT_GAP;
    min = Math.max(1, (track - (n - 1) * gap) / n);
  }
  const free = Math.max(0, track - (n - 1) * gap - n * min);
  const total = sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  const segments: Segment[] = [];
  let top = 0;
  for (const size of sizes) {
    const share = total > 0 ? Math.max(0, size) / total : 1 / n;
    const height = min + free * share;
    segments.push({ top, height });
    top += height + gap;
  }
  return segments;
}

// Where the "you are here" dot sits on the line: the reading line's place
// inside the marked section (`start` to `stop`, in document pixels), mapped
// onto that section's segment. The dot never leaves the marked segment, so a
// heading pinned by a click and the dot always agree.
export function dotOffset(segment: Segment, start: number, stop: number, readingY: number) {
  const span = stop - start;
  const fraction = span > 0 ? Math.min(Math.max((readingY - start) / span, 0), 1) : 0;
  return segment.top + fraction * segment.height;
}

// How far the open list sits below its top place so its middle is level with
// the pointer (`pointerY`, from the line's top). It keeps between the line's
// two ends, each `overhang` past them; a list as tall as the line cannot move.
export function followOffset(pointerY: number, height: number, track: number, overhang: number) {
  const room = track - height + 2 * overhang;
  const centred = pointerY - height / 2 + overhang;
  return Math.max(0, Math.min(room, centred));
}
