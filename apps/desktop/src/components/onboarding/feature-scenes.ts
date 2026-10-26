/**
 * The animated demos on onboarding's last screen (SPECs/onboarding-spec.md):
 * each slide plays a short scripted scene of the real UI, drawn in the app's
 * own type and colours, with the keys it uses shown as they are pressed.
 * Plain DOM, not React: a scene is markup plus a timeline of class changes,
 * and nothing re-renders while it plays.
 *
 * Scene space is 600 × 360; `relBox` maps the carousel's scale back to it.
 */
import atomic from "./assets/atomic.jpg";
import bird from "./assets/bird.jpg";
import creativeAct from "./assets/creative-act.jpg";
import dwarkesh from "./assets/dwarkesh.jpg";
import secondBrain from "./assets/second-brain.jpg";
import smartNotes from "./assets/smart-notes.jpg";
import strunk from "./assets/strunk.jpg";
import { keyLabel } from "@/lib/platform";

export const SCENE_W = 600;
const SCENE_H = 360;

export type FeatureId = "tabs" | "board" | "connect" | "check" | "dump" | "library" | "podcast";

export interface Feature {
  id: FeatureId;
  title: string;
  d: string;
  keys: string[];
}

export const FEATURES: Feature[] = [
  {
    id: "tabs",
    title: "See every tab at once",
    d: "Pinch in on the trackpad and every open tab sits side by side. Pinch out on one to read it alone.",
    keys: ["Pinch"],
  },
  {
    id: "board",
    title: "Map the essay before you write it",
    d: "Drag a card near another and let go: it docks after it, joined by an arrow.",
    keys: ["/board"],
  },
  {
    id: "connect",
    title: "Find what you already wrote",
    d: "Pensée finds past notes on the same idea and links them under your line.",
    keys: ["⌘", ".", "[["],
  },
  {
    id: "check",
    title: "Check a claim against real papers",
    d: "Evidence for and against, each with its paper. The call stays yours.",
    keys: ["⌘", ".", "@"],
  },
  {
    id: "dump",
    title: "Turn a brain dump into a plan",
    d: "Type fast and messy. Pensée sorts your lines into an outline, in your own words.",
    keys: ["⌘", ".", "#"],
  },
  {
    id: "library",
    title: "Read a book beside its note",
    d: "Your books, papers and podcasts sit in one Library. Open a book and it reads beside its note; each highlight lands as a bullet.",
    keys: ["⌘G", "L"],
  },
  {
    id: "podcast",
    title: "Notes pinned to the moment",
    d: "Podcasts and videos play inside the note. ⌘S pins a line to its second; click the pin to jump back.",
    keys: ["⌘", "S"],
  },
];

/* ------------------------------------------------------------ icons */

