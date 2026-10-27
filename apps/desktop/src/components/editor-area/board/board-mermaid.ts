/**
 * Mermaid → editable board ("Upgrade flowcharts to boards" in Lark).
 *
 * Covers the flowchart subset people actually write: `flowchart`/`graph` with
 * a direction, node shapes (`[]` `()` `([])` `(())` `{}` `{{}}` `[[]]` `>]`
 * `[/ /]`), links (`-->` `---` `-.->` `==>`, `-->|label|`, `-- label -->`),
 * chains (`A --> B --> C`) and `&` groups. Styling, classes, clicks and
 * subgraph boxes are skipped — their nodes and links still come through.
 *
 * Pure: the caller passes a text measurer so tests need no DOM.
 */

import { addMindChild, layoutMind, newMindRoot } from "./board-mind";
import { chartToElements, quadrantToElements, timelineToElements } from "./board-pictures";
import {
  type BoardEl,
  type BoxSide,
  type LinkerEl,
  type MindEl,
  type ShapeEl,
  type ShapeKind,
  defaultStyle,
  emptyScene,
  newId,
  newShapeStyle,
} from "./board-model";

export type Direction = "TD" | "LR" | "BT" | "RL";

export interface FlowNode {
  id: string;
  text: string;
  shape: ShapeKind;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  arrow: boolean;
}

export interface FlowGraph {
  dir: Direction;
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
}

/* --------------------------------------------------------------- parse */

