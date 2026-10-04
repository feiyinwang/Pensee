/**
 * The board canvas: viewport, tools, selection, transforms, in-place text,
 * and the in-board undo stack.
 *
 * Two hard rules live here.
 *  1. **Screen-constant chrome.** Handles, snap thresholds and hit slop are
 *     specified in screen pixels and divided by zoom before use. Zooming to
 *     400% must not give you 4× handles.
 *  2. **Two conversion paths, never shared.** Pointer events convert
 *     screen → scene by hand; rendering converts scene → screen through the
 *     SVG transform. They are deliberately independent — a shared "unit
 *     converter" is how the two-renderer height bug happened elsewhere.
 */

import {
  type BoardEl,
  type BoardScene,
  type FramePreset,
  type ImageEl,
  type LinkerEl,
  type LinkerKind,
  type LinkerShape,
  type MindEl,
  type ShapeEl,
  type ShapeKind,
  type StickyColor,
  type TextEl,
  type Viewport,
  FRAME_PRESETS,
  STICKY_SIZE,
  clampCoord,
  clampZoom,
  cloneScene,
  defaultStyle,
  newShapeStyle,
  findEl,
  hasStyle,
  isLinker,
  isShape,
  newId,
  sceneSize,
  setTextOf,
  textOf,
} from "./board-model";
import {
  type Box,
  type HandleId,
  type Point,
  boxContains,
  boxesOverlap,
  boxesUnion,
  computeFocus,
  elementAt,
  elementBounds,
  frameAt,
  handlePositions,
  resizeBox,
  rotate,
  polylineMidpoint,
  routeLinker,
  snapMove,
} from "./board-geometry";
import {
  BOARD_FONT,
  LINE_HEIGHT,
  STICKY_FONT_MAX,
  STICKY_FONT_MIN,
  SceneRenderer,
  fitFontSize,
  hitShapeCaret,
  measureText,
  shapeFitHeight,
  shapeLabel,
  svgEl,
} from "./board-render";
import { mermaidToElements } from "./board-mermaid";
import { type Emphasis, toggleEmphasis, toggleEmphasisAll } from "./board-emphasis";
import { strokeFrom } from "./board-draw";
import { gridSpec } from "./board-grid";
import { fitView, lerpBox, lerpView, slideOrder } from "./board-present";
import { findMatches, replaceInElement } from "./board-search";
import { exportSubset, svgToPngBase64 } from "./board-export";
import * as tauri from "@/lib/tauri";
import {
  addMindChild,
  addMindSibling,
  growMind,
  mindDots,
  MIND,
  isMind,
  layoutMind,
  mindDepth,
  mindFontSize,
  mindRoot,
  mindSubtree,
  newMindRoot,
} from "./board-mind";
import { type ToolId, type ToolState, type Toolbar, buildToolbar } from "./board-tools";
import {
  applyAlign,
  applyBranchColor,
  applyFontSize,
  applyTextColor,
  summarizeSelection,
} from "./board-selection";
import {
  SIDES,
  type Side,
  blankCopy,
  canQuickConnect,
  connectorBetween,
  nextStepBox,
  placeNear,
  quickDots,
} from "./board-flow";
import type { SelectionToolbarActions, SelectionToolbarHandle } from "./board-selection-toolbar";
import type { ToolDockHandle } from "./board-dock";

/* -------------------------------------------------------------- constants */

/** All in SCREEN pixels. Divided by zoom at the point of use. */
const SCREEN = {
  hitSlop: 8,
  handle: 9,
  /** Quick-connect dots: distance outside the box, and radius. */
  quickOffset: 22,
  quickDot: 5,
  snap: 6,
  minDrag: 4,
} as const;

/** A shape placed by a click or a shortcut instead of a drag, in scene units. */
const SHAPE_DEFAULT = { w: 160, h: 110 } as const;

const CULL_THRESHOLD = 300;
/** Screen pixels the svg extends beyond each edge of the stage. A pan moves
 *  the painted svg on the compositor and repaints only once it has used most
 *  of this margin, so panning costs the same on any board. Culled boards draw
 *  exactly this far out. */
const OVERSCAN = 256;
/** Below this zoom, boards big enough to cull hide their labels (see `.is-far`
 *  in board.css). */
const FAR_ZOOM = 0.3;
const HISTORY_LIMIT = 120;
const ZOOM_STEP = 1.2;

export interface BoardCanvasOptions {
  scene: BoardScene;
  /** Called on every committed change. The host debounces before writing back. */
  onChange: (scene: BoardScene) => void;
  onClose: () => void;
  /** Document-relative path → something the webview can actually load. */
  resolveSrc: (src: string) => string;
  /** Copies a file into the note's assets folder and returns its relative path.
   *  Images are never inlined — that is the whole doc-size guarantee. */
  importImage?: (file: File) => Promise<{ src: string; w: number; h: number } | null>;
  readOnly?: boolean;
  /** Start in present mode; leaving it closes the board (opened to present). */
  present?: boolean;
  /** The self-contained SVG for a scene (pictures inlined). Enables Export. */
  exportSvg?: (scene: BoardScene) => Promise<string>;
}

export interface BoardCanvasHandle {
  destroy: () => void;
  flush: () => BoardScene;
  focus: () => void;
  /** Opens find & replace (⌘F, routed here by the overlay). */
  find: () => void;
}

type Interaction =
  | { kind: "none" }
  /** Pressed a quick-connect dot: a click adds the next step, a drag draws a connector. */
  | { kind: "quick"; side: Side; src: string; origin: Point }
  /** Pen stroke in progress, scene-space points. */
  | { kind: "pen"; pts: Point[] }
  | { kind: "pan"; startClient: Point; startVp: Viewport }
  | { kind: "marquee"; origin: Point; current: Point; additive: boolean }
  | { kind: "drag"; origin: Point; startEls: Map<string, BoardEl>; moved: boolean }
  | {
      kind: "resize";
      handle: HandleId;
      origin: Point;
      startBox: Box;
      startEls: Map<string, BoardEl>;
    }
  | {
      kind: "rotate";
      origin: Point;
      center: Point;
      startEls: Map<string, BoardEl>;
      startAngle: number;
    }
  | { kind: "create"; origin: Point; el: BoardEl }
  | { kind: "linking"; el: LinkerEl; origin: Point };

let chromePrefetched = false;

/** Fetches and evaluates the lazily split board chrome (selection toolbar,
 *  dock: React, motion, Arc) while the note is idle, without mounting it.
 *  Called when a board shows up in a note, so opening it doesn't spend its
 *  first frames on that — measured ~350ms on a cold first open. */
export function prefetchBoardChrome(): void {
  if (chromePrefetched) return;
  chromePrefetched = true;
  const load = (): void => {
    const failed = (error: unknown): void => console.error("[board] chrome prefetch failed", error);
    import("./board-selection-toolbar").catch(failed);
    import("./board-dock").catch(failed);
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    window.setTimeout(load, 300);
  }
}