const I = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ic = {
  pin: I(
    '<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  ),
  paper: I('<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>'),
  back: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  fwd: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  vol: I(
    '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  ),
  pause:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
};

const fmt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

/* ------------------------------------------------------------ the engine */

interface SceneRoot extends HTMLElement {
  tick?: number;
  charge?: { stop: () => void };
}

interface R {
  root: SceneRoot;
  instant: boolean;
  q: (selector: string) => HTMLElement;
}

interface Timeline {
  wait: (ms: number) => void;
  do: (fn: (r: R) => void) => void;
  cursor: (x: number, y: number, ms?: number) => void;
  cursorTo: (selector: string, ms?: number, dx?: number, dy?: number) => void;
  keys: (list: string[], label: string) => void;
  type: (selector: string, text: string, cps?: number) => void;
  typeData: (selector: string, cps?: number) => void;
}

let timers: number[] = [];
let current: SceneRoot | null = null;
/** Bumped by `stopScene`, so frame loops from a stopped scene end. */
let generation = 0;

export function stopScene(): void {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
  generation += 1;
  if (current?.tick) window.clearInterval(current.tick);
  current = null;
}

/** An element's box in the scene's own 600 × 360 space, whatever the scale. */
function relBox(root: HTMLElement, el: Element | null) {
  if (!el) return null;
  const R = root.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const k = R.width / SCENE_W || 1;
  return { x: (b.left - R.left) / k, y: (b.top - R.top) / k, w: b.width / k, h: b.height / k };
}

function moveCursor(r: R, x: number, y: number, ms: number) {
  const c = r.q(".sc-cur");
  c.style.transitionDuration = `${ms}ms, 160ms`;
  c.style.opacity = "1";
  c.style.transform = `translate(${x}px, ${y}px)`;
}

function timeline(root: SceneRoot, instant: boolean): Timeline {
  let t = 0;
  const r: R = { root, instant, q: (s) => root.querySelector<HTMLElement>(s)! };
  const at = (ms: number, fn: (r: R) => void) => {
    if (instant) fn(r);
    else timers.push(window.setTimeout(() => fn(r), ms));
  };
  const kv = () => r.q(".sc-kov");
  return {
    wait(ms) {
      t += ms;
    },
    do(fn) {
      at(t, fn);
    },
    cursor(x, y, ms = 700) {
      at(t, () => moveCursor(r, x, y, ms));
      t += ms;
    },
    cursorTo(selector, ms = 700, dx = 0, dy = 0) {
      at(t, () => {
        const p = relBox(root, root.querySelector(selector));
        if (p) moveCursor(r, p.x + p.w / 2 + dx, p.y + p.h / 2 + dy, ms);
      });
      t += ms;
    },
    keys(list, label) {
      at(t, () => {
        const k = kv();
        k.querySelector(".sc-kk")!.innerHTML = list
          .map((x) => keyLabel(x))
          .map((x) => `<span class="sc-kc${x.length > 2 ? " g" : ""}">${x}</span>`)
          .join("");
        k.querySelector(".sc-kl")!.textContent = label;
        k.classList.add("on");
      });
      list.forEach((_, i) => {
        at(t + 160 + i * 170, () => kv().querySelectorAll(".sc-kc")[i]?.classList.add("down"));
        at(t + 300 + i * 170, () => kv().querySelectorAll(".sc-kc")[i]?.classList.remove("down"));
      });
      t += 300 + list.length * 170 + 200;
      at(t + 700, () => kv().classList.remove("on"));
    },
    type(selector, text, cps = 30) {
      for (let i = 1; i <= text.length; i += 1) {
        at(t + i * cps, () => {
          r.q(selector).textContent = text.slice(0, i);
        });
      }
      t += text.length * cps;
    },
    typeData(selector, cps = 30) {
      const el = r.q(selector);
      const text = el.dataset.text ?? "";
      for (let i = 1; i <= text.length; i += 1) {
        at(t + i * cps, () => {
          el.firstChild!.textContent = text.slice(0, i);
        });
      }
      t += text.length * cps;
    },
  };
}

function placeAbove(root: HTMLElement, selector: string, anchorSelector: string) {
  const el = root.querySelector<HTMLElement>(selector);
  const a = relBox(root, root.querySelector(anchorSelector));
  if (!el || !a) return;
  const host = el.offsetParent ? relBox(root, el.offsetParent)! : { x: 0, y: 0 };
  const left = Math.max(6, a.x + a.w / 2 - el.offsetWidth / 2 - host.x);
  const top = Math.max(6, a.y - el.offsetHeight - 8 - host.y);
  Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  el.classList.remove("h");
}

function placeCard(root: HTMLElement, cardSelector: string, anchorSelector: string) {
  const card = root.querySelector<HTMLElement>(cardSelector);
  const a = relBox(root, root.querySelector(anchorSelector));
  if (!card || !a) return;
  const left = Math.max(12, Math.min(SCENE_W - card.offsetWidth - 12, a.x - 16));
  let top = a.y + a.h + 8;
  if (top + card.offsetHeight > SCENE_H - 12) top = Math.max(12, a.y - card.offsetHeight - 8);
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  card.classList.remove("h");
}

/** Plays scene `id` into `root` from the start. Reduced motion shows its end. */
export function playScene(root: HTMLElement, id: FeatureId, onDone: () => void): void {
  stopScene();
  root.innerHTML = SCENES[id].html();
  current = root;
  const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T = timeline(root, instant);
  SCENES[id].run(T);
  T.wait(300);
  T.do(onDone);
}

/** A scene's first frame, for the slides that aren't playing. */
export function sceneMarkup(id: FeatureId): string {
  return SCENES[id].html();
}

/* ------------------------------------------------------------ shared parts */

const cursorSvg =
  '<svg class="sc-cur" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2l11 8.5-5 .8 2.9 5.9-2.2 1-2.8-5.9L4 15.5z" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const kov =
  '<div class="sc-kov" aria-hidden="true"><span class="sc-kk"></span><span class="sc-kl"></span></div>';
const PILLS: [string, string, string?][] = [
  ["!", "Answer"],
  ["@", "Check"],
  ["[", "Connect", "[["],
  ["#", "Organize"],
];
const penBoxHTML = () =>
  `<div class="sc-pen h" data-r="box"><div class="pills">${PILLS.map(
    ([k, name, shown]) => `<span class="pill" data-p="${k}"><i>${shown ?? k}</i>${name}</span>`,
  ).join("")}</div><div class="pen-in">Ask, or pick what Pensée does<em>esc</em></div></div>`;
const docHead = (title: string, by?: string) =>
  `<div class="sc-h1">${title}</div>${by ? `<div class="sc-by">${by}</div>` : ""}`;

/** The ⌘. loop every pen scene shares: open the box, pick the pill, run it, show what it wrote. */
function penLoop(T: Timeline, key: string, name: string, lines: string[], during?: () => void) {
  T.wait(500);
  T.keys(["⌘", "."], "Ask Pensée");
  T.do((r) => {
    r.root.querySelector("[data-r=caret]")?.remove();
    r.q("[data-r=line]").classList.add("sel", "boxed");
    r.q("[data-r=box]").classList.remove("h");
  });
  T.wait(400);
  T.keys([key === "[" ? "[[" : key], name);
  T.do((r) => r.q(`[data-r=box] [data-p="${key}"]`).classList.add("on"));
  T.keys(["↵"], "Run");
  T.do((r) => {
    r.q("[data-r=box]").classList.add("h");
    r.q("[data-r=line]").classList.remove("sel", "boxed");
    r.q("[data-r=work]").classList.remove("h");
  });
  during?.();
  lines.forEach((e, i) => {
    T.wait(i ? 320 : 1000);
    T.do((r) => {
      if (!i) r.q("[data-r=work]").classList.add("gone");
      r.q(`[data-r=${e}]`).classList.remove("h");
    });
  });
}

/* ------------------------------------------------------------ tabs */

const TABS = [
  {
    title: "Why notes beat memory",
    by: "Essays · draft",
    lines: [
      "I keep forgetting what I read.",
      "One idea per note, in my own words.",
      "Links matter more than folders.",
    ],
  },
  {
    title: "One idea per note",
    by: "Notes",
    lines: [
      "A note should stand on its own.",
      "Title it as a claim, not a topic.",
      "Link it to two others before closing it.",
    ],
  },
  {
    title: "Bird by Bird",
    by: "Library · Anne Lamott",
    lines: [
      "Permission to write a bad first draft.",
      "Short assignments: one small piece at a time.",
    ],
  },
  {
    title: "Reading log",
    by: "Notes",
    lines: [
      "Highlighted 40 pages, remembered two ideas.",
      "Started writing a note per idea instead.",
    ],
  },
];
const tabDoc = (i: number) =>
  `<div class="sc-doc">${docHead(TABS[i]!.title, TABS[i]!.by)}${TABS[i]!.lines.map((l) => `<div class="sl">${l}</div>`).join("")}</div>`;

/** Two fingertips at (x, y), `gap` apart: the pinch, drawn. */
function fingers(r: R, x: number, y: number, gap: number, show = true) {
  const f = r.q("[data-r=fg]");
  f.style.transform = `translate(${x}px, ${y}px)`;
  f.classList.toggle("h", !show);
  const [a, b] = f.children as unknown as HTMLElement[];
  a!.style.transform = `translate(${-gap / 2}px, 0)`;
  b!.style.transform = `translate(${gap / 2}px, 0)`;
}
function setTabs(r: R, on: number) {
  r.root.querySelectorAll(".tt").forEach((n, i) => n.classList.toggle("on", i === on));
  r.root.querySelectorAll(".isl").forEach((n, i) => n.classList.toggle("on", i === on));
}

/* ------------------------------------------------------------ board docking */

// Glow + Ping, as board-spark.ts draws it (SPECs/board-docking-glow-spec.md).
type Box = [number, number, number, number];
type Pt = [number, number];
interface Dock {
  card: string;
  from: Box;
  slot: Box;
  reach: Pt;
  route: Pt[];
}
const BOARD_CARDS = [
  { id: "n1", text: "Why notes beat memory", at: [24, 150] as Pt, w: 176 },
  { id: "n2", text: "One idea per note", at: [300, 270] as Pt, w: 150 },
  { id: "n3", text: "Links over folders", at: [70, 284] as Pt, w: 150 },
];
const DOCKS: Dock[] = [
  {
    card: "n2",
    from: [24, 150, 176, 48],
    slot: [244, 150, 150, 48],
    reach: [18, 24],
    route: [
      [200, 174],
      [244, 174],
    ],
  },
  {
    card: "n3",
    from: [244, 150, 150, 48],
    slot: [438, 150, 150, 48],
    reach: [16, 28],
    route: [
      [394, 174],
      [438, 174],
    ],
  },
];
const BEAT_MS = 1600;
const RING_MS = BEAT_MS * 0.6;
const GLOW = 0.6;
const routeD = (pts: Pt[]) => pts.map((q, i) => `${i ? "L" : "M"}${q[0]} ${q[1]}`).join(" ");
const headPts = ([x, y]: Pt) => `${x},${y} ${x - 9},${y - 4.5} ${x - 9},${y + 4.5}`;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** --ease-out, cubic-bezier(0.16, 1, 0.3, 1), as a function of time. */
function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 0.48;
  const bx = 3 * (0.3 - 0.16) - cx;
  const ax = 1 - cx - bx;
  const cy = 3;
  const by = -3;
  const ay = 1 - cy - by;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 20; i += 1) {
    u = (lo + hi) / 2;
    if (((ax * u + bx) * u + cx) * u < t) lo = u;
    else hi = u;
  }
  return ((ay * u + by) * u + cy) * u;
}

