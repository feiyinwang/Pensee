/**
 * The part of a demo GIF a frame shows. The frame takes the box's shape and
 * the GIF is enlarged and offset so the box fills it, so nothing stretches.
 * Shared by the homepage's feature cards and the pages' demo figures.
 */
export interface Zoom {
  /** [left, top, right, bottom] in the GIF's own pixels. */
  box: [number, number, number, number];
  /** The GIF's [width, height]. */
  size: [number, number];
}

export interface ZoomLayout {
  /** The frame's aspect ratio, `w / h`. */
  aspectRatio: string;
  /** The image's size and offset inside the frame, in percent. */
  width: number;
  height: number;
  left: number;
  top: number;
}

export function zoomLayout({ box: [l, t, r, b], size: [width, height] }: Zoom): ZoomLayout {
  const w = (r - l) / width;
  const h = (b - t) / height;
  return {
    aspectRatio: `${r - l} / ${b - t}`,
    width: 100 / w,
    height: 100 / h,
    left: (-l / width / w) * 100,
    top: (-t / height / h) * 100,
  };
}