const HEADER = /^\s*(?:flowchart|graph)\b\s*(TD|TB|LR|RL|BT)?/i;
const SKIP =
  /^\s*(%%|subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/i;

/** Opening bracket → [closing bracket, shape]. Longest openers first. */
const BRACKETS: [string, string, ShapeKind][] = [
  ["(((", ")))", "ellipse"],
  ["((", "))", "ellipse"],
  ["([", "])", "roundRect"],
  ["[[", "]]", "rect"],
  ["[(", ")]", "roundRect"],
  ["[/", "/]", "rect"],
  ["[\\", "\\]", "rect"],
  ["{{", "}}", "hexagon"],
  ["(", ")", "roundRect"],
  ["[", "]", "rect"],
  ["{", "}", "diamond"],
  [">", "]", "rect"],
];

const LINKS: { re: RegExp; label: number | null; dashed: boolean; arrowGroup?: number }[] = [
  { re: /^\s*--\s+([^-][^>]*?)\s*-->/, label: 1, dashed: false },
  { re: /^\s*-\.\s*([^.]+?)\s*\.->/, label: 1, dashed: true },
  { re: /^\s*==\s+(.+?)\s*==>/, label: 1, dashed: false },
  { re: /^\s*<?(-\.+-)(>?)(?:\s*\|([^|]*)\|)?/, label: 3, dashed: true, arrowGroup: 2 },
  { re: /^\s*<?(={2,})(>?)(?:\s*\|([^|]*)\|)?/, label: 3, dashed: false, arrowGroup: 2 },
  { re: /^\s*<?(-{2,})(>|x|o)?(?:\s*\|([^|]*)\|)?/, label: 3, dashed: false, arrowGroup: 2 },
];

function cleanText(raw: string): string {
  const t = raw.trim().replace(/^"(.*)"$/s, "$1");
  return t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

interface Cursor {
  s: string;
  i: number;
}

function readNode(c: Cursor, nodes: Map<string, FlowNode>): string | null {
  const m = /^\s*([A-Za-z0-9_][A-Za-z0-9_.]*)/.exec(c.s.slice(c.i));
  if (!m) return null;
  const id = m[1];
  c.i += m[0].length;
  const rest = c.s.slice(c.i);
  for (const [open, close, shape] of BRACKETS) {
    if (!rest.startsWith(open)) continue;
    const end = rest.indexOf(close, open.length);
    if (end < 0) continue;
    nodes.set(id, { id, text: cleanText(rest.slice(open.length, end)), shape });
    c.i += end + close.length;
    break;
  }
  if (!nodes.has(id)) nodes.set(id, { id, text: id, shape: "rect" });
  const cls = /^:::[A-Za-z0-9_-]+/.exec(c.s.slice(c.i));
  if (cls) c.i += cls[0].length;
  return id;
}

function readGroup(c: Cursor, nodes: Map<string, FlowNode>): string[] {
  const ids: string[] = [];
  for (;;) {
    const id = readNode(c, nodes);
    if (!id) break;
    ids.push(id);
    const amp = /^\s*&/.exec(c.s.slice(c.i));
    if (!amp) break;
    c.i += amp[0].length;
  }
  return ids;
}

function readLink(c: Cursor): Omit<FlowEdge, "from" | "to"> | null {
  const rest = c.s.slice(c.i);
  for (const link of LINKS) {
    const m = link.re.exec(rest);
    if (!m) continue;
    c.i += m[0].length;
    const label = link.label !== null ? m[link.label]?.trim() : undefined;
    const arrow = link.arrowGroup === undefined ? true : Boolean(m[link.arrowGroup]);
    return { label: label || undefined, dashed: link.dashed, arrow };
  }
  return null;
}

/** Statements: one per line, or split by `;`, but not a `;` inside a node's
 *  brackets, quotes or a link's `|label|` ("Keywords: news; articles"). */
function statements(source: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote = false;
  let pipe = false;
  for (const ch of source.replace(/\r/g, "")) {
    if (ch === "\n" || (ch === ";" && !depth && !quote && !pipe)) {
      out.push(cur);
      cur = "";
      depth = 0;
      quote = pipe = false;
      continue;
    }
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "|") pipe = !pipe;
    else if (!quote && "[({".includes(ch)) depth++;
    else if (!quote && "])}".includes(ch)) depth = Math.max(0, depth - 1);
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** `null` when the text is not a Mermaid flowchart. */
export function parseMermaidFlowchart(source: string): FlowGraph | null {
  const lines = statements(source);
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  const header = first >= 0 ? HEADER.exec(lines[first]) : null;
  if (!header) return null;
  const raw = (header[1] ?? "TD").toUpperCase();
  const dir: Direction = raw === "TB" ? "TD" : (raw as Direction);
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const line of lines.slice(first + 1)) {
    if (!line.trim() || SKIP.test(line)) continue;
    const c: Cursor = { s: line, i: 0 };
    let left = readGroup(c, nodes);
    while (left.length) {
      const link = readLink(c);
      if (!link) break;
      const right = readGroup(c, nodes);
      if (!right.length) break;
      for (const from of left) for (const to of right) edges.push({ from, to, ...link });
      left = right;
    }
  }
  return nodes.size ? { dir, nodes, edges } : null;
}

/* -------------------------------------------------------------- layout */

export type Measure = (text: string, size: number) => number;
const approxMeasure: Measure = (text, size) => text.length * size * 0.56;

const FONT = 14;
/** The side a forward arrow leaves by, and the side it enters by. */
const FLOW_SIDES: Record<Direction, [BoxSide, BoxSide]> = {
  LR: ["e", "w"],
  RL: ["w", "e"],
  TD: ["s", "n"],
  BT: ["n", "s"],
};
const RANK_GAP = 70;
const NODE_GAP = 44;

function sizeOf(node: FlowNode, measure: Measure): { w: number; h: number } {
  const lines = node.text.split("\n");
  const textW = Math.max(...lines.map((l) => measure(l, FONT)));
  const textH = lines.length * FONT * 1.35;
  let w = Math.min(Math.max(textW + 40, 120), 280);
  let h = Math.max(textH + 28, 56);
  if (node.shape === "diamond") {
    w = Math.max(w * 1.35, 140);
    h = Math.max(h * 1.45, 90);
  } else if (node.shape === "ellipse") {
    w = Math.max(w * 1.15, 120);
    h = Math.max(h, 64);
  } else if (node.shape === "hexagon") {
    w += 24;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Longest-path ranks; back edges (cycles) are ignored for ranking. */
function rank(graph: FlowGraph): Map<string, number> {
  const order = [...graph.nodes.keys()];
  const out = new Map<string, string[]>(order.map((id) => [id, []]));
  for (const e of graph.edges) out.get(e.from)?.push(e.to);
  const state = new Map<string, 0 | 1 | 2>();
  const forward: [string, string][] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      const st = state.get(to) ?? 0;
      if (st === 1) continue; // back edge
      forward.push([id, to]);
      if (st === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of order) if (!state.get(id)) visit(id);
  const ranks = new Map<string, number>(order.map((id) => [id, 0]));
  // Relax until stable — forward edges form a DAG, so this terminates.
  for (let pass = 0; pass < order.length; pass += 1) {
    let changed = false;
    for (const [a, b] of forward) {
      const next = (ranks.get(a) ?? 0) + 1;
      if (next > (ranks.get(b) ?? 0)) {
        ranks.set(b, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ranks;
}

/**
 * Layered layout: ranks along the flow direction, nodes within a rank ordered
 * by the average position of their parents (one barycentre sweep), each rank
 * centred on the axis. Elements come back with the top-left at (0, 0).
 * `rankGap` spaces the ranks; across a left-to-right flow a gap opens wider
 * where an arrow's label needs the room.
 */
export function flowchartToElements(
  graph: FlowGraph,
  measure: Measure = approxMeasure,
  rankGap = RANK_GAP,
): BoardEl[] {
  const ranks = rank(graph);
  const layers: string[][] = [];
  for (const id of graph.nodes.keys()) (layers[ranks.get(id) ?? 0] ??= []).push(id);

  const parents = new Map<string, string[]>();
  for (const e of graph.edges) {
    if ((ranks.get(e.to) ?? 0) > (ranks.get(e.from) ?? 0)) {
      parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
    }
  }
  const pos = new Map<string, number>();
  layers.forEach((layer, r) => {
    if (r > 0) {
      const bary = (id: string) => {
        const ps = parents.get(id) ?? [];
        return ps.length ? ps.reduce((sum, p) => sum + (pos.get(p) ?? 0), 0) / ps.length : Infinity;
      };
      layer.sort((a, b) => bary(a) - bary(b));
    }
    layer.forEach((id, i) => pos.set(id, i));
  });

  const horizontal = graph.dir === "LR" || graph.dir === "RL";
  const sizes = new Map([...graph.nodes.values()].map((n) => [n.id, sizeOf(n, measure)]));
  const shapes = new Map<string, ShapeEl>();
  // The widest label on an arrow leaving each rank, for its gap.
  const labelOut = new Map<number, number>();
  if (horizontal)
    for (const e of graph.edges) {
      if (!e.label) continue;
      const r = ranks.get(e.from) ?? 0;
      // Room for the arrow either side of its label, arrowhead included.
      labelOut.set(r, Math.max(labelOut.get(r) ?? 0, measure(e.label, 13) + 64));
    }
  let along = 0;
  for (const [r, layer] of layers.entries()) {
    if (!layer) continue;
    const depth = Math.max(
      ...layer.map((id) => (horizontal ? sizes.get(id)!.w : sizes.get(id)!.h)),
    );
    const span =
      layer.reduce((sum, id) => sum + (horizontal ? sizes.get(id)!.h : sizes.get(id)!.w), 0) +
      NODE_GAP * (layer.length - 1);
    let across = -span / 2;
    for (const id of layer) {
      const { h } = sizes.get(id)!;
      // Across a left-to-right flow a column's boxes share its width, so the
      // arrows leaving them start level and turn at one place.
      const w = horizontal ? depth : sizes.get(id)!.w;
      const node = graph.nodes.get(id)!;
      const x = horizontal ? along + (depth - w) / 2 : across;
      const y = horizontal ? across : along + (depth - h) / 2;
      shapes.set(id, {
        id: newId(),
        t: node.shape,
        x,
        y,
        w,
        h,
        a: 0,
        op: 1,
        st: defaultStyle(),
        ...(node.text ? { lb: { tx: node.text, sz: FONT, al: "c" as const } } : {}),
      });
      across += (horizontal ? h : w) + NODE_GAP;
    }
    along += depth + Math.max(rankGap, labelOut.get(r) ?? 0);
  }

  // Reverse directions mirror the main axis.
  if (graph.dir === "BT" || graph.dir === "RL") {
    for (const el of shapes.values()) {
      if (graph.dir === "BT") el.y = -el.y - el.h;
      else el.x = -el.x - el.w;
    }
  }

  const all = [...shapes.values()];
  const minX = Math.min(...all.map((el) => el.x));
  const minY = Math.min(...all.map((el) => el.y));
  for (const el of all) {
    el.x = Math.round(el.x - minX);
    el.y = Math.round(el.y - minY);
  }

  const links: LinkerEl[] = graph.edges.flatMap((e) => {
    const a = shapes.get(e.from);
    const b = shapes.get(e.to);
    if (!a || !b) return [];
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const forward = (ranks.get(e.to) ?? 0) > (ranks.get(e.from) ?? 0);
    // A step to the next rank leaves by the side facing the flow and enters
    // by the opposite one, so a fan-in turns in the gap between ranks instead
    // of leaving a short box by its top and cutting through its neighbour.
    const [out, into] = FLOW_SIDES[graph.dir];
    const link: LinkerEl = {
      id: newId(),
      t: e.arrow ? "arrow" : "line",
      x: ac.x,
      y: ac.y,
      w: 0,
      h: 0,
      a: 0,
      op: 1,
      // A loop back up the flow curves, so it never runs along the forward
      // trunk and hides that trunk's labels.
      sh: forward ? "elbow" : "curved",
      pts: [
        [0, 0],
        [bc.x - ac.x, bc.y - ac.y],
      ],
      b1: { el: a.id, fx: 0, gap: 4, ...(forward ? { sd: out } : {}) },
      b2: { el: b.id, fx: 0, gap: 4, ...(forward ? { sd: into } : {}) },
      hd: { s: "none", e: e.arrow ? "triangle" : "none" },
      st: defaultStyle(e.dashed ? { d: "dashed" } : {}),
    };
    if (e.label) link.lb = { tx: e.label, sz: 13 };
    return [link];
  });

  // Lines under shapes, so an arrowhead never sits on top of a box.
  return [...links, ...all];
}

/* ------------------------------------------------------------- mindmap */

const MIND_NODE =
  /^(?:[A-Za-z0-9_-]+)?\s*(\(\(|\)\)|\{\{|\(|\)|\[)(.*?)(\)\)|\(\(|\}\}|\)|\(|\])\s*$/;

/** Mermaid `mindmap`: indentation is the tree; node brackets only change the
 *  shape in Mermaid, so here they are stripped to the text. */
export function mindmapToElements(
  source: string,
  measure: Measure = approxMeasure,
): BoardEl[] | null {
  const lines = source.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  if (first < 0 || !/^\s*mindmap\b/i.test(lines[first])) return null;

  const scene = emptyScene();
  const stack: { indent: number; id: string }[] = [];
  let root: MindEl | null = null;
  for (const line of lines.slice(first + 1)) {
    if (!line.trim() || line.trim().startsWith("%%")) continue;
    const indent = line.length - line.trimStart().length;
    let text = line
      .trim()
      .replace(/::icon\([^)]*\)/g, "")
      .replace(/:::[\w-]+/g, "")
      .trim();
    if (!text) continue;
    const m = MIND_NODE.exec(text);
    if (m) text = m[2];
    text = cleanText(text);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!root) {
      root = newMindRoot({ x: 0, y: 0 }, text);
      scene.els.push(root);
      stack.push({ indent, id: root.id });
      continue;
    }
    const parentId = stack.length ? stack[stack.length - 1].id : root.id;
    const parent = scene.els.find((e) => e.id === parentId) as MindEl;
    const topic = addMindChild(scene, parent);
    topic.tx = text;
    stack.push({ indent, id: topic.id });
  }
  if (!root) return null;
  layoutMind(scene, root.id, measure);
  const minX = Math.min(...scene.els.map((e) => e.x));
  const minY = Math.min(...scene.els.map((e) => e.y));
  for (const el of scene.els) {
    el.x -= minX;
    el.y -= minY;
  }
  return scene.els;
}

/* ------------------------------------------------------------ registry */

/** Every Mermaid diagram type that can become a board, tried in order: the
 *  ones with board pieces of their own, then any other as a chart card. */
const IMPORTERS: ((source: string, measure: Measure) => BoardEl[] | null)[] = [
  (src, measure) => {
    const graph = parseMermaidFlowchart(src);
    return graph ? flowchartToElements(graph, measure) : null;
  },
  (src, measure) => mindmapToElements(src, measure),
  (src, measure) => quadrantToElements(src, measure),
  (src, measure) => timelineToElements(src, measure),
  (src) => chartToElements(src),
];

/** Board elements for a Mermaid source, top-left at (0, 0); `null` when the
 *  diagram type has no board equivalent. */
export function mermaidToElements(
  source: string,
  measure: Measure = approxMeasure,
): BoardEl[] | null {
  for (const importer of IMPORTERS) {
    const els = importer(source, measure);
    if (els?.length) return els;
  }
  return null;
}

/** How wide a step's words run before they wrap, so a chain of five still
 *  reads when the board is shown small (the talk box). */
const STEP_TEXT = 104;
/** The space between two steps, wider where an arrow carries a label. */
const STEP_GAP = 40;

/**
 * A picture as Pensée draws it (SPECs/board-pictures-spec.md): steps are the
 * board's own cards (a rounded rectangle, soft blue with a blue outline) read
 * left to right, their words wrapped so the chain stays narrow; every other
 * picture is `mermaidToElements`'s. A pasted flowchart keeps its own shapes;
 * this is for what Pensée draws itself (the talk, the picture tray).
 */
export function pictureToElements(
  source: string,
  measure: Measure = approxMeasure,
): BoardEl[] | null {
  const flow = parseMermaidFlowchart(source);
  if (!flow) return mermaidToElements(source, measure);
  flow.dir = "LR";
  for (const node of flow.nodes.values()) {
    node.shape = "roundRect";
    node.text = wrapWords(node.text.replace(/\s+/g, " ").trim(), FONT, STEP_TEXT, measure);
  }
  const els = flowchartToElements(flow, measure, STEP_GAP);
  for (const el of els) if (el.t === "roundRect") el.st = newShapeStyle();
  return els;
}

/** Greedy word wrap to `max` px, lines joined by newlines. */
function wrapWords(words: string, size: number, max: number, measure: Measure): string {
  const lines: string[] = [];
  let line = "";
  for (const word of words.split(" ").filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