function beatAt(ms: number): { breath: number; ring: number | null } {
  if (!Number.isFinite(ms)) return { breath: 1, ring: null };
  const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * ms) / BEAT_MS - Math.PI / 2);
  const since = ms - BEAT_MS / 2;
  if (since < 0) return { breath, ring: null };
  const ring = (since % BEAT_MS) / RING_MS;
  return { breath, ring: ring < 1 ? ring : null };
}

const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent?.append(n);
  return n;
}
const box = (b: Box, cls: string, parent: Element) =>
  sv("rect", { x: b[0], y: b[1], width: b[2], height: b[3], rx: 12, class: cls }, parent);
function litArrow(g: Element, route: Pt[]): SVGElement {
  const d = routeD(route);
  const under = sv("path", { d, class: "gl-under" }, g);
  sv("path", { d, class: "gl-line" }, g);
  sv("polygon", { points: headPts(route[route.length - 1]!), class: "gl-head" }, g);
  return under;
}

/** A frame loop that dies with the scene. */
function frames(fn: (ms: number) => void, total?: number, done?: () => void): { stop: () => void } {
  const gen = generation;
  const start = performance.now();
  let stopped = false;
  const tick = (now: number) => {
    if (stopped || gen !== generation) return;
    const ms = now - start;
    fn(ms);
    if (total === undefined || ms < total) requestAnimationFrame(tick);
    else done?.();
  };
  fn(0);
  requestAnimationFrame(tick);
  return {
    stop: () => {
      stopped = true;
    },
  };
}

