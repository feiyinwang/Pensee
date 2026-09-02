/**
 * Board chrome: left tool rail with fly-outs, top bar, bottom-right viewport
 * cluster, and the contextual style panel.
 *
 * Plain DOM, no framework — same choice as `block-handle-menu.ts`, and for the
 * same reason: this lives inside a full-screen overlay, not a React tree.
 * Icons are inline strokes rather than an icon import so the rail has no
 * asset dependency and stays a single `currentColor` knob.
 */

import {
  type ColorToken,
  type FramePreset,
  type LinkerShape,
  type ShapeKind,
  type StickyColor,
  type StrokeDash,
  SHAPE_KINDS,
  STICKY_COLORS,
} from "./board-model";

export type ToolId = "select" | "hand" | "shape" | "text" | "sticky" | "linker" | "frame" | "image";

export interface ToolState {
  tool: ToolId;
  shape: ShapeKind;
  sticky: StickyColor;
  linker: { kind: "line" | "arrow"; shape: LinkerShape };
  frame: FramePreset;
}

export interface ToolbarCallbacks {
  onTool: (tool: ToolId) => void;
  onShape: (kind: ShapeKind) => void;
  onSticky: (color: StickyColor) => void;
  onLinker: (kind: "line" | "arrow", shape: LinkerShape) => void;
  onFrame: (preset: FramePreset) => void;
  onImage: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (delta: number) => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  onClose: () => void;
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
  sticky: ["M5 4h14v10l-5 6H5z", "M19 14h-5v6"],
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
  stylePanel: HTMLElement;
  banner: HTMLElement;
  showBanner: (text: string, tone: "warn" | "error") => void;
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
  top.append(closeBtn, title);

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
    { id: "sticky", title: "Sticky note", hint: "N", paths: ICON.sticky, flyout: stickyFlyout },
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

