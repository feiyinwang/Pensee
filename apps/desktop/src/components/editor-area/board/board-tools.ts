/**
 * Board chrome: left tool rail with fly-outs, top bar, bottom-right viewport
 * cluster, and the contextual style panel.
 *
 * Plain DOM, no framework — same choice as `block-handle-menu.ts`, and for the
 * same reason: this lives inside a full-screen overlay, not a React tree.
 * Icons are inline strokes rather than an icon import so the rail has no
 * asset dependency and stays a single `currentColor` knob.
 */

import { type FramePreset, type LinkerShape, type ShapeKind, SHAPE_KINDS } from "./board-model";
import { keyLabel } from "@/lib/platform";

export type ToolId = "select" | "hand" | "shape" | "text" | "linker" | "pen" | "frame" | "image";

export interface ToolState {
  tool: ToolId;
  shape: ShapeKind;
  linker: { kind: "line" | "arrow"; shape: LinkerShape };
  frame: FramePreset;
}

export interface ToolbarCallbacks {
  onTool: (tool: ToolId) => void;
  onShape: (kind: ShapeKind) => void;
  onLinker: (kind: "line" | "arrow", shape: LinkerShape) => void;
  onFrame: (preset: FramePreset) => void;
  onImage: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (delta: number) => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onClose: () => void;
  onPresent: () => void;
  /** Absent when the board has no file to export from (legacy fence in an unsaved note). */
  onExport?: (kind: "png" | "svg") => void;
}

const svgNS = "http://www.w3.org/2000/svg";

function icon(paths: string[], opts: { fill?: boolean } = {}): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("wr-board-icon");
  for (const d of paths) {
    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", d);
    if (opts.fill) p.setAttribute("fill", "currentColor");
    svg.append(p);
  }
  return svg;
}