function moveCard(r: R, id: string, dx: number, dy: number, ms: number, ease: string) {
  const n = r.q(`[data-r=${id}]`);
  n.style.transition = `transform ${ms}ms ${ease}, box-shadow 200ms ease-out`;
  n.style.transform = `translate(${dx}px, ${dy}px)`;
}

/** While a dock is offered: imprint, lit preview arrow, halos breathing on the beat, a ring from the port. */
function drawCharge(r: R, d: Dock): { stop: () => void } {
  const layer = r.q("[data-r=glow]");
  layer.replaceChildren();
  const halos = [
    { n: box(d.from, "gl-halo", layer), peak: 0.4 },
    { n: box(d.slot, "gl-halo", layer), peak: 0.22 },
  ];
  box(d.slot, "gl-imp", layer);
  const under = litArrow(sv("g", { class: "gl-prev" }, layer), d.route);
  const [px, py] = d.route[0]!;
  const ring = sv("circle", { cx: px, cy: py, r: 3, class: "gl-ring" }, layer);
  sv("circle", { cx: px, cy: py, r: 3, class: "gl-dot" }, layer);
  const beat = (ms: number) => {
    const { breath, ring: k } = beatAt(ms);
    const a = GLOW * (0.65 + 0.35 * breath);
    for (const h of halos) h.n.setAttribute("stroke-opacity", (h.peak * a).toFixed(3));
    under.setAttribute("stroke-opacity", (0.35 * a).toFixed(3));
    ring.setAttribute("r", lerp(3, 14, easeOut(k ?? 0)).toFixed(2));
    ring.setAttribute("stroke-opacity", k === null ? "0" : (0.6 * (1 - k)).toFixed(3));
  };
  if (r.instant) {
    beat(Infinity);
    return { stop: () => {} };
  }
  return frames(beat);
}

/** On drop: the imprint and lit line fade, a dot runs the arrow, the docked card flares, one ring at its port. */
function playFlow(r: R, d: Dock) {
  const layer = r.q("[data-r=glow]");
  layer.replaceChildren();
  if (r.instant) return;
  const imp = box(d.slot, "gl-imp", layer);
  const fromHalo = box(d.from, "gl-halo", layer);
  const cardHalo = box(d.slot, "gl-halo", layer);
  const line = sv("g", { class: "gl-prev" }, layer);
  litArrow(line, d.route).setAttribute("stroke-opacity", String(0.35 * GLOW));
  const a = d.route[0]!;
  const z = d.route[d.route.length - 1]!;
  const ring = sv(
    "circle",
    { cx: z[0], cy: z[1], r: 3, class: "gl-ring", "stroke-opacity": 0 },
    layer,
  );
  const dot = sv("circle", { cx: a[0], cy: a[1], r: 3, class: "gl-dot" }, layer);
  const RUN = 220;
  const FLARE = 120;
  const SETTLE = 480;
  const LAND = 380;
  frames(
    (ms) => {
      imp.style.opacity = String(1 - easeOut(clamp01(ms / 180)));
      fromHalo.setAttribute(
        "stroke-opacity",
        String(0.4 * GLOW * (1 - easeOut(clamp01(ms / 220)))),
      );
      line.style.opacity = String(0.55 * (1 - easeOut(clamp01(ms / 460))));
      const up = easeOut(clamp01((ms - RUN + 40) / FLARE));
      const down = easeOut(clamp01((ms - RUN - 80) / SETTLE));
      cardHalo.setAttribute("stroke-opacity", String(0.5 * GLOW * up * (1 - down)));
      const run = easeOut(clamp01(ms / RUN));
      if (run < 1) {
        dot.setAttribute("cx", String(lerp(a[0], z[0], run)));
        dot.setAttribute("cy", String(lerp(a[1], z[1], run)));
      } else {
        const ph = clamp01((ms - RUN) / LAND);
        dot.setAttribute("cx", String(z[0]));
        dot.setAttribute("cy", String(z[1]));
        dot.style.opacity = String(1 - easeOut(ph));
        ring.setAttribute("r", lerp(3, 16, easeOut(ph)).toFixed(2));
        ring.setAttribute("stroke-opacity", (0.7 * (1 - ph)).toFixed(3));
      }
    },
    RUN + 80 + SETTLE,
    () => layer.replaceChildren(),
  );
}

/* ------------------------------------------------------------ podcast card */