  function stickyFlyout(close: () => void): HTMLElement {
    const panel = flyout("Sticky note", "N");
    const grid = document.createElement("div");
    grid.className = "wr-board-grid wr-board-grid-3";
    for (const color of STICKY_COLORS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "wr-board-swatch";
      tile.title = color;
      tile.setAttribute("aria-label", `${color} sticky note`);
      tile.style.background = `var(--wr-board-sticky-${color})`;
      tile.addEventListener("click", () => {
        cb.onSticky(color);
        close();
      });
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

  const undoBtn = button("Undo (⌘Z)", ICON.undo, () => cb.onUndo());
  const redoBtn = button("Redo (⇧⌘Z)", ICON.redo, () => cb.onRedo());
  const historyGroup = group([undoBtn, redoBtn]);

  const zoomOut = button("Zoom out (⌘−)", ICON.minus, () => cb.onZoom(-1));
  const zoomIn = button("Zoom in (⌘+)", ICON.plus, () => cb.onZoom(1));
  const zoomLabel = document.createElement("button");
  zoomLabel.type = "button";
  zoomLabel.className = "wr-board-zoom-label";
  zoomLabel.title = "Reset zoom (⌘0)";
  zoomLabel.textContent = "100%";
  zoomLabel.addEventListener("click", () => cb.onZoomReset());
  const fitBtn = button("Zoom to fit (⌘1)", ICON.fit, () => cb.onZoomFit());
  const zoomGroup = group([zoomOut, zoomLabel, zoomIn, fitBtn]);

  viewportCluster.append(historyGroup, zoomGroup);

  /* ------------------------------------------------------ style panel */
  const stylePanel = document.createElement("div");
  stylePanel.className = "wr-board-style-panel";
  stylePanel.hidden = true;

  root.append(top, rail, viewportCluster, stylePanel);

  return {
    root,
    stylePanel,
    banner,
    closeFlyout,
    setTool(tool) {
      for (const [id, btn] of railButtons) btn.classList.toggle("is-active", id === tool);
    },
    setZoom(zoom) {
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
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

/* ----------------------------------------------------------- style panel */

export interface StyleTargets {
  stroke?: ColorToken;
  fill?: ColorToken;
  width?: number;
  dash?: StrokeDash;
  opacity?: number;
  fontSize?: number;
}

export interface StyleHandlers {
  setStroke: (c: ColorToken) => void;
  setFill: (c: ColorToken) => void;
  setWidth: (w: number) => void;
  setDash: (d: StrokeDash) => void;
  setOpacity: (o: number) => void;
  setFontSize: (s: number) => void;
  bringForward: () => void;
  sendBackward: () => void;
  duplicate: () => void;
  remove: () => void;
}

const STROKE_TOKENS: ColorToken[] = ["ink", "muted", "red", "orange", "green", "blue", "purple"];
const FILL_TOKENS: ColorToken[] = ["none", "muted", "red", "orange", "green", "blue", "purple"];

export function renderStylePanel(
  panel: HTMLElement,
  targets: StyleTargets | null,
  handlers: StyleHandlers,
): void {
  panel.replaceChildren();
  if (!targets) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  if (targets.stroke !== undefined) {
    panel.append(swatchRow("Stroke", STROKE_TOKENS, targets.stroke, (c) => handlers.setStroke(c)));
  }
  if (targets.fill !== undefined) {
    panel.append(swatchRow("Fill", FILL_TOKENS, targets.fill, (c) => handlers.setFill(c)));
  }
  if (targets.width !== undefined) {
    panel.append(
      choiceRow(
        "Width",
        [
          { label: "S", value: 1 },
          { label: "M", value: 2 },
          { label: "L", value: 4 },
        ],
        targets.width,
        (v) => handlers.setWidth(v),
      ),
    );
  }
  if (targets.dash !== undefined) {
    panel.append(
      choiceRow<StrokeDash>(
        "Line",
        [
          { label: "──", value: "solid" },
          { label: "╌╌", value: "dashed" },
          { label: "····", value: "dotted" },
        ],
        targets.dash,
        (v) => handlers.setDash(v),
      ),
    );
  }
  if (targets.fontSize !== undefined) {
    panel.append(
      choiceRow(
        "Text",
        [
          { label: "S", value: 12 },
          { label: "M", value: 16 },
          { label: "L", value: 24 },
          { label: "XL", value: 36 },
        ],
        targets.fontSize,
        (v) => handlers.setFontSize(v),
      ),
    );
  }
  if (targets.opacity !== undefined) {
    panel.append(
      choiceRow(
        "Opacity",
        [
          { label: "30%", value: 0.3 },
          { label: "60%", value: 0.6 },
          { label: "100%", value: 1 },
        ],
        targets.opacity,
        (v) => handlers.setOpacity(v),
      ),
    );
  }

  const actions = document.createElement("div");
  actions.className = "wr-board-style-actions";
  actions.append(
    textButton("Forward", handlers.bringForward),
    textButton("Backward", handlers.sendBackward),
    textButton("Duplicate", handlers.duplicate),
    textButton("Delete", handlers.remove, true),
  );
  panel.append(actions);
}

/* ------------------------------------------------------------- primitives */

function button(title: string, paths: string[], onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wr-board-btn";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.append(icon(paths));
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

function textButton(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = danger ? "wr-board-text-btn is-danger" : "wr-board-text-btn";
  btn.textContent = label;
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
  key.textContent = hint;
  header.append(name, key);
  panel.append(header);
  return panel;
}

function swatchRow(
  label: string,
  tokens: ColorToken[],
  active: ColorToken,
  onPick: (c: ColorToken) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "wr-board-style-row";
  const name = document.createElement("span");
  name.className = "wr-board-style-label";
  name.textContent = label;
  row.append(name);
  const list = document.createElement("div");
  list.className = "wr-board-style-choices";
  for (const token of tokens) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wr-board-swatch is-small";
    btn.title = token;
    btn.setAttribute("aria-label", `${label} ${token}`);
    if (token === "none") btn.classList.add("is-none");
    else btn.style.background = `var(--wr-board-${token})`;
    btn.classList.toggle("is-active", token === active);
    btn.addEventListener("click", () => onPick(token));
    list.append(btn);
  }
  row.append(list);
  return row;
}

function choiceRow<T extends string | number>(
  label: string,
  options: { label: string; value: T }[],
  active: T,
  onPick: (v: T) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "wr-board-style-row";
  const name = document.createElement("span");
  name.className = "wr-board-style-label";
  name.textContent = label;
  row.append(name);
  const list = document.createElement("div");
  list.className = "wr-board-style-choices";
  for (const option of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wr-board-chip";
    btn.textContent = option.label;
    btn.classList.toggle("is-active", option.value === active);
    btn.addEventListener("click", () => onPick(option.value));
    list.append(btn);
  }
  row.append(list);
  return row;
}
