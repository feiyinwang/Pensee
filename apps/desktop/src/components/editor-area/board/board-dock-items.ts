/**
 * The tools Dock's items as data — ids, labels and shortcuts, no icons — so
 * the layout rules are testable without JSX. `board-dock.tsx` adds the icons.
 *
 * Ids: "select" | "hand" | "text" | "pen" | "image" | "tidy" (an action)
 *      "shape:<kind>" | "linker:<kind>:<route>" | "frame:<preset>"
 *      "picture:<id>" (an action: drops that picture's skeleton)
 */

import { FRAME_PRESETS, type FramePreset, type ShapeKind } from "./board-model";

export interface DockSpec {
  id: string;
  label: string;
  shortcut?: string;
  items?: DockSpec[];
}

/** A Dock tray can be at most as wide as the bar allows (see `trayFits`), so
 *  pentagon and cross live in the selection toolbar's Shape menu instead. */
export const DOCK_SHAPES: [ShapeKind, string][] = [
  ["roundRect", "Rounded rectangle"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["diamond", "Diamond"],
  ["triangle", "Triangle"],
  ["hexagon", "Hexagon"],
  ["star", "Star"],
  ["bubble", "Speech bubble"],
];

const SHAPE_KEYS: Partial<Record<ShapeKind, string>> = {
  roundRect: "R",
  ellipse: "O",
  diamond: "D",
};

const FRAME_LABELS: Record<FramePreset, string> = {
  custom: "Section",
  "16:9": "Slide 16:9",
  "4:3": "Slide 4:3",
  "1:1": "Square",
  A4: "A4 page",
};

/** The pictures a board can hold (SPECs/board-pictures-spec.md), named as the
 *  talk box's buttons name them. */
export const PICTURES = [
  ["mindmap", "Mind map"],
  ["steps", "Steps"],
  ["matrix", "Matrix"],
  ["timeline", "Timeline"],
  ["chart", "Chart"],
] as const;

export type PictureId = (typeof PICTURES)[number][0];

/** What each picture starts as: its skeleton, nothing you didn't choose. A
 *  chart can't draw without numbers, so it starts with placeholder ones to
 *  write over (double-click it). */
export const PICTURE_STARTERS: Record<PictureId, string> = {
  mindmap: "mindmap\n  root((Central topic))",
  steps: "flowchart LR\n  A[First step] --> B[Next step] --> C[Last step]",
  matrix: "quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High",
  timeline: "timeline\n  First\n  Next\n  Then",
  chart: "xychart-beta\n  x-axis [One, Two, Three]\n  bar [1, 2, 3]",
};

export const DOCK_SPEC: DockSpec[] = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "hand", label: "Hand", shortcut: "H" },
  {
    id: "shapes",
    label: "Shapes",
    items: DOCK_SHAPES.map(([kind, label]) => ({
      id: `shape:${kind}`,
      label,
      shortcut: SHAPE_KEYS[kind],
    })),
  },
  { id: "text", label: "Text", shortcut: "T" },
  {
    id: "linkers",
    label: "Connector",
    items: [
      { id: "linker:arrow:straight", label: "Arrow", shortcut: "A" },
      { id: "linker:line:straight", label: "Line" },
      { id: "linker:arrow:elbow", label: "Elbow arrow" },
      { id: "linker:arrow:curved", label: "Curved arrow" },
    ],
  },
  { id: "pen", label: "Pen", shortcut: "P" },
  {
    id: "frames",
    label: "Section",
    items: (Object.keys(FRAME_PRESETS) as FramePreset[]).map((p) => ({
      id: `frame:${p}`,
      label: FRAME_LABELS[p],
      shortcut: p === "custom" ? "⇧S" : undefined,
    })),
  },
  {
    id: "pictures",
    label: "Picture",
    items: PICTURES.map(([id, label]) => ({ id: `picture:${id}`, label })),
  },
  { id: "image", label: "Image" },
  { id: "tidy", label: "Tidy up" },
];

/** Dock geometry (dock.tsx): a tray may be no wider than the bar minus its
 *  end radii and fillets, or its outline clips the members. */
export function trayFits(items: DockSpec[]): boolean {
  const bar = items.length * 44 + (items.length - 1) * 2 + 12;
  const room = bar - 2 * 22 - 2 * 12;
  return items.every((item) => {
    const n = item.items?.length ?? 0;
    return n * 40 + Math.max(n - 1, 0) * 2 + 12 <= room;
  });
}