/** The podcast player as podcast-player.css draws it, drawn only. */
const podHTML = () => `<div class="sc-pod"><div class="art"><img src="${dwarkesh}" alt=""></div>
  <div class="main"><div class="now"><div class="hd"><div class="ti">Andy Matuschak — The reason most learning tools fail</div><div class="sh">Dwarkesh Podcast</div></div>
    <div class="tr"><span class="ib">${ic.back}</span><span class="play">${ic.pause}</span><span class="ib">${ic.fwd}</span></div></div>
    <div class="tl"><span data-r="time">${fmt(721)}</span><span class="bar"><i data-r="bar" style="width:${((721 / 8560) * 100).toFixed(2)}%"></i></span><span>${fmt(8560)}</span></div>
    <div class="tools"><span class="tb">1× <kbd>&lt; &gt;</kbd></span><span class="tb">${ic.vol}<i class="vr"></i></span><span class="tb pin" data-r="pinb">${ic.pin}Pin<kbd>${keyLabel("⌘S")}</kbd></span></div>
  </div></div>`;

function flashPin(r: R) {
  const n = r.root.querySelector("[data-r=pinb]");
  if (!n || r.instant) return;
  timers.push(window.setTimeout(() => n.classList.add("press"), 160));
  timers.push(window.setTimeout(() => n.classList.remove("press"), 520));
}

/* ------------------------------------------------------------ the scenes */

