/**
 * Export a board (or the selection) as SVG or PNG.
 *
 * SVG is the same self-contained file format as `.board.svg` (pictures
 * inlined, colours baked in). PNG renders that SVG at 2× onto a light
 * background; the dark-mode colour block is dropped first, since a PNG has no
 * colour scheme to follow and light-on-white would be unreadable.
 */

import { type BoardScene, cloneScene, isLinker } from "./board-model";
import { FILE_LIGHT } from "./board-file";

/** The selection plus what belongs with it: a section's contents, and the
 *  connectors whose both ends are included. */
export function exportSubset(scene: BoardScene, ids: Set<string>): BoardScene {
  const keep = new Set(ids);
  for (const el of scene.els) if (el.fr && keep.has(el.fr)) keep.add(el.id);
  for (const el of scene.els) {
    if (isLinker(el) && el.b1 && el.b2 && keep.has(el.b1.el) && keep.has(el.b2.el)) keep.add(el.id);
  }
  const out = cloneScene(scene);
  out.els = out.els.filter((el) => keep.has(el.id));
  return out;
}

const DARK_BLOCK = /@media \(prefers-color-scheme:dark\)\{:root\{[^}]*\}\}/;

/** PNG bytes (base64, no data: prefix) of an SVG document, at `scale`. */
export async function svgToPngBase64(svgText: string, scale = 2): Promise<string> {
  const light = svgText.replace(DARK_BLOCK, "");
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(light)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(img.naturalWidth * scale);
  canvas.height = Math.ceil(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available to render the PNG.");
  // The light board's own ground, so the picture is the board as drawn.
  ctx.fillStyle = FILE_LIGHT.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}
