/**
 * The board colour palette: an ordered list of colours offered for shape
 * fills and borders, saved app-wide in the `board.palette` setting. An entry is
 * a hue token (drawn soft as a fill, strong as a border — FigJam's pairs) or a
 * custom `#rrggbb` (drawn as picked). See SPECs/board-color-palette-spec.md.
 *
 * Pure data and colour maths; the picker UI lives in `board-color-picker.tsx`.
 */

import { type ColorToken, HUE_TOKENS, type HueToken, isColor } from "./board-model";

export type PaletteEntry = HueToken | `#${string}`;

export const PALETTE_SETTING = "board.palette";

/** Every hue token but `accent`, which draws the same ink as `ink` now that
 *  the app has no accent colour. `accent` stays a valid token, so shapes and
 *  saved palettes that use it keep working. Equal to the `board.palette`
 *  default in settings.schema.json (board-palette.test.ts). */
export const DEFAULT_PALETTE: readonly PaletteEntry[] = HUE_TOKENS.filter((t) => t !== "accent");

/** A saved palette, cleaned: unknown, soft and duplicate entries dropped, and
 *  the default back when nothing usable is left. */
export function normalizePalette(raw: unknown): PaletteEntry[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PALETTE];
  const out: PaletteEntry[] = [];
  for (const v of raw) {
    if (!isColor(v) || v === "none" || v.endsWith("-soft")) continue;
    const entry = (v.startsWith("#") ? v.toLowerCase() : v) as PaletteEntry;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.length ? out : [...DEFAULT_PALETTE];
}

export function fillOf(entry: PaletteEntry): ColorToken {
  return entry.startsWith("#") ? entry : (`${entry}-soft` as ColorToken);
}

export function strokeOf(entry: PaletteEntry): ColorToken {
  return entry;
}

/** The palette entry a stored colour came from, for showing it as picked. */
export function entryOf(c: ColorToken): PaletteEntry | null {
  if (c === "none") return null;
  return (c.endsWith("-soft") ? c.slice(0, -5) : c) as PaletteEntry;
}

export function moveEntry(list: readonly PaletteEntry[], from: number, to: number): PaletteEntry[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Replaces entry `i`; a colour already elsewhere in the list moves here. */
export function replaceEntry(
  list: readonly PaletteEntry[],
  i: number,
  next: PaletteEntry,
): PaletteEntry[] {
  const out = list.map((e, j) => (j === i ? next : e));
  return out.filter((e, j) => j === i || e !== next);
}

export function addEntry(list: readonly PaletteEntry[], next: PaletteEntry): PaletteEntry[] {
  return list.includes(next) ? [...list] : [...list, next];
}

export function removeEntry(list: readonly PaletteEntry[], i: number): PaletteEntry[] {
  const out = list.filter((_, j) => j !== i);
  return out.length ? out : [...DEFAULT_PALETTE];
}

/* ------------------------------------------------------------ HSV <-> hex */

/** Hue in degrees, saturation and value in 0..1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToHex({ h, s, v }: Hsv): `#${string}` {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const hex = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}`;
}

export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; anything else → null. */
export function normalizeHex(input: string): `#${string}` | null {
  let t = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t))
    t = t
      .split("")
      .map((c) => c + c)
      .join("");
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}
