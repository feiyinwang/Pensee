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
  type ColorToken,
  type FramePreset,
  type ImageEl,
  type LinkerEl,
  type ShapeEl,
  type StrokeDash,
  type TextEl,
  type Viewport,
  FRAME_PRESETS,
  STICKY_SIZE,
  clampCoord,
  clampZoom,
  cloneScene,
  defaultStyle,
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
  routeLinker,
  snapMove,
} from "./board-geometry";
import { SceneRenderer, backgroundDefs, svgEl } from "./board-render";
import {
  type StyleTargets,
  type ToolId,
  type ToolState,
  type Toolbar,
  buildToolbar,
  renderStylePanel,
} from "./board-tools";

/* -------------------------------------------------------------- constants */

/** All in SCREEN pixels. Divided by zoom at the point of use. */
const SCREEN = {
  hitSlop: 8,
  handle: 9,
  rotateOffset: 26,
  snap: 6,
  minDrag: 4,
} as const;

const CULL_THRESHOLD = 300;
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
}

export interface BoardCanvasHandle {
  destroy: () => void;
  flush: () => BoardScene;
  focus: () => void;
}

type Interaction =
  | { kind: "none" }
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

export function mountBoardCanvas(host: HTMLElement, opts: BoardCanvasOptions): BoardCanvasHandle {
  let scene = cloneScene(opts.scene);
  let selection = new Set<string>();
  let interaction: Interaction = { kind: "none" };
  let spaceDown = false;
  let hoverTarget: string | null = null;
  let disposed = false;

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

  const svg = svgEl("svg", { class: "wr-board-svg" });
  svg.append(backgroundDefs());
  const bg = svgEl("rect", { x: 0, y: 0, width: "100%", height: "100%" });
  const world = svgEl("g", { class: "wr-board-world" });
  const content = svgEl("g", { class: "wr-board-content" });
  const overlay = svgEl("g", { class: "wr-board-overlay" });
  world.append(content, overlay);
  svg.append(bg, world);
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
  });
  host.append(toolbar.root);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void placeImageFile(file, viewCenterScene());
  });
  host.append(fileInput);

  /* -------------------------------------------------------- viewport */

  const vp = () => scene.header.vp;

  function screenToScene(clientX: number, clientY: number): Point {
    const rect = svg.getBoundingClientRect();
    const v = vp();
    return {
      x: (clientX - rect.left) / v.zoom + v.x,
      y: (clientY - rect.top) / v.zoom + v.y,
    };
  }

  function viewCenterScene(): Point {
    const rect = svg.getBoundingClientRect();
    return screenToScene(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function applyViewport(): void {
    const v = vp();
    world.setAttribute(
      "transform",
      `translate(${-v.x * v.zoom} ${-v.y * v.zoom}) scale(${v.zoom})`,
    );
    const pattern = scene.header.bg === "grid" ? "wr-board-grid" : "wr-board-dots";
    bg.setAttribute("fill", scene.header.bg === "none" ? "transparent" : `url(#${pattern})`);
    bg.setAttribute(
      "transform",
      `translate(${(-v.x * v.zoom) % (24 * v.zoom)} ${(-v.y * v.zoom) % (24 * v.zoom)})`,
    );
    const dots = svg.querySelector("#wr-board-dots");
    const grid = svg.querySelector("#wr-board-grid");
    for (const p of [dots, grid]) {
      if (p) p.setAttribute("patternTransform", `scale(${v.zoom})`);
    }
    toolbar.setZoom(v.zoom);
  }

  function setZoom(next: number, anchorClient?: Point): void {
    const v = vp();
    const zoom = clampZoom(next);
    if (anchorClient) {
      const before = screenToScene(anchorClient.x, anchorClient.y);
      v.zoom = zoom;
      const after = screenToScene(anchorClient.x, anchorClient.y);
      v.x += before.x - after.x;
      v.y += before.y - after.y;
    } else {
      const rect = svg.getBoundingClientRect();
      const cx = v.x + rect.width / v.zoom / 2;
      const cy = v.y + rect.height / v.zoom / 2;
      v.zoom = zoom;
      v.x = cx - rect.width / zoom / 2;
      v.y = cy - rect.height / zoom / 2;
    }
    applyViewport();
    draw();
    markDirty();
  }

  function zoomBy(factor: number): void {
    setZoom(vp().zoom * factor);
  }

  function zoomToFit(): void {
    const boxes = scene.els.map((el) => elementBounds(el));
    const union = boxesUnion(boxes);
    const rect = svg.getBoundingClientRect();
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

  function visibleElements(): BoardEl[] {
    if (scene.els.length < CULL_THRESHOLD) return scene.els;
    const rect = svg.getBoundingClientRect();
    const v = vp();
    const view: Box = {
      x: v.x - 200 / v.zoom,
      y: v.y - 200 / v.zoom,
      w: rect.width / v.zoom + 400 / v.zoom,
      h: rect.height / v.zoom + 400 / v.zoom,
    };
    return scene.els.filter((el) => boxesOverlap(elementBounds(el), view));
  }

  function draw(): void {
    renderer.render(scene, { resolveSrc: opts.resolveSrc, scene }, visibleElements());
    drawOverlay();
    renderStyle();
  }

  function selectionBox(): Box | null {
    const boxes = [...selection]
      .map((id) => findEl(scene, id))
      .filter((el): el is BoardEl => Boolean(el))
      .map((el) => elementBounds(el));
    return boxesUnion(boxes);
  }

  function drawOverlay(): void {
    overlay.replaceChildren();
    const z = vp().zoom;
    const px = (n: number) => n / z;

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
      const p = { x: box.x + box.w / 2, y: box.y - px(SCREEN.rotateOffset) };
      overlay.append(
        svgEl("line", {
          x1: box.x + box.w / 2,
          y1: box.y,
          x2: p.x,
          y2: p.y,
          class: "wr-board-handle-stem",
          "stroke-width": px(1),
        }),
      );
      overlay.append(
        svgEl("circle", {
          cx: p.x,
          cy: p.y,
          r: size / 2,
          class: "wr-board-handle",
          "stroke-width": px(1),
          "data-handle": "rot",
        }),
      );
    }
  }

  let activeGuides: { x?: number; y?: number; from: number; to: number }[] = [];

  /* ------------------------------------------------------ style panel */

  function renderStyle(): void {
    const els = [...selection].map((id) => findEl(scene, id)).filter(Boolean) as BoardEl[];
    if (!els.length) {
      renderStylePanel(toolbar.stylePanel, null, styleHandlers);
      return;
    }
    const targets: StyleTargets = {};
    const styled = els.filter(hasStyle);
    if (styled.length) {
      targets.stroke = styled[0].st.s;
      targets.width = styled[0].st.w;
      targets.dash = styled[0].st.d;
      if (styled.some(isShape)) targets.fill = (styled.find(isShape) as ShapeEl).st.f;
    }
    const texts = els.filter((el) => el.t === "text") as TextEl[];
    if (texts.length) targets.fontSize = texts[0].sz;
    targets.opacity = els[0].op;
    renderStylePanel(toolbar.stylePanel, targets, styleHandlers);
  }

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

  const styleHandlers = {
    setStroke: (c: ColorToken) => mutateSelection((el) => hasStyle(el) && (el.st.s = c)),
    setFill: (c: ColorToken) => mutateSelection((el) => isShape(el) && (el.st.f = c)),
    setWidth: (w: number) => mutateSelection((el) => hasStyle(el) && (el.st.w = w)),
    setDash: (d: StrokeDash) => mutateSelection((el) => hasStyle(el) && (el.st.d = d)),
    setOpacity: (o: number) => mutateSelection((el) => (el.op = o)),
    setFontSize: (s: number) =>
      mutateSelection((el) => {
        if (el.t === "text") el.sz = s;
        else if (isShape(el) && el.lb) el.lb.sz = s;
      }),
    bringForward: () => reorder(1),
    sendBackward: () => reorder(-1),
    duplicate: () => duplicateSelection(),
    remove: () => deleteSelection(),
  };

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

  function setTool(tool: ToolId): void {
    tools.tool = tool;
    toolbar.setTool(tool);
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
    draw();
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
    scene.els = scene.els.filter((el) => !doomed.has(el.id));
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

  function styleForNew(): ReturnType<typeof defaultStyle> {
    return defaultStyle();
  }

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
          st: styleForNew(),
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
          st: styleForNew(),
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

  /* --------------------------------------------------- text editing */

  let activeEditor: HTMLTextAreaElement | null = null;

  function startTextEdit(el: BoardEl): void {
    if (opts.readOnly) return;
    closeTextEdit();
    const v = vp();
    const rect = svg.getBoundingClientRect();
    const area = document.createElement("textarea");
    // Zero chrome: this must read as the text itself, not as a form control.
    area.className = "wr-board-text-editor";
    area.value = textOf(el);
    area.spellcheck = false;
    const pad = el.t === "sticky" ? 16 : isShape(el) ? 10 : 0;
    // `lb` only exists on shapes, so the shape guard has to come before the
    // property access — the ternary chain alone does not narrow the union.
    const size =
      el.t === "text" ? el.sz : el.t === "sticky" ? 16 : isShape(el) ? (el.lb?.sz ?? 14) : 14;
    area.style.left = `${(el.x - v.x) * v.zoom + pad * v.zoom}px`;
    area.style.top = `${(el.y - v.y) * v.zoom + pad * v.zoom}px`;
    area.style.width = `${Math.max(el.w - pad * 2, 60) * v.zoom}px`;
    area.style.height = `${Math.max(el.h - pad * 2, size * 1.4) * v.zoom}px`;
    area.style.fontSize = `${size * v.zoom}px`;
    area.style.textAlign =
      el.t === "text" ? alignCss(el.al) : isShape(el) ? alignCss(el.lb?.al ?? "c") : "left";
    void rect;

    const commit = (): void => {
      const next = area.value;
      if (next !== textOf(el)) {
        pushHistory();
        setTextOf(el, next);
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
      if (activeEditor === area) activeEditor = null;
      host.focus();
    };

    area.addEventListener("blur", commit);
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    });
    editorLayer.append(area);
    activeEditor = area;
    area.focus();
    area.select();
  }

  function closeTextEdit(): void {
    activeEditor?.blur();
    activeEditor = null;
  }

  function alignCss(a: "l" | "c" | "r"): string {
    return a === "c" ? "center" : a === "r" ? "right" : "left";
  }

  /* --------------------------------------------------------- pointer */

  function handleAt(p: Point): HandleId | null {
    const box = selectionBox();
    if (!box || !selection.size) return null;
    const single = selection.size === 1 ? findEl(scene, [...selection][0]) : null;
    if (single && isLinker(single)) return null;
    const z = vp().zoom;
    const tol = SCREEN.handle / z;
    const positions = handlePositions(box);
    if (selection.size === 1) {
      const rotPoint = { x: box.x + box.w / 2, y: box.y - SCREEN.rotateOffset / z };
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

  function snapshot(ids: Iterable<string>): Map<string, BoardEl> {
    const map = new Map<string, BoardEl>();
    for (const id of ids) {
      const el = findEl(scene, id);
      if (el) map.set(id, structuredClone(el));
    }
    return map;
  }

  function onPointerDown(e: PointerEvent): void {
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

    const el = makeElement(tools.tool, p);
    if (!el) return;
    if (isLinker(el)) {
      const target = elementAt(scene, p, tol);
      if (target && target.t !== "frame") {
        el.b1 = { el: target.id, fx: 0, gap: 6 };
      }
      interaction = { kind: "linking", el, origin: p };
    } else {
      interaction = { kind: "create", origin: p, el };
    }
    scene.els.push(el);
    svg.setPointerCapture(e.pointerId);
    draw();
  }

  function onPointerMove(e: PointerEvent): void {
    const p = screenToScene(e.clientX, e.clientY);

    if (interaction.kind === "none") {
      if (tools.tool === "linker") {
        const target = elementAt(scene, p, SCREEN.hitSlop / vp().zoom);
        const next = target && target.t !== "frame" ? target.id : null;
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
      case "pan": {
        const v = vp();
        v.x = interaction.startVp.x - (e.clientX - interaction.startClient.x) / v.zoom;
        v.y = interaction.startVp.y - (e.clientY - interaction.startClient.y) / v.zoom;
        applyViewport();
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
        draw();
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
        draw();
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
        draw();
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
        const target = elementAt(scene, p, SCREEN.hitSlop / vp().zoom);
        const candidate = target && target.t !== "frame" && target.id !== el.id ? target.id : null;
        if (candidate !== hoverTarget) hoverTarget = candidate;
        el.pts[el.pts.length - 1] = [p.x - el.x, p.y - el.y];
        draw();
        return;
      }
      default:
    }
  }

  function onPointerUp(e: PointerEvent): void {
    const p = screenToScene(e.clientX, e.clientY);
    const current = interaction;
    interaction = { kind: "none" };
    activeGuides = [];
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }

    switch (current.kind) {
      case "pan": {
        markDirty();
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
            el.w = 160;
            el.h = 110;
            el.x = current.origin.x - 80;
            el.y = current.origin.y - 55;
          }
        }
        scene.els = scene.els.filter((e2) => e2.id !== el.id);
        if (el.t !== "text" && (el.w < 2 || el.h < 2)) {
          draw();
          break;
        }
        pushHistory();
        assignFrame(el);
        scene.els.push(el);
        selection = new Set([el.id]);
        setTool("select");
        draw();
        markDirty();
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
    if (hit.t === "image" || isLinker(hit)) return;
    selection = new Set([hit.id]);
    draw();
    startTextEdit(hit);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY / 260);
      setZoom(vp().zoom * factor, { x: e.clientX, y: e.clientY });
      return;
    }
    const v = vp();
    v.x += e.deltaX / v.zoom;
    v.y += e.deltaY / v.zoom;
    applyViewport();
    scheduleViewportSave();
  }

  let viewportSaveTimer = -1;
  function scheduleViewportSave(): void {
    window.clearTimeout(viewportSaveTimer);
    viewportSaveTimer = window.setTimeout(() => markDirty(), 400);
  }

  /* -------------------------------------------------------- keyboard */

  const TOOL_KEYS: Record<string, () => void> = {
    v: () => setTool("select"),
    h: () => setTool("hand"),
    r: () => {
      tools.shape = "roundRect";
      setTool("shape");
    },
    o: () => {
      tools.shape = "ellipse";
      setTool("shape");
    },
    d: () => {
      tools.shape = "diamond";
      setTool("shape");
    },
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
    if (e.key === "Enter" && selection.size === 1) {
      const el = findEl(scene, [...selection][0]);
      if (el && !isLinker(el) && el.t !== "image") {
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

  function onPaste(e: ClipboardEvent): void {
    if (activeEditor || opts.readOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        void placeImageFile(file, viewCenterScene());
        return;
      }
    }
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const at = viewCenterScene();
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
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("dblclick", onDoubleClick);
  svg.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);
  host.addEventListener("paste", onPaste);
  host.addEventListener("drop", onDrop);
  host.addEventListener("dragover", onDragOver);

  const resizeObserver = new ResizeObserver(() => {
    applyViewport();
    draw();
  });
  resizeObserver.observe(host);

  setTool("select");
  applyViewport();
  draw();
  toolbar.setHistory(false, false);

  return {
    destroy() {
      disposed = true;
      window.clearTimeout(viewportSaveTimer);
      resizeObserver.disconnect();
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("dblclick", onDoubleClick);
      svg.removeEventListener("wheel", onWheel);
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
    focus() {
      host.focus();
    },
  };
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