const ICON = {
  select: ["M5 3l14 8-6 1.6L10.6 19z"],
  hand: [
    "M8 12V6.5a1.5 1.5 0 013 0V12",
    "M11 11V5.5a1.5 1.5 0 013 0V12",
    "M14 11.5V7.5a1.5 1.5 0 013 0V15a5 5 0 01-5 5h-1a5 5 0 01-5-5v-3l-1.2 1.2a1.4 1.4 0 01-2-2L8 9",
  ],
  shape: [
    "M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5z",
  ],
  text: ["M5 6h14", "M12 6v13", "M9 19h6"],
  linker: ["M4 18c6 0 4-12 10-12", "M14 6h4v4"],
  frame: ["M4 8h16", "M8 4v16", "M4 4h16v16H4z"],
  image: [
    "M4 5h16v14H4z",
    "M4 16l4.5-4.5 3 3L15 11l5 5",
    "M9 9.2a1.2 1.2 0 11-2.4 0 1.2 1.2 0 012.4 0z",
  ],
  undo: ["M9 7H5V3", "M5 7a8 8 0 1 1 0 8"],
  redo: ["M15 7h4V3", "M19 7a8 8 0 1 0 0 8"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  present: ["M8 5.5v13l10.5-6.5z"],
  export: ["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M5 19h14"],
  minus: ["M5 12h14"],
  plus: ["M12 5v14", "M5 12h14"],
  fit: ["M4 9V4h5", "M20 15v5h-5", "M20 9V4h-5", "M4 15v5h5"],
};

interface RailEntry {
  id: ToolId;
  title: string;
  hint: string;
  paths: string[];
  flyout?: (close: () => void) => HTMLElement;
}

export interface Toolbar {
  root: HTMLElement;
  setTool: (tool: ToolId) => void;
  setZoom: (zoom: number) => void;
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  closeFlyout: () => void;
  banner: HTMLElement;
  showBanner: (text: string, tone: "info" | "warn" | "error") => void;
  hideBanner: () => void;
}

const SHAPE_LABEL: Record<ShapeKind, string> = {
  roundRect: "Rounded rectangle",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  star: "Star",
  bubble: "Speech bubble",
  cross: "Cross",
};

const SHAPE_PREVIEW: Record<ShapeKind, string> = {
  roundRect:
    "M5 8.5A3.5 3.5 0 018.5 5h7A3.5 3.5 0 0119 8.5v7a3.5 3.5 0 01-3.5 3.5h-7A3.5 3.5 0 015 15.5z",
  rect: "M5 5h14v14H5z",
  ellipse: "M19 12a7 7 0 11-14 0 7 7 0 0114 0z",
  diamond: "M12 4l8 8-8 8-8-8z",
  triangle: "M12 5l7 14H5z",
  pentagon: "M12 4l8 5.8-3 9.2H7l-3-9.2z",
  hexagon: "M8 5h8l4 7-4 7H8l-4-7z",
  star: "M12 4l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 16.4 6.9 19.2l1.2-5.6L4 9.8l5.6-.6z",
  bubble: "M4 6h16v10h-9l-4 4v-4H4z",
  cross: "M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z",
};

const LINKER_OPTIONS: {
  kind: "line" | "arrow";
  shape: LinkerShape;
  label: string;
  path: string;
}[] = [
  { kind: "line", shape: "straight", label: "Line", path: "M5 19L19 5" },
  { kind: "arrow", shape: "straight", label: "Arrow", path: "M5 19L19 5M19 5h-5M19 5v5" },
  {
    kind: "arrow",
    shape: "elbow",
    label: "Elbow arrow",
    path: "M5 19h6V7h8M19 7h-4M19 7v4",
  },
  {
    kind: "arrow",
    shape: "curved",
    label: "Curved arrow",
    path: "M5 19C5 9 13 5 19 5M19 5h-5M19 5v5",
  },
];

const FRAME_OPTIONS: { preset: FramePreset; label: string; ratio: number }[] = [
  { preset: "custom", label: "Custom", ratio: 1.4 },
  { preset: "16:9", label: "16 : 9", ratio: 16 / 9 },
  { preset: "4:3", label: "4 : 3", ratio: 4 / 3 },
  { preset: "1:1", label: "1 : 1", ratio: 1 },
  { preset: "A4", label: "A4", ratio: 794 / 1123 },
];

export function buildToolbar(state: ToolState, cb: ToolbarCallbacks): Toolbar {
  const root = document.createElement("div");
  root.className = "wr-board-chrome";

  /* ---------------------------------------------------------------- top */
  const top = document.createElement("div");
  top.className = "wr-board-topbar";
  const closeBtn = button("Close", ICON.close, () => cb.onClose());
  closeBtn.classList.add("wr-board-close");
  const closeLabel = document.createElement("span");
  closeLabel.textContent = "Close";
  closeBtn.append(closeLabel);
  const title = document.createElement("span");
  title.className = "wr-board-title";
  title.textContent = "Board";
  const presentBtn = button("Present", ICON.present, () => cb.onPresent());
  presentBtn.classList.add("wr-board-present");
  const presentLabel = document.createElement("span");
  presentLabel.textContent = "Present";
  presentBtn.append(presentLabel);
  // Undo and redo sit up here with the board's other commands (they used to
  // share the bottom-right cluster with zoom).
  const undoBtn = button("Undo (⌘Z)", ICON.undo, () => cb.onUndo());
  const redoBtn = button("Redo (⇧⌘Z)", ICON.redo, () => cb.onRedo());
  top.append(closeBtn, title, undoBtn, redoBtn, presentBtn);
  if (cb.onExport) {
    const onExport = cb.onExport;
    const exportBtn = button("Export", ICON.export, () => {
      menu.hidden = !menu.hidden;
    });
    exportBtn.classList.add("wr-board-present");
    exportBtn.setAttribute("aria-haspopup", "menu");
    const exportLabel = document.createElement("span");
    exportLabel.textContent = "Export";
    exportBtn.append(exportLabel);
    const menu = document.createElement("div");
    menu.className = "wr-board-export-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    for (const [kind, label] of [
      ["png", "PNG image (2×)"],
      ["svg", "SVG (opens anywhere)"],
    ] as const) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", () => {
        menu.hidden = true;
        onExport(kind);
      });
      menu.append(item);
    }
    const wrap = document.createElement("span");
    wrap.className = "wr-board-export";
    wrap.append(exportBtn, menu);
    top.append(wrap);
  }

  const banner = document.createElement("div");
  banner.className = "wr-board-banner";
  banner.hidden = true;
  top.append(banner);

  /* ---------------------------------------------------------------- rail */
  let openFlyout: HTMLElement | null = null;
  const closeFlyout = () => {
    openFlyout?.remove();
    openFlyout = null;
  };

  const rail = document.createElement("div");
  rail.className = "wr-board-rail";

  const entries: RailEntry[] = [
    { id: "select", title: "Select", hint: "V", paths: ICON.select },
    { id: "hand", title: "Hand", hint: "H", paths: ICON.hand },
    { id: "shape", title: "Shape", hint: "R", paths: ICON.shape, flyout: shapeFlyout },
    { id: "text", title: "Text", hint: "T", paths: ICON.text },
    { id: "linker", title: "Connector", hint: "A", paths: ICON.linker, flyout: linkerFlyout },
    { id: "frame", title: "Section", hint: "⇧S", paths: ICON.frame, flyout: frameFlyout },
    { id: "image", title: "Image", hint: "", paths: ICON.image },
  ];

  const railButtons = new Map<ToolId, HTMLButtonElement>();

  for (const entry of entries) {
    const btn = button(`${entry.title}${entry.hint ? ` (${entry.hint})` : ""}`, entry.paths, () => {
      if (entry.id === "image") {
        closeFlyout();
        cb.onImage();
        return;
      }
      const reopening = openFlyout?.dataset.for === entry.id;
      closeFlyout();
      cb.onTool(entry.id);
      if (entry.flyout && !reopening) {
        const panel = entry.flyout(closeFlyout);
        panel.dataset.for = entry.id;
        panel.style.top = `${btn.offsetTop}px`;
        rail.append(panel);
        openFlyout = panel;
      }
    });
    btn.classList.add("wr-board-rail-btn");
    railButtons.set(entry.id, btn);
    rail.append(btn);
  }

  function shapeFlyout(close: () => void): HTMLElement {
    const panel = flyout("Shape", "R");
    const grid = document.createElement("div");
    grid.className = "wr-board-grid wr-board-grid-5";
    for (const kind of SHAPE_KINDS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "wr-board-tile";
      tile.title = SHAPE_LABEL[kind];
      tile.setAttribute("aria-label", SHAPE_LABEL[kind]);
      tile.append(icon([SHAPE_PREVIEW[kind]]));
      tile.addEventListener("click", () => {
        cb.onShape(kind);
        close();
      });
      if (kind === state.shape) tile.classList.add("is-active");
      grid.append(tile);
    }
    panel.append(grid);
    return panel;
  }

  function linkerFlyout(close: () => void): HTMLElement {
    const panel = flyout("Connector", "A");
    const list = document.createElement("div");
    list.className = "wr-board-grid wr-board-grid-1";
    for (const option of LINKER_OPTIONS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "wr-board-tile wr-board-tile-wide";
      tile.title = option.label;
      tile.setAttribute("aria-label", option.label);
      tile.append(icon([option.path]));
      tile.addEventListener("click", () => {
        cb.onLinker(option.kind, option.shape);
        close();
      });
      list.append(tile);
    }
    panel.append(list);
    return panel;
  }

  function frameFlyout(close: () => void): HTMLElement {
    const panel = flyout("Section", "⇧S");
    const grid = document.createElement("div");
    grid.className = "wr-board-grid wr-board-grid-3";
    for (const option of FRAME_OPTIONS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "wr-board-tile wr-board-tile-labeled";
      tile.title = option.label;
      const box = document.createElement("span");
      box.className = "wr-board-ratio";
      const w = option.ratio >= 1 ? 30 : 30 * option.ratio;
      const h = option.ratio >= 1 ? 30 / option.ratio : 30;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      if (option.preset === "custom") box.classList.add("is-dashed");
      const caption = document.createElement("span");
      caption.textContent = option.label;
      tile.append(box, caption);
      tile.addEventListener("click", () => {
        cb.onFrame(option.preset);
        close();
      });
      grid.append(tile);
    }
    panel.append(grid);
    return panel;
  }

  /* --------------------------------------------------------- viewport */
  const viewportCluster = document.createElement("div");
  viewportCluster.className = "wr-board-viewport-cluster";

  const zoomOut = button("Zoom out (⌘−)", ICON.minus, () => cb.onZoom(-1));
  const zoomIn = button("Zoom in (⌘+)", ICON.plus, () => cb.onZoom(1));
  const zoomLabel = document.createElement("button");
  zoomLabel.type = "button";
  zoomLabel.className = "wr-board-zoom-label";
  zoomLabel.title = keyLabel("Reset zoom (⌘0)");
  zoomLabel.textContent = "100%";
  zoomLabel.addEventListener("click", () => cb.onZoomReset());
  const fitBtn = button("Zoom to fit (⌘1)", ICON.fit, () => cb.onZoomFit());
  // A column in the top-right corner (zoom in on top), clear of the dock.
  const zoomGroup = group([zoomIn, zoomLabel, zoomOut, fitBtn]);

  viewportCluster.append(zoomGroup);

  /* ------------------------------------------------------ style panel */

  root.append(top, rail, viewportCluster);

  return {
    root,
    banner,
    closeFlyout,
    setTool(tool) {
      for (const [id, btn] of railButtons) btn.classList.toggle("is-active", id === tool);
    },
    setZoom(zoom) {
      // Called every pan frame; only touch the DOM when the number changes.
      const text = `${Math.round(zoom * 100)}%`;
      if (zoomLabel.textContent !== text) zoomLabel.textContent = text;
    },
    setHistory(canUndo, canRedo) {
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
    },
    showBanner(text, tone) {
      banner.textContent = text;
      banner.dataset.tone = tone;
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
  };
}

/* ------------------------------------------------------------- primitives */

function button(title: string, paths: string[], onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wr-board-btn";
  btn.title = keyLabel(title);
  btn.setAttribute("aria-label", keyLabel(title));
  btn.append(icon(paths));
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

function group(children: HTMLElement[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "wr-board-group";
  wrap.append(...children);
  return wrap;
}

function flyout(title: string, hint: string): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "wr-board-flyout";
  const header = document.createElement("div");
  header.className = "wr-board-flyout-head";
  const name = document.createElement("span");
  name.textContent = title;
  const key = document.createElement("kbd");
  key.textContent = keyLabel(hint);
  header.append(name, key);
  panel.append(header);
  return panel;
}