export function mountBoardCanvas(host: HTMLElement, opts: BoardCanvasOptions): BoardCanvasHandle {
  let scene = cloneScene(opts.scene);
  let selection = new Set<string>();
  let interaction: Interaction = { kind: "none" };
  let spaceDown = false;
  /** The cursor on the board, in scene units; null while it is off the board.
   *  Shortcuts that add an item put it here. */
  let pointerScene: Point | null = null;
  /** Where a click with the shape or note tool would drop its item, drawn as
   *  a faint outline (and the arrow it would get) that follows the cursor. */
  let ghost: ReturnType<typeof placeNear> | null = null;
  let hoverTarget: string | null = null;
  let disposed = false;
  /** Arc Dock for tools; null until its lazy chunk arrives (see below). */
  let toolDock: ToolDockHandle | null = null;
  /** Find & replace results (ids in reading order) and the current one. */
  let matches: string[] = [];
  let matchIndex = -1;

  const past: string[] = [];
  const future: string[] = [];

  const tools: ToolState = {
    tool: "select",
    shape: "roundRect",
    sticky: "yellow",
    linker: { kind: "arrow", shape: "straight" },
    frame: "custom",
  };

  /* ------------------------------------------------------------- DOM */

  host.classList.add("wr-board-host");
  host.tabIndex = 0;

  // The dot grid is a CSS background on its own composited layer, NOT an SVG
  // <pattern>: WebKit re-rasterised the full-screen pattern whenever its
  // transform was touched, which made every pan frame ~45ms (measured; 8ms
  // with it gone). Panning only moves this layer, snapped to the spacing.
  const gridLayer = document.createElement("div");
  gridLayer.className = "wr-board-grid-layer";
  host.append(gridLayer);
  const svg = svgEl("svg", { class: "wr-board-svg" });
  svg.style.setProperty("--overscan", `${OVERSCAN}px`);
  const world = svgEl("g", { class: "wr-board-world" });
  const content = svgEl("g", { class: "wr-board-content" });
  const overlay = svgEl("g", { class: "wr-board-overlay" });
  world.append(content, overlay);
  svg.append(world);
  host.append(svg);

  const editorLayer = document.createElement("div");
  editorLayer.className = "wr-board-editor-layer";
  host.append(editorLayer);

  const renderer = new SceneRenderer(content);
  const toolbar: Toolbar = buildToolbar(tools, {
    onTool: (t) => setTool(t),
    onShape: (kind) => {
      tools.shape = kind;
      setTool("shape");
    },
    onSticky: (color) => {
      tools.sticky = color;
      setTool("sticky");
    },
    onLinker: (kind, shape) => {
      tools.linker = { kind, shape };
      setTool("linker");
    },
    onFrame: (preset) => {
      tools.frame = preset;
      setTool("frame");
    },
    onImage: () => pickImage(),
    onUndo: () => undo(),
    onRedo: () => redo(),
    onZoom: (dir) => zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
    onZoomReset: () => setZoom(1),
    onZoomFit: () => zoomToFit(),
    onClose: () => opts.onClose(),
    onPresent: () => startPresenting(0),
    onExport: opts.exportSvg ? (kind) => void exportBoard(kind) : undefined,
  });
  host.append(toolbar.root);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void placeImageFile(file, pointerScene ?? viewCenterScene());
  });
  host.append(fileInput);

  /* -------------------------------------------------------- viewport */

  const vp = () => scene.header.vp;

  /** The stage's screen rect, cached. Reading it per pointer event forced a
   *  synchronous layout after every frame's DOM writes; it only changes on
   *  resize, so it is refreshed then and at the start of each gesture. */
  let cachedStageRect: DOMRect | null = null;
  function stageRect(): DOMRect {
    // The host, not the svg: the svg overscans it and moves while panning.
    cachedStageRect ??= host.getBoundingClientRect();
    return cachedStageRect;
  }

  function screenToScene(clientX: number, clientY: number): Point {
    const rect = stageRect();
    const v = vp();
    return {
      x: (clientX - rect.left) / v.zoom + v.x,
      y: (clientY - rect.top) / v.zoom + v.y,
    };
  }

  function viewCenterScene(): Point {
    const rect = stageRect();
    return screenToScene(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  let gridKey = "";
  /** Re-tiles only when the zoom level or grid kind changes; a pan is one
   *  transform. Returns that transform ("" when the grid is hidden). */
  function applyGrid(v: Viewport): string {
    const kind = scene.header.bg;
    gridLayer.hidden = kind === "none";
    if (kind === "none") return "";
    const spec = gridSpec(v.zoom);
    const key = `${kind}|${spec.spacing}`;
    if (key !== gridKey) {
      gridKey = key;
      gridLayer.dataset.kind = kind;
      // The coarse layer is only drawn while the fine dots fade out.
      gridLayer.dataset.fading = spec.fineAlpha < 1 ? "1" : "0";
      gridLayer.style.setProperty("--grid", `${spec.spacing}px`);
      gridLayer.style.setProperty("--grid-coarse", `${spec.coarse}px`);
      gridLayer.style.setProperty("--grid-fine", `${Math.round(spec.fineAlpha * 100)}%`);
    }
    const size = spec.coarse;
    const mod = (n: number) => ((n % size) + size) % size;
    const ox = mod(-v.x * v.zoom) - size;
    const oy = mod(-v.y * v.zoom) - size;
    const t = `translate3d(${ox}px, ${oy}px, 0)`;
    gridLayer.style.transform = t;
    return t;
  }

  /** The viewport the SVG and grid were last really painted at. */
  let painted: Viewport = { ...scene.header.vp };
  let paintedGrid = "";

  function applyViewport(): void {
    const v = vp();
    // Any real paint ends an in-flight zoom preview.
    if (zoomSettleTimer !== -1) {
      window.clearTimeout(zoomSettleTimer);
      zoomSettleTimer = -1;
    }
    svg.style.transform = "";
    painted = { ...v };
    world.setAttribute(
      "transform",
      `translate(${OVERSCAN - v.x * v.zoom} ${OVERSCAN - v.y * v.zoom}) scale(${v.zoom})`,
    );
    paintedGrid = applyGrid(v);
    // Only where painting them costs: a small board keeps its labels.
    host.classList.toggle("is-far", v.zoom < FAR_ZOOM && scene.els.length >= CULL_THRESHOLD);
    recullSoon();
    toolbar.setZoom(v.zoom);
    placeSelectionToolbar();
  }

  /** Moves the viewport to `next` zoom, keeping `anchorClient` (or the centre)
   *  fixed on screen. Updates state only; callers decide how to paint. */
  function zoomViewport(next: number, anchorClient?: Point): void {
    const v = vp();
    const zoom = clampZoom(next);
    if (anchorClient) {
      const before = screenToScene(anchorClient.x, anchorClient.y);
      v.zoom = zoom;
      const after = screenToScene(anchorClient.x, anchorClient.y);
      v.x += before.x - after.x;
      v.y += before.y - after.y;
    } else {
      const rect = stageRect();
      const cx = v.x + rect.width / v.zoom / 2;
      const cy = v.y + rect.height / v.zoom / 2;
      v.zoom = zoom;
      v.x = cx - rect.width / zoom / 2;
      v.y = cy - rect.height / zoom / 2;
    }
  }

  /** Buttons and shortcuts: one step, painted at once. No save — a viewport
   *  change is not an edit (it is written with the next change or on close). */
  function setZoom(next: number, anchorClient?: Point): void {
    zoomViewport(next, anchorClient);
    applyViewport();
    draw();
  }

  /* Pinch / ⌘-scroll zoom. Excalidraw stretches cached bitmaps mid-gesture and
     re-rasterises once afterwards; the SVG equivalent is a compositor-only CSS
     transform from the last painted viewport to the live one, committed as a
     real repaint once the gesture rests. Re-rendering the SVG and re-tiling
     the grid on every step measured ~23ms a frame even on a tiny board. */
  /** How long a zoom gesture must rest before the real repaint. Short where
   *  that repaint is cheap, so a small board sharpens sooner; longer on big
   *  boards, where a commit mid-gesture would be a visible stall. */
  const zoomSettleMs = (): number => (scene.els.length < CULL_THRESHOLD ? 100 : 160);
  let zoomSettleTimer = -1;

  /** Shows the live viewport by moving the svg as last painted, on the
   *  compositor (its transform-origin is the stage's corner, see board.css). */
  function previewViewport(): void {
    const c = painted;
    const n = vp();
    const s = n.zoom / c.zoom;
    const t = `translate(${(c.x - n.x) * n.zoom}px, ${(c.y - n.y) * n.zoom}px) scale(${s})`;
    svg.style.transform = t;
    // A pure pan re-snaps the grid exactly; a zoom stretches it with the svg.
    if (s === 1) applyGrid(n);
    else gridLayer.style.transform = `${t} ${paintedGrid}`;
    toolbar.setZoom(n.zoom);
    placeSelectionToolbar();
  }

  /* Panning moves the painted svg the same way. It overscans the stage by
     OVERSCAN, so a pan only repaints once it has used most of that margin:
     on a 2,600-element board, a repaint per pan frame measured 60-80ms; a
     compositor move is one frame (8ms) at any size. */
  function panViewport(): void {
    const c = painted;
    const n = vp();
    const moved = Math.max(Math.abs(c.x - n.x), Math.abs(c.y - n.y)) * n.zoom;
    if (c.zoom === n.zoom && zoomSettleTimer === -1 && moved < OVERSCAN * 0.75) {
      previewViewport();
      return;
    }
    applyViewport();
    recullNow();
  }

  function zoomGesture(next: number, anchorClient: Point): void {
    zoomViewport(next, anchorClient);
    previewViewport();
    window.clearTimeout(zoomSettleTimer);
    zoomSettleTimer = window.setTimeout(() => {
      zoomSettleTimer = -1;
      applyViewport();
      draw();
    }, zoomSettleMs());
  }

  function zoomBy(factor: number): void {
    setZoom(vp().zoom * factor);
  }

  function zoomToFit(): void {
    const boxes = scene.els.map((el) => elementBounds(el));
    const union = boxesUnion(boxes);
    const rect = stageRect();
    if (!union || union.w <= 0 || union.h <= 0) {
      const v = vp();
      v.zoom = 1;
      v.x = -rect.width / 2;
      v.y = -rect.height / 2;
    } else {
      const pad = 80;
      const zoom = clampZoom(
        Math.min((rect.width - pad * 2) / union.w, (rect.height - pad * 2) / union.h),
      );
      const v = vp();
      v.zoom = zoom;
      v.x = union.x + union.w / 2 - rect.width / zoom / 2;
      v.y = union.y + union.h / 2 - rect.height / zoom / 2;
    }
    applyViewport();
    draw();
    markDirty();
  }

  /* --------------------------------------------------------- history */

  function pushHistory(): void {
    past.push(JSON.stringify(scene));
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
    toolbar.setHistory(past.length > 0, false);
  }

  function undo(): void {
    const prev = past.pop();
    if (!prev) return;
    future.push(JSON.stringify(scene));
    scene = JSON.parse(prev) as BoardScene;
    pruneSelection();
    applyViewport();
    draw();
    markDirty();
    toolbar.setHistory(past.length > 0, future.length > 0);
  }

  function redo(): void {
    const next = future.pop();
    if (!next) return;
    past.push(JSON.stringify(scene));
    scene = JSON.parse(next) as BoardScene;
    pruneSelection();
    applyViewport();
    draw();
    markDirty();
    toolbar.setHistory(past.length > 0, future.length > 0);
  }

  function pruneSelection(): void {
    // Deleting the entry the iterator is currently on is well-defined for Set,
    // so no defensive copy is needed here.
    for (const id of selection) if (!findEl(scene, id)) selection.delete(id);
  }

  function markDirty(): void {
    if (disposed) return;
    opts.onChange(scene);
    const size = sceneSize(scene);
    if (size.overBudget) {
      toolbar.showBanner(
        `This board is ${(size.bytes / 1024).toFixed(0)} KB in the note (${scene.els.length} elements). Consider splitting it.`,
        "warn",
      );
    } else {
      toolbar.hideBanner();
    }
  }

  /* ------------------------------------------------------------ draw */

  /** Viewport the culled element set was computed for. */
  let culledFor: Viewport | null = null;
  let recullFrame = 0;

  /** Large boards draw only what the overscanned svg can show, which is
   *  around where it was last painted (`painted`), not the live viewport a
   *  preview has moved it to. Once it is repainted elsewhere, the culled set
   *  must follow, or a later compositor pan would slide empty margin in. */
  function cullIsStale(): boolean {
    if (scene.els.length < CULL_THRESHOLD || !culledFor) return false;
    const p = painted;
    return culledFor.x !== p.x || culledFor.y !== p.y || culledFor.zoom !== p.zoom;
  }

  function recullNow(): void {
    if (!cullIsStale()) return;
    renderer.render(scene, { resolveSrc: opts.resolveSrc, scene }, visibleElements());
  }

  /** From `applyViewport`, whose callers usually `draw()` right after; this
   *  covers the ones that do not. */
  function recullSoon(): void {
    if (recullFrame || !cullIsStale()) return;
    recullFrame = requestAnimationFrame(() => {
      recullFrame = 0;
      recullNow();
    });
  }

  function visibleElements(): BoardEl[] {
    if (scene.els.length < CULL_THRESHOLD) return scene.els;
    const rect = stageRect();
    const v = painted;
    culledFor = { ...v };
    const view: Box = {
      x: v.x - OVERSCAN / v.zoom,
      y: v.y - OVERSCAN / v.zoom,
      w: (rect.width + OVERSCAN * 2) / v.zoom,
      h: (rect.height + OVERSCAN * 2) / v.zoom,
    };
    return scene.els.filter((el) => boxesOverlap(elementBounds(el), view));
  }

  function draw(): void {
    renderer.render(scene, { resolveSrc: opts.resolveSrc, scene }, visibleElements());
    drawOverlay();
    renderStyle();
  }

  /** What a gesture over `moving` can change: those elements plus connectors
   *  bound to them. Worked out once per gesture (keyed on its snapshot). */
  const gestureDirty = new WeakMap<Map<string, BoardEl>, BoardEl[]>();

  /** A drag / resize / rotate frame: re-render only what can have changed. */
  function drawGesture(moving: Map<string, BoardEl>): void {
    let dirty = gestureDirty.get(moving);
    if (!dirty) {
      dirty = scene.els.filter(
        (el) =>
          moving.has(el.id) ||
          (isLinker(el) && ((el.b1 && moving.has(el.b1.el)) || (el.b2 && moving.has(el.b2.el)))),
      );
      gestureDirty.set(moving, dirty);
    }
    const ctx = { resolveSrc: opts.resolveSrc, scene };
    if (!renderer.renderSome(scene, ctx, dirty)) renderer.render(scene, ctx, visibleElements());
    drawOverlay();
    renderStyle(); // hides the selection toolbar for the gesture (a class toggle)
  }

  /** What a connector end can attach to under `p`: the topmost shape, note,
   *  text, picture or topic. Connectors (including the one being drawn, whose
   *  tip is always under the pointer) and sections are looked through, not
   *  returned; returning the drawn arrow itself is what left drags unbound. */
  function linkTargetAt(p: Point): BoardEl | null {
    return elementAt(
      scene,
      p,
      SCREEN.hitSlop / vp().zoom,
      (el) => !isLinker(el) && el.t !== "frame",
    );
  }

  function selectionBox(): Box | null {
    const boxes = [...selection]
      .map((id) => findEl(scene, id))
      .filter((el): el is BoardEl => Boolean(el))
      .map((el) => (isLinker(el) ? routeBounds(el) : elementBounds(el)));
    return boxesUnion(boxes);
  }

  /** A connector's box as drawn. Its stored points go stale once an end is
   *  bound (and are (0,0) on connectors made already bound), which put the
   *  selection toolbar near the board's origin instead of under the line. */
  function routeBounds(el: LinkerEl): Box {
    const pts = routeLinker(scene, el);
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function drawOverlay(): void {
    overlay.replaceChildren();
    const z = vp().zoom;
    const px = (n: number) => n / z;

    if (ghost) {
      const g = ghost.box;
      overlay.append(
        svgEl("rect", {
          x: g.x,
          y: g.y,
          width: g.w,
          height: g.h,
          rx: tools.tool === "sticky" ? px(2) : 8,
          class: "wr-board-ghost",
          "stroke-width": px(1.5),
          "stroke-dasharray": `${px(5)} ${px(4)}`,
        }),
      );
      if (ghost.from && ghost.side) {
        const f = elementBounds(ghost.from);
        const mid = (b: { x: number; y: number; w: number; h: number }, side: Side) =>
          side === "e"
            ? { x: b.x + b.w, y: b.y + b.h / 2 }
            : side === "w"
              ? { x: b.x, y: b.y + b.h / 2 }
              : side === "s"
                ? { x: b.x + b.w / 2, y: b.y + b.h }
                : { x: b.x + b.w / 2, y: b.y };
        const opposite: Record<Side, Side> = { e: "w", w: "e", n: "s", s: "n" };
        const a = mid(f, ghost.side);
        const b = mid(g, opposite[ghost.side]);
        overlay.append(
          svgEl("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            class: "wr-board-ghost-link",
            "stroke-width": px(1.5),
            "stroke-dasharray": `${px(5)} ${px(4)}`,
          }),
        );
      }
    }

    if (matches.length) {
      for (const [i, id] of matches.entries()) {
        const el = findEl(scene, id);
        if (!el) continue;
        const b = elementBounds(el);
        const pad = px(4);
        overlay.append(
          svgEl("rect", {
            x: b.x - pad,
            y: b.y - pad,
            width: b.w + pad * 2,
            height: b.h + pad * 2,
            rx: px(6),
            class: i === matchIndex ? "wr-board-match is-current" : "wr-board-match",
            "stroke-width": px(i === matchIndex ? 2.5 : 1.5),
          }),
        );
      }
    }

    if (interaction.kind === "pen" && interaction.pts.length > 1) {
      overlay.append(
        svgEl("polyline", {
          points: interaction.pts.map((q) => `${q.x},${q.y}`).join(" "),
          fill: "none",
          stroke: "var(--wr-board-ink)",
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      );
    }

    if (interaction.kind === "marquee") {
      const box = normalizeBox(interaction.origin, interaction.current);
      overlay.append(
        svgEl("rect", {
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          class: "wr-board-marquee",
          "stroke-width": px(1),
        }),
      );
    }

    if (hoverTarget && (tools.tool === "linker" || interaction.kind === "linking")) {
      const el = findEl(scene, hoverTarget);
      if (el) {
        const b = elementBounds(el);
        overlay.append(
          svgEl("rect", {
            x: b.x - px(3),
            y: b.y - px(3),
            width: b.w + px(6),
            height: b.h + px(6),
            class: "wr-board-bind-hint",
            "stroke-width": px(1.5),
          }),
        );
      }
    }

    for (const guide of activeGuides) {
      if (guide.x !== undefined) {
        overlay.append(
          svgEl("line", {
            x1: guide.x,
            y1: guide.from,
            x2: guide.x,
            y2: guide.to,
            class: "wr-board-guide",
            "stroke-width": px(1),
          }),
        );
      } else if (guide.y !== undefined) {
        overlay.append(
          svgEl("line", {
            x1: guide.from,
            y1: guide.y,
            x2: guide.to,
            y2: guide.y,
            class: "wr-board-guide",
            "stroke-width": px(1),
          }),
        );
      }
    }

    const box = selectionBox();
    if (!box || interaction.kind === "create" || interaction.kind === "linking") return;

    // Connectors show their selection on the line itself, not as a box around
    // the route (which read as a stray rectangle on an elbow arrow).
    const selected = [...selection].map((id) => findEl(scene, id));
    if (selected.every((el) => el && isLinker(el))) {
      for (const el of selected) {
        if (!el || !isLinker(el)) continue;
        overlay.append(
          svgEl("polyline", {
            points: routeLinker(scene, el)
              .map((q) => `${q.x},${q.y}`)
              .join(" "),
            class: "wr-board-link-sel",
            "stroke-width": px(el.st.w + 3),
          }),
        );
      }
      return;
    }

    overlay.append(
      svgEl("rect", {
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        class: "wr-board-selbox",
        "stroke-width": px(1),
      }),
    );

    const single = selection.size === 1 ? findEl(scene, [...selection][0]) : null;
    const handles = handlePositions(box);
    const size = px(SCREEN.handle);
    const ids: HandleId[] =
      selection.size === 1
        ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
        : ["nw", "ne", "se", "sw"];

    if (single && isLinker(single)) return;
    // Topics are sized and placed by the layout: no resize or rotate, and
    // their dots grow the map (child out of the far side, parallel topics
    // above and below) rather than copy the shape.
    if (selectionHasMind()) {
      if (isMind(single) && interaction.kind === "none") {
        const dots = quickDots(box, px(SCREEN.quickOffset));
        for (const side of Object.keys(mindDots(scene, single)) as Side[]) {
          overlay.append(
            svgEl("circle", {
              cx: dots[side].x,
              cy: dots[side].y,
              r: px(SCREEN.quickDot),
              class: "wr-board-qdot",
              "data-side": side,
            }),
          );
        }
      }
      return;
    }
    if (single && !activeEditor && !textOf(single) && (isShape(single) || single.t === "sticky")) {
      // Lark's empty-shape hint: says where typing will go.
      const size = isShape(single) ? (single.lb?.sz ?? 14) : 16;
      const hint = svgEl("text", {
        x: single.x + single.w / 2,
        y: single.y + single.h / 2,
        "font-size": size,
        "font-family": BOARD_FONT,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        class: "wr-board-placeholder",
      });
      hint.textContent = "Add text";
      overlay.append(hint);
    }

    for (const id of ids) {
      const p = handles[id];
      const node = svgEl("rect", {
        x: p.x - size / 2,
        y: p.y - size / 2,
        width: size,
        height: size,
        rx: px(2),
        class: "wr-board-handle",
        "stroke-width": px(1),
        "data-handle": id,
      });
      overlay.append(node);
    }

    if (selection.size === 1) {
      // Bottom-left, off the corner (Lark): the top-centre spot belongs to
      // the quick-connect dot.
      const p = rotateHandlePoint(box, z);
      overlay.append(
        svgEl("circle", {
          cx: p.x,
          cy: p.y,
          r: size / 2,
          class: "wr-board-handle is-rotate",
          "stroke-width": px(1),
          "data-handle": "rot",
        }),
      );
    }
    // Kept while typing into the shape: the dots are how you carry on.
    if (single && canQuickConnect(single) && interaction.kind === "none") {
      const dots = quickDots(box, px(SCREEN.quickOffset));
      for (const side of SIDES) {
        overlay.append(
          svgEl("circle", {
            cx: dots[side].x,
            cy: dots[side].y,
            r: px(SCREEN.quickDot),
            class: "wr-board-qdot",
            "data-side": side,
          }),
        );
      }
    }
  }

  let activeGuides: { x?: number; y?: number; from: number; to: number }[] = [];

  /* ------------------------------------------------ selection toolbar */

  // The toolbar is React + Arc + motion, so it loads on first open rather than
  // with every note. Until it arrives there is simply no toolbar.
  const selToolbarHost = document.createElement("div");
  selToolbarHost.className = "wr-board-seltb";
  host.append(selToolbarHost);
  let selToolbar: SelectionToolbarHandle | null = null;

  let lastSummaryKey = "-";
  function renderStyle(): void {
    if (!selToolbar) return;
    // While the selection itself is being moved, the bar is hidden by a class:
    // no React work and no exit animation (unmounting cost a 25–45ms hitch at
    // every drag start). Other gestures go through the normal path, so a click
    // that clears the selection does not re-show a bar only to animate it out.
    const moving =
      interaction.kind === "drag" || interaction.kind === "resize" || interaction.kind === "rotate";
    selToolbarHost.classList.toggle("is-hidden", moving);
    if (moving) return;
    const busy = interaction.kind !== "none";
    const els = [...selection].map((id) => findEl(scene, id)).filter(Boolean) as BoardEl[];
    const summary = busy || opts.readOnly ? null : summarizeSelection(els, scene);
    // Unchanged during a drag (null) or a pan: skip React and the re-place.
    const key = summary ? JSON.stringify(summary) : "";
    if (key !== lastSummaryKey) {
      lastSummaryKey = key;
      selToolbar.update(summary);
    }
    if (summary) placeSelectionToolbar();
  }

  /** Centred under the selection, clear of the handles; flips above when it
   *  would run into the bottom controls, and never leaves the stage. */
  function placeSelectionToolbar(): void {
    if (!selToolbar) return;
    const box = selectionBox();
    // Cached: measuring here forced a full layout on every pan frame.
    const { w, h } = toolbarSize;
    if (!box || !w) return;
    const v = vp();
    // The svg fills the host, so one cached rect serves for both.
    const hostRect = stageRect();
    const svgRect = hostRect;
    const left = svgRect.left - hostRect.left + (box.x - v.x) * v.zoom;
    const top = svgRect.top - hostRect.top + (box.y - v.y) * v.zoom;
    const right = left + box.w * v.zoom;
    const bottom = top + box.h * v.zoom;
    const margin = 8;
    // Clear of the quick-connect dots and the corner rotate handle.
    const clear = SCREEN.quickOffset + SCREEN.quickDot + 12;
    const below = bottom + clear;
    const above = top - clear - h;
    const bottomChrome = host.classList.contains("has-dock") ? 96 : 64;
    let y = below + h > hostRect.height - bottomChrome && above > 56 ? above : below;
    y = Math.min(Math.max(y, 56), hostRect.height - h - margin);
    // Never under the tools rail on the left.
    const rail = host.classList.contains("has-dock")
      ? null
      : host.querySelector(".wr-board-rail")?.getBoundingClientRect();
    const minX = rail ? rail.right - hostRect.left + margin : margin;
    const x = Math.min(Math.max((left + right) / 2 - w / 2, minX), hostRect.width - w - margin);
    selToolbarHost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** The bar's size, from React commits and resize entries (never measured on
   *  the per-frame path). */
  let toolbarSize = { w: 0, h: 0 };
  const selToolbarResize = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1]?.contentRect;
    if (r) toolbarSize = { w: r.width, h: r.height };
    placeSelectionToolbar();
  });
  selToolbarResize.observe(selToolbarHost);

  function mutateSelection(fn: (el: BoardEl) => void): void {
    if (!selection.size) return;
    pushHistory();
    for (const id of selection) {
      const el = findEl(scene, id);
      if (el) fn(el);
    }
    draw();
    markDirty();
  }

  const selectionActions: SelectionToolbarActions = {
    setShapeKind: (kind) => mutateSelection((el) => isShape(el) && (el.t = kind)),
    setFill: (c) => mutateSelection((el) => isShape(el) && (el.st.f = c)),
    setSticky: (c) => mutateSelection((el) => el.t === "sticky" && (el.c = c)),
    setStroke: (c) => mutateSelection((el) => hasStyle(el) && (el.st.s = c)),
    setWidth: (w) => mutateSelection((el) => hasStyle(el) && (el.st.w = w)),
    setDash: (d) => mutateSelection((el) => hasStyle(el) && (el.st.d = d)),
    setTextColor: (c) => mutateSelection((el) => applyTextColor(el, c)),
    setFontSize: (sz) => mutateSelection((el) => applyFontSize(el, sz)),
    setAlign: (al) => mutateSelection((el) => applyAlign(el, al)),
    setRoute: (r) => mutateSelection((el) => isLinker(el) && (el.sh = r)),
    setBranch: (c) => mutateSelection((el) => applyBranchColor(scene, el, c)),
    setHeads: (hd) => mutateSelection((el) => isLinker(el) && (el.hd = { ...hd })),
    setOpacity: (o) => mutateSelection((el) => (el.op = o)),
    bringForward: () => reorder(1),
    sendBackward: () => reorder(-1),
    duplicate: () => duplicateSelection(),
    // Batch edit (Lark): every element of the selected kinds, then style them at once.
    selectSimilar: () => {
      const kinds = new Set([...selection].map((id) => findEl(scene, id)?.t));
      select(scene.els.filter((el) => kinds.has(el.t)).map((el) => el.id));
    },
    remove: () => deleteSelection(),
  };

  void import("./board-selection-toolbar")
    .then((m) => {
      if (disposed) return;
      selToolbar = m.mountSelectionToolbar(selToolbarHost, selectionActions, () => {
        // Once per React commit (not per frame): the bar's new size.
        if (selToolbar) toolbarSize = selToolbar.size();
        placeSelectionToolbar();
      });
      renderStyle();
    })
    .catch((error: unknown) => console.error("[board] selection toolbar failed to load", error));

  // The tools Dock (Arc Pro) replaces the plain rail once it has loaded; if it
  // cannot load, the rail stays and the error is logged.
  const dockHost = document.createElement("div");
  dockHost.className = "wr-board-dock";
  host.append(dockHost);
  void import("./board-dock")
    .then((m) => {
      if (disposed) return;
      toolDock = m.mountToolDock(dockHost, toolValue(), pickFromDock);
      host.classList.add("has-dock");
    })
    .catch((error: unknown) => console.error("[board] tool dock failed to load", error));

  function reorder(dir: 1 | -1): void {
    if (!selection.size) return;
    pushHistory();
    const indexes = scene.els.map((el, i) => (selection.has(el.id) ? i : -1)).filter((i) => i >= 0);
    const ordered = dir === 1 ? indexes.reverse() : indexes;
    for (const i of ordered) {
      const j = i + dir;
      if (j < 0 || j >= scene.els.length) continue;
      if (selection.has(scene.els[j].id)) continue;
      [scene.els[i], scene.els[j]] = [scene.els[j], scene.els[i]];
    }
    draw();
    markDirty();
  }

  /* ------------------------------------------------------- selection */

  /** The Dock id for the current tool, e.g. "shape:ellipse". */
  function toolValue(): string {
    switch (tools.tool) {
      case "shape":
        return `shape:${tools.shape}`;
      case "sticky":
        return `sticky:${tools.sticky}`;
      case "linker":
        return `linker:${tools.linker.kind}:${tools.linker.shape}`;
      case "frame":
        return `frame:${tools.frame}`;
      default:
        return tools.tool;
    }
  }

  function pickFromDock(id: string): void {
    const [kind, a, b] = id.split(":");
    if (kind === "image") {
      pickImage();
      toolDock?.setValue(toolValue());
      return;
    }
    if (kind === "shape") tools.shape = a as ShapeKind;
    else if (kind === "sticky") tools.sticky = a as StickyColor;
    else if (kind === "linker") tools.linker = { kind: a as LinkerKind, shape: b as LinkerShape };
    else if (kind === "frame") tools.frame = a as FramePreset;
    setTool(kind as ToolId);
    host.focus();
  }

  function setTool(tool: ToolId): void {
    tools.tool = tool;
    if (tool !== "shape" && tool !== "sticky") ghost = null;
    toolbar.setTool(tool);
    toolDock?.setValue(toolValue());
    host.dataset.tool = tool;
    if (tool !== "select") {
      selection.clear();
      draw();
    }
  }

  function select(ids: string[], additive = false): void {
    if (!additive) selection.clear();
    for (const id of ids) {
      if (additive && selection.has(id)) selection.delete(id);
      else selection.add(id);
    }
    // Selection never changes how elements are drawn: only the handles and
    // the toolbar need updating, not a stamp pass over the whole board.
    drawOverlay();
    renderStyle();
  }

  function deleteSelection(): void {
    if (!selection.size) return;
    const frames = [...selection]
      .map((id) => findEl(scene, id))
      .filter((el): el is BoardEl => el?.t === "frame");
    for (const frame of frames) {
      const kids = scene.els.filter((e) => e.fr === frame.id).length;
      if (kids > 0) {
        const name = (frame as { name: string }).name;
        const ok = window.confirm(`Delete section "${name}" and ${kids} items inside?`);
        if (!ok) return;
      }
    }
    pushHistory();
    const doomed = new Set(selection);
    for (const frame of frames) {
      for (const el of scene.els) if (el.fr === frame.id) doomed.add(el.id);
    }
    // A topic takes its branch with it; the surviving map closes the gap.
    const relayout = new Set<string>();
    for (const id of selection) {
      const el = findEl(scene, id);
      if (!isMind(el)) continue;
      for (const n of mindSubtree(scene, id)) doomed.add(n.id);
      relayout.add(mindRoot(scene, el).id);
    }
    scene.els = scene.els.filter((el) => !doomed.has(el.id));
    for (const rootId of relayout) if (!doomed.has(rootId)) layoutMind(scene, rootId, measureText);
    // A binding to a removed element degrades to its last resolved point so
    // the arrow stays where the user last saw it instead of vanishing.
    for (const el of scene.els) {
      if (!isLinker(el)) continue;
      const pts = routeLinker(scene, el);
      if (el.b1 && doomed.has(el.b1.el)) {
        delete el.b1;
        el.pts[0] = [pts[0].x - el.x, pts[0].y - el.y];
      }
      if (el.b2 && doomed.has(el.b2.el)) {
        delete el.b2;
        const last = pts[pts.length - 1];
        el.pts[el.pts.length - 1] = [last.x - el.x, last.y - el.y];
      }
    }
    selection.clear();
    draw();
    markDirty();
  }

  function duplicateSelection(): void {
    if (!selection.size) return;
    pushHistory();
    const idMap = new Map<string, string>();
    const copies: BoardEl[] = [];
    for (const id of selection) {
      const el = findEl(scene, id);
      if (!el) continue;
      const copy = structuredClone(el);
      copy.id = newId();
      copy.x += 12;
      copy.y += 12;
      idMap.set(el.id, copy.id);
      copies.push(copy);
    }
    for (const copy of copies) {
      if (copy.fr && idMap.has(copy.fr)) copy.fr = idMap.get(copy.fr);
      // A copied topic keeps its copied parent, or becomes a map of its own.
      if (isMind(copy) && copy.pa) {
        if (idMap.has(copy.pa)) copy.pa = idMap.get(copy.pa);
        else delete copy.pa;
      }
      if (isLinker(copy)) {
        if (copy.b1 && idMap.has(copy.b1.el)) copy.b1.el = idMap.get(copy.b1.el) as string;
        else delete copy.b1;
        if (copy.b2 && idMap.has(copy.b2.el)) copy.b2.el = idMap.get(copy.b2.el) as string;
        else delete copy.b2;
      }
    }
    scene.els.push(...copies);
    selection = new Set(copies.map((c) => c.id));
    draw();
    markDirty();
  }

  function groupSelection(makeGroup: boolean): void {
    if (!selection.size) return;
    pushHistory();
    const gid = makeGroup ? newId() : undefined;
    for (const id of selection) {
      const el = findEl(scene, id);
      if (!el) continue;
      if (gid) el.g = gid;
      else delete el.g;
    }
    draw();
    markDirty();
  }

  function expandByGroup(ids: string[]): string[] {
    const groups = new Set(
      ids.map((id) => findEl(scene, id)?.g).filter((g): g is string => Boolean(g)),
    );
    if (!groups.size) return ids;
    const out = new Set(ids);
    for (const el of scene.els) if (el.g && groups.has(el.g)) out.add(el.id);
    return [...out];
  }

  /* -------------------------------------------------------- creation */

  function makeElement(kind: ToolId, at: Point): BoardEl | null {
    const id = newId();
    switch (kind) {
      case "shape":
        return {
          id,
          t: tools.shape,
          x: at.x,
          y: at.y,
          w: 0,
          h: 0,
          a: 0,
          op: 1,
          st: newShapeStyle(),
        } as ShapeEl;
      case "sticky":
        return {
          id,
          t: "sticky",
          x: at.x - STICKY_SIZE / 2,
          y: at.y - STICKY_SIZE / 2,
          w: STICKY_SIZE,
          h: STICKY_SIZE,
          a: 0,
          op: 1,
          c: tools.sticky,
          tx: "",
        };
      case "text":
        return {
          id,
          t: "text",
          x: at.x,
          y: at.y,
          w: 220,
          h: 24,
          a: 0,
          op: 1,
          tx: "",
          sz: 16,
          al: "l",
          c: "ink",
        };
      case "frame": {
        const preset = FRAME_PRESETS[tools.frame];
        return {
          id,
          t: "frame",
          x: at.x,
          y: at.y,
          w: preset?.w ?? 0,
          h: preset?.h ?? 0,
          a: 0,
          op: 1,
          name: "Section",
          preset: tools.frame,
        };
      }
      case "linker":
        return {
          id,
          t: tools.linker.kind,
          x: at.x,
          y: at.y,
          w: 0,
          h: 0,
          a: 0,
          op: 1,
          sh: tools.linker.shape,
          pts: [
            [0, 0],
            [0, 0],
          ],
          hd: { s: "none", e: tools.linker.kind === "arrow" ? "triangle" : "none" },
          st: defaultStyle(),
        } as LinkerEl;
      default:
        return null;
    }
  }

  async function placeImageFile(file: File, at: Point): Promise<void> {
    if (!opts.importImage) {
      toolbar.showBanner("Images need a saved note — save the file first.", "error");
      return;
    }
    const result = await opts.importImage(file);
    if (!result || disposed) return;
    pushHistory();
    const maxSide = 520;
    const scale = Math.min(1, maxSide / Math.max(result.w || maxSide, result.h || maxSide));
    const w = Math.max(40, (result.w || maxSide) * scale);
    const h = Math.max(40, (result.h || maxSide) * scale);
    const el: ImageEl = {
      id: newId(),
      t: "image",
      x: at.x - w / 2,
      y: at.y - h / 2,
      w,
      h,
      a: 0,
      op: 1,
      src: result.src,
      ar: w / h,
      alt: file.name,
    };
    assignFrame(el);
    scene.els.push(el);
    selection = new Set([el.id]);
    setTool("select");
    draw();
    markDirty();
  }

  function pickImage(): void {
    fileInput.click();
  }

  function assignFrame(el: BoardEl): void {
    if (el.t === "frame") return;
    const frame = frameAt(scene, { x: el.x + el.w / 2, y: el.y + el.h / 2 });
    if (frame) el.fr = frame.id;
    else delete el.fr;
  }

  /* ------------------------------------------------------- emphasis */

  /** Cmd+B / Cmd+I (Ctrl elsewhere), nothing else held. */
  function emphasisKey(e: KeyboardEvent): Emphasis | null {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
    const k = e.key.toLowerCase();
    return k === "b" ? "bold" : k === "i" ? "italic" : null;
  }

  /** Bold / italic on every selected element's whole text, as one undo step. */
  function toggleSelectionEmphasis(kind: Emphasis): void {
    const targets = [...selection]
      .map((id) => findEl(scene, id))
      .filter((el): el is BoardEl => Boolean(el && textOf(el).trim()));
    if (!targets.length) return;
    pushHistory();
    const minds = new Set<string>();
    for (const el of targets) {
      setTextOf(el, toggleEmphasisAll(textOf(el), kind));
      if (isMind(el)) minds.add(mindRoot(scene, el).id);
    }
    for (const id of minds) layoutMind(scene, id, measureText);
    draw();
    markDirty();
  }

  /* ------------------------------------------------ label truncation */

  /** The topmost shape whose label caret is under `p`. */
  function caretShapeAt(p: Point): ShapeEl | null {
    for (let i = scene.els.length - 1; i >= 0; i--) {
      const el = scene.els[i];
      if (isShape(el) && hitShapeCaret(el, p)) return el;
    }
    return null;
  }

  /** The caret under a cut-off label grows the shape to fit the whole text;
   *  on a grown shape it shrinks it back. One undo step either way. */
  function toggleLabelExpand(el: ShapeEl): void {
    const label = shapeLabel(el);
    if (!label?.caret) return;
    pushHistory();
    if (label.caret === "expand") {
      // Still cut off after editing a grown shape: grow again, but keep the
      // height it started from, which is what collapsing returns to.
      el.ex ??= el.h;
      el.h = Math.max(el.h, shapeFitHeight(el));
    } else {
      el.h = el.ex ?? el.h;
      delete el.ex;
    }
    draw();
    markDirty();
  }

  /* --------------------------------------------------- text editing */

  let activeEditor: HTMLTextAreaElement | null = null;

  /** `typed` starts the edit from a keystroke: it is appended, caret at the
   *  end. Without it the existing text is selected (double-click / Enter). */
  function startTextEdit(el: BoardEl, typed?: string): void {
    if (opts.readOnly) return;
    closeTextEdit();
    const v = vp();
    const area = document.createElement("textarea");
    // Zero chrome: this must read as the text itself, not as a form control.
    area.className = "wr-board-text-editor";
    area.value = textOf(el) + (typed ?? "");
    area.spellcheck = false;
    // A connector label edits in a box centred on the line's midpoint.
    const mid = isLinker(el) ? polylineMidpoint(routeLinker(scene, el)) : null;
    const frame = mid
      ? { x: mid.x - 90, y: mid.y - 24, w: 180, h: 48 }
      : { x: el.x, y: el.y, w: el.w, h: el.h };
    const mind = isMind(el) ? mindDepth(scene, el) : -1;
    const centred = el.t === "sticky" || isShape(el) || Boolean(mid) || mind >= 0;
    const pad = el.t === "sticky" ? 16 : isShape(el) ? 10 : mind >= 0 ? MIND.padY : 0;
    const boxW = Math.max(frame.w - pad * 2, 60);
    const boxH = Math.max(frame.h - pad * 2, 20);
    // Match what the renderer will draw, so nothing jumps when editing ends.
    const size =
      el.t === "text"
        ? el.sz
        : el.t === "sticky"
          ? fitFontSize(area.value || "M", boxW, boxH, STICKY_FONT_MAX, STICKY_FONT_MIN).size
          : isShape(el)
            ? (el.lb?.sz ?? 14)
            : isLinker(el)
              ? (el.lb?.sz ?? 13)
              : mind >= 0
                ? mindFontSize(mind)
                : 14;
    const left = (frame.x - v.x + pad) * v.zoom;
    const top = (frame.y - v.y + pad) * v.zoom;
    area.style.left = `${left}px`;
    area.style.width = `${boxW * v.zoom}px`;
    area.style.fontSize = `${size * v.zoom}px`;
    area.style.textAlign =
      el.t === "text"
        ? alignCss(el.al)
        : el.t === "sticky"
          ? "center"
          : isShape(el)
            ? alignCss(el.lb?.al ?? "c")
            : mid || mind >= 0
              ? "center"
              : "left";
    area.style.color =
      el.t === "sticky"
        ? "var(--wr-board-sticky-ink)"
        : mind === 0
          ? "var(--wr-board-surface)" // the root is light text on a dark pill
          : "";
    if (mind >= 0) area.style.fontWeight = mind === 0 ? "600" : mind === 1 ? "500" : "400";

    /** Shapes and notes edit centred, like they render: the field is only as
     *  tall as its text and sits in the middle of the box. */
    const root = isMind(el) ? mindRoot(scene, el) : null;
    const growsLeft = Boolean(root && root !== el && el.x + el.w / 2 < root.x + root.w / 2);
    const fit = (): void => {
      if (mind >= 0) {
        // A topic grows with its text while typing, as it will once laid out.
        const longest = Math.max(...area.value.split("\n").map((l) => measureText(l || " ", size)));
        const width = Math.max(boxW, longest + 4) * v.zoom;
        area.style.width = `${width}px`;
        // Left of the root a topic grows leftward, away from its parent.
        if (growsLeft) area.style.left = `${left + boxW * v.zoom - width}px`;
      }
      if (!centred) {
        area.style.top = `${top}px`;
        area.style.height = `${Math.max(boxH, size * LINE_HEIGHT) * v.zoom}px`;
        return;
      }
      area.style.height = "0px";
      const h = Math.min(area.scrollHeight, boxH * v.zoom);
      area.style.height = `${h}px`;
      area.style.top = `${top + (boxH * v.zoom - h) / 2}px`;
    };

    const commit = (): void => {
      const next = area.value;
      if (next !== textOf(el)) {
        pushHistory();
        setTextOf(el, next);
        if (isMind(el)) layoutMind(scene, mindRoot(scene, el).id, measureText);
        if (el.t === "text") {
          el.h = Math.max(24, (next.split("\n").length || 1) * el.sz * 1.35);
          if (!next.trim()) {
            scene.els = scene.els.filter((e) => e.id !== el.id);
            selection.delete(el.id);
          }
        }
        draw();
        markDirty();
      }
      area.remove();
      drawn?.classList.remove("is-editing");
      if (activeEditor === area) activeEditor = null;
      drawOverlay();
      host.focus();
    };

    area.addEventListener("blur", commit);
    area.addEventListener("input", fit);
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const emphasis = emphasisKey(e);
      if (emphasis) {
        e.preventDefault();
        const r = toggleEmphasis(area.value, area.selectionStart, area.selectionEnd, emphasis);
        area.value = r.value;
        area.setSelectionRange(r.start, r.end);
        fit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
      // Typing a topic: Enter moves on to a sibling, Tab to a child; Shift+Enter
      // is a line break. Same keys as with the topic merely selected.
      if (
        isMind(el) &&
        !e.metaKey &&
        !e.ctrlKey &&
        (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))
      ) {
        e.preventDefault();
        commit();
        const fresh = findEl(scene, el.id);
        if (isMind(fresh)) addTopic(fresh, e.key === "Tab" ? "child" : "sibling");
      }
    });
    // Hide the drawn text while the field shows it, or it reads double.
    const drawn = content.querySelector(`[data-el="${el.id}"]`);
    drawn?.classList.add("is-editing");
    editorLayer.append(area);
    fit();
    activeEditor = area;
    area.focus();
    if (typed) area.setSelectionRange(area.value.length, area.value.length);
    else area.select();
    drawOverlay();
  }

  function closeTextEdit(): void {
    activeEditor?.blur();
    activeEditor = null;
  }

  function alignCss(a: "l" | "c" | "r"): string {
    return a === "c" ? "center" : a === "r" ? "right" : "left";
  }

  /* ----------------------------------------------------------- export */

  /** The selection if there is one, otherwise the whole board. */
  async function exportBoard(kind: "png" | "svg"): Promise<void> {
    const exportSvg = opts.exportSvg;
    if (!exportSvg) return;
    const subset = selection.size ? exportSubset(scene, new Set(selection)) : scene;
    if (!subset.els.length) {
      toolbar.showBanner("Nothing to export yet.", "warn");
      return;
    }
    try {
      const path = await tauri.pickSavePath(`board.${kind}`, {
        name: kind.toUpperCase(),
        extensions: [kind],
      });
      if (!path) return;
      const svgText = await exportSvg(subset);
      const data =
        kind === "svg"
          ? bytesToBase64(new TextEncoder().encode(svgText))
          : await svgToPngBase64(svgText);
      await tauri.writeExportFile(path, data);
      toolbar.showBanner(`Exported ${path.split("/").pop()}`, "info");
      window.setTimeout(() => toolbar.hideBanner(), 2400);
    } catch (error) {
      console.error("[board] export failed", error);
      toolbar.showBanner(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  /* ---------------------------------------------------- find & replace */

  const findBar = document.createElement("div");
  findBar.className = "wr-board-find";
  findBar.hidden = true;
  findBar.setAttribute("role", "search");
  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.placeholder = "Find on board";
  findInput.setAttribute("aria-label", "Find on board");
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace with";
  replaceInput.setAttribute("aria-label", "Replace with");
  const findCount = document.createElement("span");
  findCount.className = "wr-board-find-count";
  findCount.setAttribute("aria-live", "polite");
  function findButton(label: string, text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wr-board-find-btn";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }
  findBar.append(
    findInput,
    findCount,
    findButton("Previous match", "↑", () => stepMatch(-1)),
    findButton("Next match", "↓", () => stepMatch(1)),
    replaceInput,
    findButton("Replace", "Replace", () => replaceCurrent()),
    findButton("Replace all", "All", () => replaceAll()),
    findButton("Close find", "✕", () => closeFind()),
  );
  // Typing here must not reach the board's own shortcuts.
  findBar.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.target === replaceInput) replaceCurrent();
      else stepMatch(e.shiftKey ? -1 : 1);
    }
  });
  findBar.addEventListener("pointerdown", (e) => e.stopPropagation());
  host.append(findBar);

  function openFind(): void {
    if (presenting) return;
    closeTextEdit();
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
    runFind();
  }

  function closeFind(): void {
    findBar.hidden = true;
    matches = [];
    matchIndex = -1;
    drawOverlay();
    host.focus();
  }

  function runFind(keepIndex = false): void {
    matches = findMatches(scene, findInput.value);
    matchIndex = matches.length
      ? keepIndex
        ? Math.min(Math.max(matchIndex, 0), matches.length - 1)
        : 0
      : -1;
    showMatch();
  }

  function stepMatch(dir: 1 | -1): void {
    if (!matches.length) return;
    matchIndex = (matchIndex + dir + matches.length) % matches.length;
    showMatch();
  }

  /** Counts, selects and centres the current match. */
  function showMatch(): void {
    findCount.textContent = findInput.value
      ? matches.length
        ? `${matchIndex + 1} of ${matches.length}`
        : "No results"
      : "";
    const el = matchIndex >= 0 ? findEl(scene, matches[matchIndex]) : undefined;
    if (el) {
      selection = new Set([el.id]);
      const box = elementBounds(el);
      const rect = stageRect();
      const v = vp();
      const onScreen =
        box.x >= v.x &&
        box.y >= v.y &&
        box.x + box.w <= v.x + rect.width / v.zoom &&
        box.y + box.h <= v.y + rect.height / v.zoom;
      if (!onScreen) {
        v.x = box.x + box.w / 2 - rect.width / v.zoom / 2;
        v.y = box.y + box.h / 2 - rect.height / v.zoom / 2;
        applyViewport();
      }
    }
    draw();
  }

  function afterReplace(touched: BoardEl[]): void {
    const roots = new Set<string>();
    for (const el of touched) {
      if (isMind(el)) roots.add(mindRoot(scene, el).id);
      if (el.t === "text") el.h = Math.max(24, (el.tx.split("\n").length || 1) * el.sz * 1.35);
    }
    for (const id of roots) layoutMind(scene, id, measureText);
    markDirty();
    runFind(true);
  }

  function replaceCurrent(): void {
    const el = matchIndex >= 0 ? findEl(scene, matches[matchIndex]) : undefined;
    if (!el || !findInput.value) return;
    pushHistory();
    replaceInElement(el, findInput.value, replaceInput.value);
    afterReplace([el]);
  }

  /** Every match in one undo step. */
  function replaceAll(): void {
    if (!matches.length || !findInput.value) return;
    pushHistory();
    const touched = matches.map((id) => findEl(scene, id)).filter(Boolean) as BoardEl[];
    for (const el of touched) replaceInElement(el, findInput.value, replaceInput.value);
    afterReplace(touched);
  }

  findInput.addEventListener("input", () => runFind());

  /* ---------------------------------------------------------- present */

  interface PresentState {
    slides: Box[];
    index: number;
    /** Where the camera was before presenting; restored on exit. */
    saved: Viewport;
    /** The visible hole in the mask, in scene units. */
    hole: Box;
    stop: (() => void) | null;
  }
  let presenting: PresentState | null = null;
  const presentMask = svgEl("path", { class: "wr-board-present-mask", "fill-rule": "evenodd" });
  const presentHud = document.createElement("div");
  presentHud.className = "wr-board-present-hud";
  presentHud.hidden = true;
  host.append(presentHud);

  function hudButton(label: string, text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wr-board-present-btn";
    b.setAttribute("aria-label", label);
    b.textContent = text;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
      host.focus();
    });
    return b;
  }
  const hudCount = document.createElement("span");
  hudCount.className = "wr-board-present-count";
  presentHud.append(
    hudButton("Previous slide", "‹", () => presenting && goToSlide(presenting.index - 1)),
    hudCount,
    hudButton("Next slide", "›", () => presenting && goToSlide(presenting.index + 1)),
    hudButton("Exit presentation", "Exit", () => stopPresenting()),
  );

  /** Covers everything but the current slide with the board colour. */
  function drawPresentMask(): void {
    if (!presenting) return;
    const { hole } = presenting;
    const far = 1e6;
    presentMask.setAttribute(
      "d",
      `M${-far} ${-far}H${far}V${far}H${-far}Z` +
        `M${hole.x} ${hole.y}V${hole.y + hole.h}H${hole.x + hole.w}V${hole.y}Z`,
    );
    if (presentMask.parentNode !== world) world.append(presentMask);
  }

  function startPresenting(index: number): void {
    const slides = slideOrder(scene);
    if (!slides.length || presenting) return;
    closeTextEdit();
    selection.clear();
    setTool("select");
    presenting = { slides, index: -1, saved: { ...vp() }, hole: slides[0], stop: null };
    host.classList.add("is-presenting");
    presentHud.hidden = false;
    draw();
    goToSlide(index);
  }

  function stopPresenting(): void {
    if (!presenting) return;
    const state = presenting;
    state.stop?.();
    presenting = null;
    presentMask.remove();
    presentHud.hidden = true;
    host.classList.remove("is-presenting");
    // Restore first: the saved scene carries the viewport, and presenting must
    // never be what rewrites the file.
    Object.assign(vp(), state.saved);
    applyViewport();
    draw();
    if (opts.present) opts.onClose();
  }

  /** Springs the camera (and the mask's hole) to slide `index`. */
  function goToSlide(index: number): void {
    if (!presenting) return;
    const state = presenting;
    const next = Math.max(0, Math.min(state.slides.length - 1, index));
    if (next === state.index) return;
    const rect = stageRect();
    const fromView = { ...vp() };
    const fromHole = state.hole;
    const toHole = state.slides[next];
    const toView = fitView(toHole, rect.width, rect.height, 32);
    state.index = next;
    hudCount.textContent = `${next + 1} / ${state.slides.length}`;
    state.stop?.();
    const frame = (t: number): void => {
      if (presenting !== state) return;
      Object.assign(vp(), lerpView(fromView, toView, t, rect.width, rect.height));
      state.hole = lerpBox(fromHole, toHole, Math.min(Math.max(t, 0), 1));
      applyViewport();
      drawPresentMask();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frame(1);
      return;
    }
    // Arc's motion spring, loaded with the rest of the board chrome.
    void import("motion").then(({ animate }) => {
      if (presenting !== state || state.index !== next) return;
      const controls = animate(0, 1, {
        type: "spring",
        visualDuration: 0.6,
        bounce: 0.12,
        onUpdate: frame,
        onComplete: () => frame(1),
      });
      state.stop = () => controls.stop();
    });
  }

  function onPresentKey(e: KeyboardEvent): void {
    if (!presenting) return;
    const forward = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"];
    const back = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];
    if (forward.includes(e.key)) goToSlide(presenting.index + 1);
    else if (back.includes(e.key)) goToSlide(presenting.index - 1);
    else if (e.key === "Home") goToSlide(0);
    else if (e.key === "End") goToSlide(presenting.slides.length - 1);
    else if (e.key === "Escape") stopPresenting();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /* --------------------------------------------------------- pointer */

  function handleAt(p: Point): HandleId | null {
    const box = selectionBox();
    if (!box || !selection.size) return null;
    const single = selection.size === 1 ? findEl(scene, [...selection][0]) : null;
    if (single && isLinker(single)) return null;
    if (selectionHasMind()) return null;
    const z = vp().zoom;
    const tol = SCREEN.handle / z;
    const positions = handlePositions(box);
    if (selection.size === 1) {
      const rotPoint = rotateHandlePoint(box, z);
      if (Math.hypot(p.x - rotPoint.x, p.y - rotPoint.y) <= tol) return "rot";
    }
    const ids: HandleId[] =
      selection.size === 1
        ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
        : ["nw", "ne", "se", "sw"];
    for (const id of ids) {
      const pos = positions[id];
      if (Math.abs(p.x - pos.x) <= tol && Math.abs(p.y - pos.y) <= tol) return id;
    }
    return null;
  }

  function selectionHasMind(): boolean {
    for (const id of selection) if (isMind(findEl(scene, id))) return true;
    return false;
  }

  /** Tab / Enter on a topic: add a child or a sibling, lay the map out again,
   *  and start typing in the new topic. */
  function addTopic(from: MindEl, kind: "child" | "sibling"): void {
    pushHistory();
    const topic = kind === "child" ? addMindChild(scene, from) : addMindSibling(scene, from);
    layoutMind(scene, mindRoot(scene, topic).id, measureText);
    selection = new Set([topic.id]);
    draw();
    markDirty();
    startTextEdit(topic);
  }

  function quickDotAt(p: Point): Side | null {
    if (selection.size !== 1 || activeEditor) return null;
    const el = findEl(scene, [...selection][0]);
    const sides = isMind(el)
      ? (Object.keys(mindDots(scene, el)) as Side[])
      : canQuickConnect(el)
        ? SIDES
        : null;
    if (!el || !sides) return null;
    const z = vp().zoom;
    const dots = quickDots(elementBounds(el), SCREEN.quickOffset / z);
    const reach = (SCREEN.quickDot + 5) / z;
    return (
      sides.find((side) => Math.hypot(p.x - dots[side].x, p.y - dots[side].y) <= reach) ?? null
    );
  }

  /** Quick-connect click: a blank copy of the shape on that side, joined by
   *  an elbow arrow, selected so typing labels it straight away. */
  function addNextStep(srcId: string, side: Side): void {
    const src = findEl(scene, srcId);
    if (isMind(src)) {
      // A topic's dot grows the map; the layout places the new topic.
      pushHistory();
      const topic = growMind(scene, src, side);
      if (!topic) return;
      layoutMind(scene, mindRoot(scene, topic).id, measureText);
      selection = new Set([topic.id]);
      draw();
      markDirty();
      startTextEdit(topic);
      return;
    }
    if (!canQuickConnect(src)) return;
    pushHistory();
    const next = blankCopy(src, nextStepBox(src, side, scene));
    scene.els.push(connectorBetween(src, next), next);
    selection = new Set([next.id]);
    draw();
    markDirty();
  }

  function snapshot(ids: Iterable<string>): Map<string, BoardEl> {
    const map = new Map<string, BoardEl>();
    for (const id of ids) {
      const el = findEl(scene, id);
      if (el) map.set(id, structuredClone(el));
    }
    return map;
  }

  function onPointerDown(e: PointerEvent): void {
    cachedStageRect = null;
    if (presenting) {
      // A click advances, like a slide deck; the board is not editable here.
      if (e.button === 0) goToSlide(presenting.index + 1);
      e.preventDefault();
      return;
    }
    if (e.button === 1 || spaceDown || tools.tool === "hand") {
      interaction = {
        kind: "pan",
        startClient: { x: e.clientX, y: e.clientY },
        startVp: { ...vp() },
      };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    toolbar.closeFlyout();
    closeTextEdit();
    if (opts.readOnly) return;

    const p = screenToScene(e.clientX, e.clientY);
    const tol = SCREEN.hitSlop / vp().zoom;

    if (tools.tool === "select") {
      const caret = caretShapeAt(p);
      if (caret) {
        toggleLabelExpand(caret);
        return;
      }
      const side = quickDotAt(p);
      if (side) {
        interaction = { kind: "quick", side, src: [...selection][0], origin: p };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      const handle = handleAt(p);
      if (handle === "rot") {
        const box = selectionBox();
        if (box) {
          const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
          interaction = {
            kind: "rotate",
            origin: p,
            center,
            startEls: snapshot(selection),
            startAngle: Math.atan2(p.y - center.y, p.x - center.x),
          };
          svg.setPointerCapture(e.pointerId);
          return;
        }
      } else if (handle) {
        const box = selectionBox();
        if (box) {
          interaction = {
            kind: "resize",
            handle,
            origin: p,
            startBox: box,
            startEls: snapshot(selection),
          };
          svg.setPointerCapture(e.pointerId);
          return;
        }
      }

      const hit = elementAt(scene, p, tol);
      if (hit) {
        if (!selection.has(hit.id)) select(expandByGroup([hit.id]), e.shiftKey);
        else if (e.shiftKey) {
          select([hit.id], true);
          return;
        }
        const ids = new Set(selection);
        // Dragging a frame carries its children. Collect the frames first, then
        // add the children — growing `ids` while iterating it would make the
        // loop visit entries it just inserted.
        const frameIds = new Set<string>();
        for (const id of ids) {
          if (findEl(scene, id)?.t === "frame") frameIds.add(id);
        }
        if (frameIds.size > 0) {
          for (const kid of scene.els) if (kid.fr && frameIds.has(kid.fr)) ids.add(kid.id);
        }
        // Dragging any topic carries its whole map; the layout owns relative positions.
        for (const id of [...ids]) {
          const el = findEl(scene, id);
          if (isMind(el)) for (const n of mindSubtree(scene, mindRoot(scene, el).id)) ids.add(n.id);
        }
        interaction = { kind: "drag", origin: p, startEls: snapshot(ids), moved: false };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      interaction = { kind: "marquee", origin: p, current: p, additive: e.shiftKey };
      if (!e.shiftKey) select([]);
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (tools.tool === "image") {
      pickImage();
      return;
    }

    if (tools.tool === "pen") {
      interaction = { kind: "pen", pts: [p] };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (tools.tool === "mind") {
      pushHistory();
      const root = newMindRoot(p);
      scene.els.push(root);
      layoutMind(scene, root.id, measureText);
      selection = new Set([root.id]);
      setTool("select");
      draw();
      markDirty();
      startTextEdit(root);
      return;
    }

    const el = makeElement(tools.tool, p);
    if (!el) return;
    if (isLinker(el)) {
      const target = linkTargetAt(p);
      if (target) el.b1 = { el: target.id, fx: 0, gap: 6 };
      interaction = { kind: "linking", el, origin: p };
    } else {
      interaction = { kind: "create", origin: p, el };
    }
    scene.els.push(el);
    svg.setPointerCapture(e.pointerId);
    draw();
  }

  /* Pointer moves are coalesced to one update per frame (Excalidraw's
     throttleRAF): a 120Hz trackpad can deliver several per frame, and each
     used to redraw. Pen points are the exception — they are all kept, using
     the browser's coalesced events, and only the drawing waits a frame. */
  /* The first move in a frame is applied at once, so it is painted in that
     same frame (no added latency). Further moves in the same frame only update
     `pendingMove`; the latest is applied when the frame turns. Deferring every
     move to the next rAF instead cost one full frame of lag (measured 8ms). */
  let pendingMove: PointerEvent | null = null;
  let moveFrame = 0;

  function onPointerMoveRaw(e: PointerEvent): void {
    if (interaction.kind === "pen") {
      const z = vp().zoom;
      for (const ce of e.getCoalescedEvents?.() ?? [e]) {
        const p = screenToScene(ce.clientX, ce.clientY);
        const last = interaction.pts[interaction.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * z >= 1.5) interaction.pts.push(p);
      }
    }
    if (moveFrame) {
      pendingMove = e;
      return;
    }
    onPointerMove(e);
    moveFrame = requestAnimationFrame(turnFrame);
  }

  function turnFrame(): void {
    moveFrame = 0;
    const e = pendingMove;
    pendingMove = null;
    if (e) onPointerMoveRaw(e);
  }

  /** Applies a still-pending move before a gesture ends, so the last position
   *  is never dropped. */
  function flushPendingMove(): void {
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    const e = pendingMove;
    pendingMove = null;
    if (e) onPointerMove(e);
  }

  function onPointerMove(e: PointerEvent): void {
    const p = screenToScene(e.clientX, e.clientY);
    pointerScene = p;

    if (interaction.kind === "none") {
      updateGhost();
      if (tools.tool === "linker") {
        const next = linkTargetAt(p)?.id ?? null;
        if (next !== hoverTarget) {
          hoverTarget = next;
          drawOverlay();
        }
      } else if (hoverTarget) {
        hoverTarget = null;
        drawOverlay();
      }
      return;
    }

    switch (interaction.kind) {
      case "pen": {
        // Points were collected as they arrived (onPointerMoveRaw).
        drawOverlay();
        return;
      }
      case "quick": {
        const z = vp().zoom;
        const o = interaction.origin;
        if (Math.hypot(p.x - o.x, p.y - o.y) < (SCREEN.minDrag * 2) / z) return;
        // Dragged off the dot: draw a connector out of that side instead.
        const src = findEl(scene, interaction.src);
        const el = makeElement("linker", o) as LinkerEl | null;
        if (!src || !el) return;
        el.t = "arrow";
        el.sh = "elbow";
        el.hd = { s: "none", e: "triangle" };
        el.b1 = { el: src.id, fx: 0, gap: 4 };
        scene.els.push(el);
        interaction = { kind: "linking", el, origin: o };
        onPointerMove(e);
        return;
      }
      case "pan": {
        const v = vp();
        v.x = interaction.startVp.x - (e.clientX - interaction.startClient.x) / v.zoom;
        v.y = interaction.startVp.y - (e.clientY - interaction.startClient.y) / v.zoom;
        panViewport();
        return;
      }
      case "marquee": {
        interaction.current = p;
        drawOverlay();
        return;
      }
      case "drag": {
        let dx = p.x - interaction.origin.x;
        let dy = p.y - interaction.origin.y;
        if (
          Math.abs(dx) > SCREEN.minDrag / vp().zoom ||
          Math.abs(dy) > SCREEN.minDrag / vp().zoom
        ) {
          interaction.moved = true;
        }
        // Below the drag threshold nothing moves: snapping a click's wobble
        // used to nudge the shape and draw guides that the release (a click,
        // so no commit) never cleared, with the quick-connect dots gone.
        if (!interaction.moved) return;
        const movingIds = new Set(interaction.startEls.keys());
        const movingBoxes = [...interaction.startEls.values()].map((el) => elementBounds(el));
        const union = boxesUnion(movingBoxes);
        activeGuides = [];
        if (union && !e.altKey) {
          const others = scene.els
            .filter((el) => !movingIds.has(el.id))
            .map((el) => elementBounds(el));
          const moved: Box = { ...union, x: union.x + dx, y: union.y + dy };
          const snap = snapMove(moved, others, SCREEN.snap / vp().zoom);
          dx += snap.dx;
          dy += snap.dy;
          activeGuides = snap.guides;
        }
        for (const [id, start] of interaction.startEls) {
          const el = findEl(scene, id);
          if (!el) continue;
          el.x = clampCoord(start.x + dx);
          el.y = clampCoord(start.y + dy);
        }
        drawGesture(interaction.startEls);
        return;
      }
      case "resize": {
        const dx = p.x - interaction.origin.x;
        const dy = p.y - interaction.origin.y;
        const next = resizeBox(
          interaction.startBox,
          interaction.handle,
          dx,
          dy,
          e.shiftKey,
          e.altKey,
        );
        const sx = interaction.startBox.w > 0 ? next.w / interaction.startBox.w : 1;
        const sy = interaction.startBox.h > 0 ? next.h / interaction.startBox.h : 1;
        for (const [id, start] of interaction.startEls) {
          const el = findEl(scene, id);
          if (!el) continue;
          if (el.t === "sticky") {
            el.x = next.x + (start.x - interaction.startBox.x) * sx;
            el.y = next.y + (start.y - interaction.startBox.y) * sy;
            continue;
          }
          el.x = clampCoord(next.x + (start.x - interaction.startBox.x) * sx);
          el.y = clampCoord(next.y + (start.y - interaction.startBox.y) * sy);
          el.w = Math.max(4, start.w * sx);
          el.h = Math.max(4, start.h * sy);
          if (isLinker(el) && isLinker(start)) {
            el.pts = start.pts.map(([qx, qy]) => [qx * sx, qy * sy] as [number, number]);
          }
        }
        drawGesture(interaction.startEls);
        return;
      }
      case "rotate": {
        const angle = Math.atan2(p.y - interaction.center.y, p.x - interaction.center.x);
        let delta = angle - interaction.startAngle;
        if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
        for (const [id, start] of interaction.startEls) {
          const el = findEl(scene, id);
          if (!el || isLinker(el)) continue;
          el.a = start.a + delta;
          const sc = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
          const moved = rotate(sc.x, sc.y, interaction.center.x, interaction.center.y, delta);
          el.x = moved.x - start.w / 2;
          el.y = moved.y - start.h / 2;
        }
        drawGesture(interaction.startEls);
        return;
      }
      case "create": {
        const el = interaction.el;
        const box = normalizeBox(interaction.origin, p);
        if (el.t === "sticky") {
          el.x = p.x - STICKY_SIZE / 2;
          el.y = p.y - STICKY_SIZE / 2;
        } else if (el.t === "frame" && FRAME_PRESETS[(el as { preset: FramePreset }).preset]) {
          el.x = box.x;
          el.y = box.y;
        } else {
          el.x = box.x;
          el.y = box.y;
          el.w = box.w;
          el.h = box.h;
          if (e.shiftKey) {
            const side = Math.max(box.w, box.h);
            el.w = side;
            el.h = side;
          }
        }
        draw();
        return;
      }
      case "linking": {
        const el = interaction.el;
        const candidate = linkTargetAt(p)?.id ?? null;
        if (candidate !== hoverTarget) hoverTarget = candidate;
        el.pts[el.pts.length - 1] = [p.x - el.x, p.y - el.y];
        draw();
        return;
      }
      default:
    }
  }

  function onPointerUp(e: PointerEvent): void {
    flushPendingMove();
    const p = screenToScene(e.clientX, e.clientY);
    const current = interaction;
    interaction = { kind: "none" };
    activeGuides = [];
    if (current.kind === "pen") {
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      // The pen stays on (Lark): each stroke is its own element and undo step.
      const stroke = strokeFrom(current.pts, defaultStyle({ w: 2 }), 0.75 / vp().zoom);
      if (stroke) {
        pushHistory();
        scene.els.push(stroke);
        draw();
        markDirty();
      } else drawOverlay();
      return;
    }
    if (current.kind === "quick") {
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      addNextStep(current.src, current.side);
      renderStyle();
      return;
    }
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }

    switch (current.kind) {
      case "pan": {
        // No save: a viewport move is not an edit. The view is written with
        // the next real change, or on close (the final commit always runs).
        drawOverlay();
        break;
      }
      case "marquee": {
        const box = normalizeBox(current.origin, current.current);
        // Fully-contained only. "Touch to select" makes large frames unusable.
        const ids = scene.els
          .filter((el) => boxContains(box, elementBounds(el)))
          .map((el) => el.id);
        select(expandByGroup(ids), current.additive);
        break;
      }
      case "drag": {
        if (current.moved) {
          restoreAndCommit(current.startEls, () => {
            for (const id of current.startEls.keys()) {
              const el = findEl(scene, id);
              if (el) assignFrame(el);
            }
          });
        } else {
          // A click: redraw so the overlay is the resting one (with the
          // quick-connect dots), whatever the gesture drew.
          drawOverlay();
        }
        break;
      }
      case "resize":
      case "rotate": {
        restoreAndCommit(current.startEls);
        break;
      }
      case "create": {
        const el = current.el;
        const tooSmall =
          el.t !== "sticky" &&
          (el.w < SCREEN.minDrag / vp().zoom || el.h < SCREEN.minDrag / vp().zoom);
        if (tooSmall && el.t !== "text") {
          // Treat a click-without-drag as "place a default-sized element",
          // except for shapes drawn to nothing, which are discarded.
          if (el.t === "frame") {
            el.w = 800;
            el.h = 600;
          } else if (isShape(el)) {
            el.w = SHAPE_DEFAULT.w;
            el.h = SHAPE_DEFAULT.h;
          }
        }
        // A click (not a drag) with the shape or note tool drops the item at
        // the cursor — beside a shape it is near, connected to it.
        const clicked =
          el.t === "sticky"
            ? Math.hypot(p.x - current.origin.x, p.y - current.origin.y) <
              SCREEN.minDrag / vp().zoom
            : tooSmall && isShape(el);
        const spot = clicked ? placeNear(scene, current.origin, el.w, el.h, el.id) : null;
        if (spot) {
          el.x = spot.box.x;
          el.y = spot.box.y;
        }
        scene.els = scene.els.filter((e2) => e2.id !== el.id);
        if (el.t !== "text" && (el.w < 2 || el.h < 2)) {
          draw();
          break;
        }
        pushHistory();
        addPlaced(el, spot?.from ?? null);
        if (el.t === "text" || el.t === "sticky") startTextEdit(el);
        break;
      }
      case "linking": {
        const el = current.el;
        scene.els = scene.els.filter((e2) => e2.id !== el.id);
        const start = { x: el.x, y: el.y };
        const end = p;
        if (Math.hypot(end.x - start.x, end.y - start.y) < SCREEN.minDrag * 2) {
          hoverTarget = null;
          draw();
          break;
        }
        const target = hoverTarget ? findEl(scene, hoverTarget) : null;
        el.pts = [
          [0, 0],
          [end.x - el.x, end.y - el.y],
        ];
        if (el.b1) {
          const src = findEl(scene, el.b1.el);
          if (src) el.b1.fx = computeFocus(src, start, end);
          else delete el.b1;
        }
        if (target) el.b2 = { el: target.id, fx: computeFocus(target, end, start), gap: 6 };
        pushHistory();
        scene.els.push(el);
        selection = new Set([el.id]);
        hoverTarget = null;
        setTool("select");
        draw();
        markDirty();
        break;
      }
      default:
        drawOverlay();
    }
    // Every gesture hides the selection toolbar; bring it back however it ended.
    renderStyle();
  }

  /** Rewinds to the pre-drag state, pushes that onto history, then re-applies —
   *  so one gesture is one undo step rather than one per pointermove. */
  function restoreAndCommit(startEls: Map<string, BoardEl>, after?: () => void): void {
    const final = new Map<string, BoardEl>();
    for (const id of startEls.keys()) {
      const el = findEl(scene, id);
      if (el) final.set(id, structuredClone(el));
    }
    for (const [id, start] of startEls) {
      const el = findEl(scene, id);
      if (el) Object.assign(el, structuredClone(start));
    }
    pushHistory();
    for (const [id, end] of final) {
      const el = findEl(scene, id);
      if (el) Object.assign(el, end);
    }
    after?.();
    draw();
    markDirty();
  }

  function onDoubleClick(e: MouseEvent): void {
    if (presenting) return;
    if (opts.readOnly) return;
    const p = screenToScene(e.clientX, e.clientY);
    const hit = elementAt(scene, p, SCREEN.hitSlop / vp().zoom);
    if (!hit) {
      // Double-click on empty canvas drops a text element — the fastest path
      // to "just write something here".
      const el = makeElement("text", p);
      if (!el) return;
      pushHistory();
      scene.els.push(el);
      selection = new Set([el.id]);
      draw();
      markDirty();
      startTextEdit(el);
      return;
    }
    if (hit.t === "frame") {
      const name = window.prompt("Section name", (hit as { name: string }).name);
      if (name !== null) {
        pushHistory();
        (hit as { name: string }).name = name || "Section";
        draw();
        markDirty();
      }
      return;
    }
    if (hit.t === "image") return;
    selection = new Set([hit.id]);
    draw();
    startTextEdit(hit);
  }

  /** On the host, so a pinch or Cmd-scroll over the board's own chrome (the
   *  selection toolbar, the dock) still zooms the board. Plain scrolling pans
   *  only from the canvas, so a scrollable panel on the board still scrolls. */
  function onWheel(e: WheelEvent): void {
    const zoom = e.ctrlKey || e.metaKey;
    if (!zoom && !svg.contains(e.target as Node)) return;
    e.preventDefault();
    if (presenting) return;
    if (zoom) {
      const factor = Math.exp(-e.deltaY / 260);
      zoomGesture(vp().zoom * factor, { x: e.clientX, y: e.clientY });
      return;
    }
    const v = vp();
    v.x += e.deltaX / v.zoom;
    v.y += e.deltaY / v.zoom;
    panViewport();
  }

  /* -------------------------------------------------------- keyboard */

  /** Shape shortcuts drop a default-sized shape in the middle of the view,
   *  selected, so it is on the board at once; resize it to change its size.
   *  Each press lands one step down-right of a shape already sitting there,
   *  so repeated presses don't stack invisibly. */
  function placeShape(kind: ShapeKind): void {
    tools.shape = kind;
    const el = makeElement("shape", { x: 0, y: 0 }) as ShapeEl;
    el.w = SHAPE_DEFAULT.w;
    el.h = SHAPE_DEFAULT.h;
    // At the cursor when it is over the board, beside a shape it is near.
    const at = pointerScene ?? viewCenterScene();
    const spot = pointerScene ? placeNear(scene, at, el.w, el.h) : null;
    el.x = spot ? spot.box.x : at.x - el.w / 2;
    el.y = spot ? spot.box.y : at.y - el.h / 2;
    if (!spot?.from) {
      // Repeated presses on one spot step down-right instead of stacking.
      const step = 24 / vp().zoom;
      while (scene.els.some((o) => o.x === el.x && o.y === el.y)) {
        el.x += step;
        el.y += step;
      }
    }
    pushHistory();
    addPlaced(el, spot?.from ?? null);
  }

  /** Adds a newly placed shape or note — and, when it was placed beside
   *  `from`, the arrow from `from` to it — selects it, and saves. The caller
   *  has pushed the undo step. */
  function addPlaced(el: BoardEl, from: BoardEl | null): void {
    assignFrame(el);
    scene.els.push(el);
    if (from) scene.els.push(connectorBetween(from, el));
    selection = new Set([el.id]);
    ghost = null;
    setTool("select");
    draw();
    markDirty();
  }

  function updateGhost(): void {
    const kind = tools.tool;
    const next =
      pointerScene && interaction.kind === "none" && (kind === "shape" || kind === "sticky")
        ? kind === "shape"
          ? placeNear(scene, pointerScene, SHAPE_DEFAULT.w, SHAPE_DEFAULT.h)
          : placeNear(scene, pointerScene, STICKY_SIZE, STICKY_SIZE)
        : null;
    if (!next && !ghost) return;
    ghost = next;
    drawOverlay();
  }

  const TOOL_KEYS: Record<string, () => void> = {
    v: () => setTool("select"),
    m: () => setTool("mind"),
    p: () => setTool("pen"),
    h: () => setTool("hand"),
    r: () => placeShape("roundRect"),
    o: () => placeShape("ellipse"),
    d: () => placeShape("diamond"),
    t: () => setTool("text"),
    n: () => setTool("sticky"),
    l: () => {
      tools.linker = { kind: "line", shape: "straight" };
      setTool("linker");
    },
    a: () => {
      tools.linker = { kind: "arrow", shape: "straight" };
      setTool("linker");
    },
  };

  function onKeyDown(e: KeyboardEvent): void {
    if (presenting) {
      onPresentKey(e);
      return;
    }
    if (activeEditor) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === " " && !spaceDown) {
      spaceDown = true;
      host.dataset.panning = "1";
      return;
    }

    if (e.key === "Escape") {
      // Three-step retreat. Collapsing this into "Esc closes the board" is how
      // you lose work by flinching mid-drag.
      e.preventDefault();
      e.stopPropagation();
      if (interaction.kind === "create" || interaction.kind === "linking") {
        scene.els = scene.els.filter((el) => el.id !== (interaction as { el: BoardEl }).el.id);
        interaction = { kind: "none" };
        setTool("select");
        draw();
        return;
      }
      if (selection.size) {
        select([]);
        return;
      }
      opts.onClose();
      return;
    }

    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      select(scene.els.map((el) => el.id));
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelection();
      return;
    }
    const emphasis = emphasisKey(e);
    if (emphasis && selection.size) {
      e.preventDefault();
      toggleSelectionEmphasis(emphasis);
      return;
    }
    if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault();
      groupSelection(!e.shiftKey);
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomBy(ZOOM_STEP);
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      setZoom(1);
      return;
    }
    if (mod && e.key === "1") {
      e.preventDefault();
      zoomToFit();
      return;
    }
    if (mod && e.key === "]") {
      e.preventDefault();
      reorder(1);
      return;
    }
    if (mod && e.key === "[") {
      e.preventDefault();
      reorder(-1);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if ((e.key === "Tab" || e.key === "Enter") && selection.size === 1 && !mod) {
      const el = findEl(scene, [...selection][0]);
      if (isMind(el)) {
        e.preventDefault();
        // Lark: Tab adds a child, Enter a sibling (a child on the root).
        addTopic(el, e.key === "Tab" ? "child" : "sibling");
        return;
      }
    }
    if (e.key === "Enter" && selection.size === 1) {
      const el = findEl(scene, [...selection][0]);
      if (el && el.t !== "image" && el.t !== "frame") {
        e.preventDefault();
        startTextEdit(el);
      }
      return;
    }
    if (e.key === "S" && e.shiftKey && !mod) {
      e.preventDefault();
      setTool("frame");
      return;
    }
    // Typing on one selected shape, note or text edits it (Lark, FigJam). Tool
    // shortcuts still work with nothing selected.
    if (!mod && !e.altKey && e.key.length === 1 && selection.size === 1) {
      const el = findEl(scene, [...selection][0]);
      if (el && (isShape(el) || el.t === "sticky" || el.t === "text" || isLinker(el))) {
        e.preventDefault();
        startTextEdit(el, e.key);
        return;
      }
    }
    if (!mod && !e.shiftKey && !e.altKey) {
      const handler = TOOL_KEYS[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler();
        return;
      }
      const step = 1;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = arrows[e.key];
      if (delta && selection.size) {
        e.preventDefault();
        pushHistory();
        for (const id of selection) {
          const el = findEl(scene, id);
          if (!el) continue;
          el.x = clampCoord(el.x + delta[0]);
          el.y = clampCoord(el.y + delta[1]);
        }
        draw();
        markDirty();
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === " ") {
      spaceDown = false;
      delete host.dataset.panning;
    }
  }

  /** Adds elements laid out from (0, 0), centred on `at`, as one undo step. */
  function placeImported(els: BoardEl[], at: Point): void {
    const box = boxesUnion(els.map((el) => elementBounds(el)));
    if (!box) return;
    const dx = at.x - (box.x + box.w / 2);
    const dy = at.y - (box.y + box.h / 2);
    pushHistory();
    for (const el of els) {
      el.x = Math.round(el.x + dx);
      el.y = Math.round(el.y + dy);
    }
    scene.els.push(...els);
    selection = new Set(els.map((el) => el.id));
    draw();
    markDirty();
  }

  function onPaste(e: ClipboardEvent): void {
    if (activeEditor || opts.readOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        void placeImageFile(file, pointerScene ?? viewCenterScene());
        return;
      }
    }
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const at = viewCenterScene();
    // Pasted Mermaid flowchart / mind map: drop it in as editable shapes.
    const imported = mermaidToElements(text, measureText);
    if (imported) {
      placeImported(imported, at);
      return;
    }
    const el = makeElement("text", at) as TextEl | null;
    if (!el) return;
    el.tx = text;
    el.h = Math.max(24, text.split("\n").length * el.sz * 1.35);
    pushHistory();
    scene.els.push(el);
    selection = new Set([el.id]);
    draw();
    markDirty();
  }

  function onDrop(e: DragEvent): void {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    e.preventDefault();
    void placeImageFile(file, screenToScene(e.clientX, e.clientY));
  }

  function onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  }

  /* ---------------------------------------------------------- wiring */

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMoveRaw);
  svg.addEventListener("pointerleave", () => {
    pointerScene = null;
    updateGhost();
  });
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);
  host.addEventListener("paste", onPaste);
  host.addEventListener("drop", onDrop);
  host.addEventListener("dragover", onDragOver);

  const resizeObserver = new ResizeObserver(() => {
    cachedStageRect = null;
    applyViewport();
    draw();
  });
  resizeObserver.observe(host);

  setTool("select");
  applyViewport();
  draw();
  toolbar.setHistory(false, false);
  if (opts.present) requestAnimationFrame(() => startPresenting(0));

  return {
    destroy() {
      disposed = true;
      resizeObserver.disconnect();
      selToolbarResize.disconnect();
      selToolbar?.destroy();
      selToolbar = null;
      toolDock?.destroy();
      toolDock = null;
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMoveRaw);
      if (moveFrame) cancelAnimationFrame(moveFrame);
      if (recullFrame) cancelAnimationFrame(recullFrame);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("dblclick", onDoubleClick);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      host.removeEventListener("paste", onPaste);
      host.removeEventListener("drop", onDrop);
      host.removeEventListener("dragover", onDragOver);
      renderer.clear();
      host.replaceChildren();
    },
    flush() {
      closeTextEdit();
      return scene;
    },
    find() {
      openFind();
    },
    focus() {
      host.focus();
    },
  };
}

function rotateHandlePoint(box: Box, zoom: number): Point {
  const off = 16 / zoom;
  return { x: box.x - off, y: box.y + box.h + off };
}

function normalizeBox(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Static render used by the in-document preview card. */
export function renderStaticBoard(
  scene: BoardScene,
  width: number,
  height: number,
  resolveSrc: (src: string) => string,
): SVGSVGElement {
  const svg = svgEl("svg", {
    class: "wr-board-static",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
  const world = svgEl("g");
  svg.append(world);
  const renderer = new SceneRenderer(world);
  const boxes = scene.els.map((el) => elementBounds(el));
  const union = boxesUnion(boxes);
  if (union && union.w > 0 && union.h > 0) {
    const pad = 24;
    const zoom = Math.min((width - pad * 2) / union.w, (height - pad * 2) / union.h, 1);
    const tx = (width - union.w * zoom) / 2 - union.x * zoom;
    const ty = (height - union.h * zoom) / 2 - union.y * zoom;
    world.setAttribute("transform", `translate(${tx} ${ty}) scale(${zoom})`);
  }
  renderer.render(scene, { resolveSrc, scene }, scene.els);
  return svg;
}
