/**
 * Board templates (Lark's template gallery, the useful core). Each builds its
 * elements with the top-left at (0, 0); the canvas centres them in view.
 * Flowchart and mind map are written as Mermaid and go through the importer,
 * so there is one layout path for them.
 */

import {
  type BoardEl,
  type ColorToken,
  type FrameEl,
  type ShapeEl,
  type ShapeKind,
  type StickyColor,
  type StickyEl,
  type TextEl,
  STICKY_SIZE,
  defaultStyle,
  newId,
} from "./board-model";
import { type Measure, mermaidToElements } from "./board-mermaid";
import { connectorBetween } from "./board-flow";

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (measure?: Measure) => BoardEl[];
}

function frame(name: string, x: number, y: number, w: number, h: number): FrameEl {
  return { id: newId(), t: "frame", x, y, w, h, a: 0, op: 1, name, preset: "custom" };
}

function sticky(tx: string, c: StickyColor, x: number, y: number, fr?: string): StickyEl {
  return { id: newId(), t: "sticky", x, y, w: STICKY_SIZE, h: STICKY_SIZE, a: 0, op: 1, c, tx, fr };
}

function text(tx: string, x: number, y: number, sz: number, w = 600, fr?: string): TextEl {
  return {
    id: newId(),
    t: "text",
    x,
    y,
    w,
    h: sz * 1.4,
    a: 0,
    op: 1,
    tx,
    sz,
    al: "l",
    c: "ink",
    fr,
  };
}

function shape(
  t: ShapeKind,
  tx: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: ColorToken; stroke?: ColorToken; fr?: string } = {},
): ShapeEl {
  return {
    id: newId(),
    t,
    x,
    y,
    w,
    h,
    a: 0,
    op: 1,
    fr: opts.fr,
    st: defaultStyle({ f: opts.fill ?? "none", s: opts.stroke ?? "ink" }),
    ...(tx ? { lb: { tx, sz: 15, al: "c" as const } } : {}),
  };
}

/** Columns of sticky notes in sections (kanban, retro). */
function columns(cols: { name: string; colour: StickyColor; notes: string[] }[]): BoardEl[] {
  const W = 2 * STICKY_SIZE + 3 * 24;
  const H = 3 * STICKY_SIZE + 4 * 24 + 20;
  return cols.flatMap((col, i) => {
    const f = frame(col.name, i * (W + 40), 0, W, H);
    const notes = col.notes.map((tx, j) =>
      sticky(
        tx,
        col.colour,
        f.x + 24 + (j % 2) * (STICKY_SIZE + 24),
        44 + Math.floor(j / 2) * (STICKY_SIZE + 24),
        f.id,
      ),
    );
    return [f, ...notes];
  });
}

export const TEMPLATES: Template[] = [
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Steps, a decision and a loop",
    build: (m) =>
      mermaidToElements(
        `flowchart TD
  A([Start]) --> B[Collect requirements]
  B --> C{Approved?}
  C -->|Yes| D[Build]
  C -->|No| B
  D --> E([Ship])`,
        m,
      ) ?? [],
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "A central idea with branches",
    build: (m) =>
      mermaidToElements(
        `mindmap
  Project
    Goals
      Launch by Q2
      10k users
    Team
      Design
      Engineering
    Risks
      Timeline
      Budget`,
        m,
      ) ?? [],
  },
  {
    id: "kanban",
    name: "Kanban",
    description: "To do, doing, done",
    build: () =>
      columns([
        { name: "To do", colour: "yellow", notes: ["Write brief", "Research", "Sketch ideas"] },
        { name: "Doing", colour: "sky", notes: ["Prototype"] },
        { name: "Done", colour: "mint", notes: ["Kick-off"] },
      ]),
  },
  {
    id: "retro",
    name: "Retrospective",
    description: "What went well, what to improve, actions",
    build: () =>
      columns([
        { name: "Went well", colour: "green", notes: [""] },
        { name: "To improve", colour: "rose", notes: [""] },
        { name: "Actions", colour: "lavender", notes: [""] },
      ]),
  },
  {
    id: "swot",
    name: "SWOT",
    description: "Strengths, weaknesses, opportunities, threats",
    build: () => {
      const S = 560;
      const cells: [string, StickyColor][] = [
        ["Strengths", "mint"],
        ["Weaknesses", "rose"],
        ["Opportunities", "sky"],
        ["Threats", "orange"],
      ];
      return cells.flatMap(([name, colour], i) => {
        const f = frame(name, (i % 2) * (S + 30), Math.floor(i / 2) * (S + 50), S, S);
        return [f, sticky("", colour, f.x + 24, f.y + 24, f.id)];
      });
    },
  },
  {
    id: "swimlane",
    name: "Swimlanes",
    description: "A process across teams",
    build: () => {
      const lanes = ["Customer", "Sales", "Engineering"];
      const laneH = 180;
      const headerW = 140;
      const W = 1100;
      const f = frame("Process", 0, 0, W, lanes.length * laneH);
      const els: BoardEl[] = [f];
      lanes.forEach((name, i) => {
        const y = i * laneH;
        // A lane is a band with its name in a header cell, both inside the section.
        els.push(
          shape("rect", "", 0, y, W, laneH, { stroke: "muted", fr: f.id }),
          shape("rect", name, 0, y, headerW, laneH, { stroke: "muted", fr: f.id }),
        );
      });
      const step = (tx: string, lane: number, col: number, t: ShapeKind = "roundRect") =>
        shape(t, tx, headerW + 60 + col * 220, lane * laneH + (laneH - 70) / 2, 160, 70, {
          fr: f.id,
        });
      const a = step("Request demo", 0, 0);
      const b = step("Qualify lead", 1, 1);
      const c = step("Fit?", 1, 2, "diamond");
      const d = step("Set up trial", 2, 3);
      els.push(a, b, c, d, connectorBetween(a, b), connectorBetween(b, c), connectorBetween(c, d));
      return els;
    },
  },
  {
    id: "slides",
    name: "Slides",
    description: "Three 16:9 sections to present",
    build: () =>
      ["Title", "Agenda", "Next steps"].flatMap((name, i) => {
        const f: FrameEl = { ...frame(name, i * 1700, 0, 1600, 900), preset: "16:9" };
        const heading = text(i === 0 ? "Your title" : name, f.x + 120, 120, 72, 1200, f.id);
        return [f, heading];
      }),
  },
];