const SCENES: Record<FeatureId, { html: () => string; run: (T: Timeline) => void }> = {
  tabs: {
    html: () => `<div class="sc-tabs">
        <div class="tbar">${TABS.map((t, i) => `<span class="tt${i ? "" : " on"}">${t.title}</span>`).join("")}</div>
        <div class="tone" data-r="one">${tabDoc(0)}</div>
        <div class="tstrip h" data-r="strip"><div class="ttrack" data-r="track">${TABS.map(
          (t, i) =>
            `<div class="isl${i ? "" : " on"}"><div class="ih"><span>${t.title}</span><i>×</i></div><div class="ib"><div class="it">${t.title}</div>${t.lines.map((l) => `<div class="sl">${l}</div>`).join("")}</div></div>`,
        ).join("")}</div></div>
        <div class="fingers h" data-r="fg"><i></i><i></i></div>
      </div>${kov}`,
    run(T) {
      // The switch is instant in the app: the fingers are the motion.
      T.wait(500);
      T.do((r) => fingers(r, 300, 200, 150));
      T.wait(250);
      T.do((r) => fingers(r, 300, 200, 36));
      T.keys(["Pinch in"], "All tabs, side by side");
      T.do((r) => {
        r.q("[data-r=one]").classList.add("h");
        r.q("[data-r=strip]").classList.remove("h");
        fingers(r, 300, 200, 36, false);
      });
      T.wait(700);
      T.do((r) => fingers(r, 380, 210, 44));
      T.wait(250);
      T.do((r) => {
        fingers(r, 200, 210, 44);
        r.q("[data-r=track]").style.transform = "translateX(-200px)";
      });
      T.keys(["Swipe"], "Scroll the columns");
      T.do((r) => fingers(r, 200, 210, 44, false));
      T.wait(600);
      T.do((r) => {
        fingers(r, 158, 200, 36);
        setTabs(r, 1);
      });
      T.wait(250);
      T.do((r) => fingers(r, 158, 200, 150));
      T.keys(["Pinch out"], "Just this tab");
      T.do((r) => {
        r.q("[data-r=one]").innerHTML = tabDoc(1);
        r.q("[data-r=strip]").classList.add("h");
        r.q("[data-r=one]").classList.remove("h");
        fingers(r, 158, 200, 150, false);
      });
    },
  },
  board: {
    html: () => `<div class="sc-doc" data-r="note">${docHead("Essay map", "Essays")}<div class="sl"><span data-r="cmd"></span><span class="caret"></span></div></div>
      <div class="sc-board h" data-r="board">
        <svg class="slinks" viewBox="0 0 600 360" aria-hidden="true">
          <defs><filter id="sc-gl-b4" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="4"/></filter><filter id="sc-gl-b3" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="3"/></filter></defs>
          ${DOCKS.map((d, k) => `<path data-r="f${k}" class="lkf" d="${routeD(d.route)}"/><polygon data-r="h${k}" class="lkh" points="${headPts(d.route[d.route.length - 1]!)}"/>`).join("")}
        </svg>
        <svg class="sglow" viewBox="0 0 600 360" aria-hidden="true"><g data-r="glow"></g></svg>
        ${BOARD_CARDS.map((c) => `<div class="bn" data-r="${c.id}" style="left:${c.at[0]}px;top:${c.at[1]}px;width:${c.w}px">${c.text}</div>`).join("")}
        <div class="hint h" data-r="hint" style="left:212px;top:104px">Drag a card near another to dock it</div>
      </div>${cursorSvg}${kov}`,
    run(T) {
      T.wait(400);
      T.type("[data-r=cmd]", "/board", 70);
      T.keys(["↵"], "Insert a board");
      T.do((r) => {
        r.q("[data-r=note]").classList.add("h");
        r.q("[data-r=board]").classList.remove("h");
      });
      T.wait(500);
      DOCKS.forEach((d, k) => {
        const c = BOARD_CARDS.find((x) => x.id === d.card)!;
        const grab: Pt = [c.at[0] + c.w / 2, c.at[1] + 24];
        const drop: Pt = [d.slot[0] + d.reach[0], d.slot[1] + d.reach[1]];
        T.cursor(grab[0], grab[1], 700);
        T.do((r) => {
          r.q(`[data-r=${d.card}]`).classList.add("lift");
          if (!k) r.q("[data-r=hint]").classList.remove("h");
        });
        T.wait(250);
        // The drag: the card rides the cursor; in reach, the dock is offered and breathes for a beat.
        T.do((r) => {
          moveCard(
            r,
            d.card,
            drop[0] - c.at[0],
            drop[1] - c.at[1],
            800,
            "cubic-bezier(.45,.05,.25,1)",
          );
          moveCursor(r, grab[0] + drop[0] - c.at[0], grab[1] + drop[1] - c.at[1], 800);
        });
        T.wait(480);
        T.do((r) => {
          r.root.charge = drawCharge(r, d);
        });
        T.wait(320 + 1500);
        // Let go: it glides into its imprint, the arrow firms up, a dot runs it and the docked card flares.
        T.do((r) => {
          r.root.charge?.stop();
          r.q(`[data-r=${d.card}]`).classList.remove("lift");
          moveCard(
            r,
            d.card,
            d.slot[0] - c.at[0],
            d.slot[1] - c.at[1],
            180,
            "cubic-bezier(.16,1,.3,1)",
          );
          for (const x of ["f", "h"]) {
            const n = r.q(`[data-r=${x}${k}]`);
            n.classList.add("pre");
            void n.getBoundingClientRect();
            n.classList.add("on");
          }
          playFlow(r, d);
          if (!k) r.q("[data-r=hint]").classList.add("h");
        });
        T.wait(900);
      });
      T.cursor(560, 330, 600);
    },
  },
  connect: {
    html: () => `<div class="sc-doc">${docHead("Why notes beat memory", "Essays · draft")}
      <div class="sl">Most of what I read is gone in a week.</div>
      <div class="sl rel" data-r="line">${penBoxHTML()}One idea per note, in my own words.<span class="caret" data-r="caret"></span></div>
      <div class="sl ai sub h" data-r="work"><span class="working">Reading your notes… <kbd>esc stop</kbd></span></div>
      <div class="sl ai sub h" data-r="e1"><b>Supports:</b> Rewriting highlights in your own words is what made them stick. — <span class="link" data-r="lk">Bird by Bird</span></div>
      <div class="sl ai sub h" data-r="e2"><b>Example:</b> The habits issue came from linking two old notes. — <span class="link">Newsletter plan</span></div>
      <div class="sl ai sub h" data-r="e3"><b>Another angle:</b> Highlighting alone felt productive and left nothing. — <span class="link">Reading log</span></div>
      </div>
      <div class="pcard h" data-r="card"><div class="pt">Bird by Bird</div><div class="pm">Library · your note from March</div>
        <div class="pl">Permission to write a bad first draft.</div><div class="pl"><mark>Rewrote each highlight in my own words; those are the ones that stuck.</mark></div><div class="pl">Short assignments: one small piece at a time.</div></div>
      ${cursorSvg}${kov}`,
    run(T) {
      penLoop(T, "[", "Connect", ["e1", "e2", "e3"]);
      T.wait(300);
      T.cursorTo("[data-r=lk]", 700, 4, 3);
      T.do((r) => placeCard(r.root, "[data-r=card]", "[data-r=lk]"));
    },
  },
  check: {
    html: () => `<div class="sc-doc">${docHead("Handwriting", "Drafts · for the essay")}
      <div class="sl rel" data-r="line">${penBoxHTML()}Taking notes by hand helps you remember more than typing.<span class="caret" data-r="caret"></span></div>
      <div class="sl ai sub h" data-r="work"><span class="working" data-r="wt">Finding papers… <kbd>esc stop</kbd></span></div>
      <div class="sl ai sub h" data-r="e1"><b>For:</b> Students who typed copied lectures word for word and did worse on conceptual questions. <span class="paper" data-r="pp">${ic.paper}Mueller &amp; Oppenheimer 2014</span></div>
      <div class="sl ai sub h" data-r="e2"><b>Against:</b> A direct replication found little difference in test scores. <span class="paper">${ic.paper}Morehead et al. 2019</span></div>
      <div class="sl sub h ph" data-r="e3">Your call: what does this change? Rewrite your line or keep it.</div>
      </div>
      <div class="pcard wide h" data-r="card"><div class="pt">The Pen Is Mightier Than the Keyboard</div><div class="pm">Pam A. Mueller, Daniel M. Oppenheimer</div><div class="pm">Psychological Science · 2014 · cited by 1,044</div><span class="pbtn">Open paper</span></div>
      ${cursorSvg}${kov}`,
    run(T) {
      penLoop(T, "@", "Check", [], () => {
        T.wait(900);
        T.do((r) => {
          r.q("[data-r=wt]").innerHTML = "Reading the papers… <kbd>esc stop</kbd>";
        });
      });
      ["e1", "e2", "e3"].forEach((e, i) => {
        T.wait(i ? 320 : 700);
        T.do((r) => {
          if (!i) r.q("[data-r=work]").classList.add("gone");
          r.q(`[data-r=${e}]`).classList.remove("h");
        });
      });
      T.wait(400);
      T.cursorTo("[data-r=pp]", 700, 4, 3);
      T.do((r) => placeCard(r.root, "[data-r=card]", "[data-r=pp]"));
    },
  },
  dump: {
    html: () => {
      const messy = [
        "ugh newsletter late again",
        "i only write when i feel like it",
        "drafts in notes app + docs + here",
        "march was good bc fixed slot",
        "maybe write sun send tue??",
      ];
      return `<div class="sc-doc">${docHead("Newsletter", "Inbox · brain dump")}
        <div class="dump" data-r="dump">${messy.map((m, i) => `<div class="sl" data-r="m${i}" data-text="${m}"><span></span>${i === 0 ? '<span class="caret" data-r="caret"></span>' : ""}</div>`).join("")}</div>
        <div class="rel" data-r="anchor">${penBoxHTML()}</div>
        <div class="sl ai h" data-r="work"><span class="working">Organizing your lines… <kbd>esc stop</kbd></span></div>
        <div class="outline h" data-r="out">
          <div class="sl ai tint"><b>Summary:</b> A fixed slot, not inspiration, keeps the newsletter going.</div>
          <div class="sl tint"><b>Problem:</b> I only write when I feel like it, so it’s late again.</div>
          <div class="sl sub tint"><b>Cause:</b> Drafts sit in the notes app, Docs and here.</div>
          <div class="sl tint"><b>Solution:</b> Write on Sunday, send on Tuesday.</div>
          <div class="sl sub tint"><b>What worked:</b> March was good because of a fixed slot.</div>
          <div class="sstat">Organized in 3 levels, in your words. <kbd>↵ keep · esc undo</kbd></div>
        </div></div>${cursorSvg}${kov}`;
    },
    run(T) {
      T.wait(300);
      for (let i = 0; i < 5; i += 1) {
        const sel = `[data-r=m${i}]`;
        T.do((r) => {
          const c = r.root.querySelector("[data-r=caret]");
          if (c) r.q(sel).appendChild(c);
        });
        T.typeData(sel, 24);
        T.wait(120);
      }
      T.keys(["⌘", "A"], "Select the lines");
      T.do((r) => r.q("[data-r=dump]").classList.add("selected"));
      T.do((r) => r.root.querySelector("[data-r=caret]")?.remove());
      T.keys(["⌘", "."], "Ask Pensée");
      T.do((r) => r.q("[data-r=box]").classList.remove("h"));
      T.wait(300);
      T.keys(["#"], "Organize");
      T.do((r) => r.q('[data-r=box] [data-p="#"]').classList.add("on"));
      T.keys(["↵"], "Run");
      T.do((r) => {
        r.q("[data-r=box]").classList.add("h");
        r.q("[data-r=work]").classList.remove("h");
      });
      T.wait(1300);
      T.do((r) => {
        r.q("[data-r=work]").classList.add("gone");
        r.q("[data-r=dump]").classList.add("gone");
        r.q("[data-r=out]").classList.remove("h");
      });
      T.wait(1300);
      T.keys(["↵"], "Keep it");
      T.do((r) => r.q("[data-r=out]").classList.add("kept"));
    },
  },
  library: {
    // The book that opens is public domain: Strunk's The Elements of Style (1920; text from Project
    // Gutenberg, cover scan from Wikimedia Commons), so its real page can be shown. The other covers
    // only appear in the grid.
    html: () => {
      const books: [string, string, string][] = [
        [creativeAct, "The Creative Act", "Rick Rubin"],
        [smartNotes, "How to Take Smart Notes", "Sönke Ahrens"],
        [bird, "Bird by Bird", "Anne Lamott"],
        [strunk, "The Elements of Style", "William Strunk Jr."],
        [secondBrain, "Building a Second Brain", "Tiago Forte"],
        [atomic, "Atomic Habits", "James Clear"],
      ];
      return `<div class="sc-doc" data-r="note">${docHead("Why notes beat memory", "Essays · draft")}<div class="sl">One idea per note, in my own words.<span class="caret"></span></div></div>
        <div class="sc-lib h" data-r="lib"><div class="lhead"><span class="lt">Library</span><span class="lc">6</span><span class="ltabs"><span class="on">Books 6</span><span>Videos</span><span>Podcasts</span><span>Papers</span></span></div>
          <div class="lgrid">${books.map(([src, t, a], i) => `<div class="lb" data-r="b${i}" style="--d:${i * 50}ms"><img src="${src}" alt="" draggable="false"><span class="lbt">${t}</span><span class="lba">${a}</span></div>`).join("")}</div></div>
        <div class="sc-read h" data-r="open">
          <div class="rpage"><div class="rhd"><span>The Elements of Style · William Strunk Jr.</span><span>III</span></div>
            <div class="rrule">13. Omit needless words.</div>
            <p><span class="rsel" data-r="sel">Vigorous writing is concise.</span> A sentence should contain no unnecessary words, a paragraph no unnecessary sentences, for the same reason that a drawing should have no unnecessary lines and a machine no unnecessary parts. This requires not that the writer make all his sentences short, or that he avoid all detail and treat his subjects only in outline, but that he make every word tell.</p>
            <div class="rft"><span>Section III</span><span>24 / 96</span></div>
            <div class="spill h" data-r="pill"><span class="pb" data-r="phl">Highlight</span><span class="pb">Define</span></div></div>
          <div class="rnote"><div class="sc-h1 sm">The Elements of Style</div><div class="sc-by">William Strunk Jr. · Book · 1920</div>
            <div class="rh2">Highlights</div>
            <div class="sl q h" data-r="hl">Vigorous writing is concise.<span class="pin" data-r="bpin">${ic.pin}<span class="tip h" data-r="btip">III · p. 24</span></span></div>
            <div class="sl sub h" data-r="mine"><span data-r="mt"></span><span class="caret" data-r="mc"></span></div>
            <div class="sl ph" data-r="empty">Highlights land here as bullets.</div></div>
        </div>
        ${cursorSvg}${kov}`;
    },
    run(T) {
      T.wait(500);
      T.keys(["⌘G", "L"], "Go to Library");
      T.do((r) => {
        r.q("[data-r=note]").classList.add("h");
        r.q("[data-r=lib]").classList.remove("h");
      });
      T.wait(800);
      T.cursorTo("[data-r=b3] img", 700, 4, 10);
      T.do((r) => r.q("[data-r=b3]").classList.add("hover"));
      T.wait(450);
      T.do((r) => {
        r.q("[data-r=lib]").classList.add("h");
        r.q("[data-r=open]").classList.remove("h");
      });
      T.wait(600);
      // Drag across the sentence: the selection grows with the pointer, then becomes a highlight.
      T.cursorTo("[data-r=sel]", 500, -78, 2);
      T.do((r) => r.q("[data-r=sel]").classList.add("selecting"));
      T.cursorTo("[data-r=sel]", 650, 80, 2);
      T.wait(200);
      T.do((r) => placeAbove(r.root, "[data-r=pill]", "[data-r=sel]"));
      T.wait(500);
      T.cursorTo("[data-r=phl]", 450, 0, 2);
      T.do((r) => r.q("[data-r=phl]").classList.add("down"));
      T.wait(160);
      T.do((r) => {
        const e = r.q("[data-r=sel]");
        e.classList.remove("selecting");
        e.classList.add("marked");
        r.q("[data-r=pill]").classList.add("h");
      });
      T.wait(300);
      T.do((r) => {
        r.q("[data-r=empty]").classList.add("gone");
        r.q("[data-r=hl]").classList.remove("h");
      });
      T.wait(700);
      T.cursorTo("[data-r=bpin]", 650, 2, 3);
      T.do((r) => r.q("[data-r=btip]").classList.remove("h"));
      T.wait(300);
      T.do((r) => {
        const e = r.q("[data-r=sel]");
        e.classList.remove("flash");
        void e.offsetWidth;
        e.classList.add("flash");
      });
      T.wait(900);
      T.do((r) => {
        r.q("[data-r=btip]").classList.add("h");
        r.q("[data-r=mine]").classList.remove("h");
      });
      T.type("[data-r=mt]", "Cut the warm-up sentence in every draft.", 32);
      T.do((r) => r.q("[data-r=mc]").remove());
      T.cursor(560, 330, 500);
    },
  },
  podcast: {
    html: () => `<div class="sc-doc">${docHead("The reason most learning tools fail", "Dwarkesh Podcast · Andy Matuschak")}
      ${podHTML()}
      <div class="sl" data-r="l1"><span data-r="t1"></span><span class="caret" data-r="c1"></span><span class="pin h" data-r="p1">${ic.pin}<span class="tip h" data-r="tip1">12:04</span></span></div>
      <div class="sl h" data-r="l2"><span data-r="t2"></span><span class="caret" data-r="c2"></span><span class="pin h" data-r="p2">${ic.pin}<span class="tip h" data-r="tip2">12:17</span></span></div>
      </div>${cursorSvg}${kov}`,
    run(T) {
      let s = 721;
      T.do((r) => {
        r.root.tick = window.setInterval(() => {
          s += 1;
          const n = r.root.querySelector("[data-r=time]");
          if (n) n.textContent = fmt(s);
          const b = r.root.querySelector<HTMLElement>("[data-r=bar]");
          if (b) b.style.width = `${((s / 8560) * 100).toFixed(2)}%`;
        }, 1000);
      });
      T.wait(400);
      T.type("[data-r=t1]", "Most learning tools skip the practice.", 34);
      T.do(flashPin);
      T.keys(["⌘", "S"], "Pin to 12:04");
      T.do((r) => {
        r.q("[data-r=p1]").classList.remove("h");
        r.q("[data-r=tip1]").classList.remove("h");
      });
      T.wait(500);
      T.do((r) => {
        r.q("[data-r=tip1]").classList.add("h");
        r.q("[data-r=c1]").remove();
        r.q("[data-r=l2]").classList.remove("h");
      });
      T.type("[data-r=t2]", "Spacing is what makes it stick.", 34);
      T.do(flashPin);
      T.keys(["⌘", "S"], "Pin to 12:17");
      T.do((r) => {
        r.q("[data-r=p2]").classList.remove("h");
        r.q("[data-r=c2]").remove();
      });
      T.wait(300);
      T.cursorTo("[data-r=p1]", 800, 3, 3);
      T.do((r) => r.q("[data-r=tip1]").classList.remove("h"));
      T.wait(300);
      T.do((r) => {
        s = 724;
        r.q("[data-r=time]").textContent = fmt(s);
      });
    },
  },
};
