/**
 * The talk the homepage's Talk demo plays (SPECs/website-homepage-spec.md,
 * "Talk section"): one 48-second talk about a job in Lisbon, the way people
 * actually talk. Every piece of every picture carries the id of the line that
 * said it, so a topic drawn another way keeps what has been heard.
 */

export type Hue = "green" | "orange" | "blue" | "purple";
export type PictureKind = "mind" | "matrix" | "steps" | "timeline" | "bar";

export const PICTURE_LABEL: Record<PictureKind, string> = {
  mind: "as a mind map",
  matrix: "as a matrix",
  steps: "as steps",
  timeline: "as a timeline",
  bar: "as a chart",
};

/** A mind-map piece, placed in % of the picture. Leaves hang off the side
 * their branch is on (`side`), so their line ends at their edge. */
export interface MindNode {
  id: string;
  label: string;
  kind: "center" | "branch" | "leaf";
  x: number;
  y: number;
  hue?: Hue;
  side?: "left" | "right";
  from?: string;
}

/** A point in a matrix, 0–1 on each axis (y up). `flip` puts its name on the left. */
export interface MatrixPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  hue: Hue;
  flip?: boolean;
}

/** Times are in months from the start of the timeline. */
export interface TimelineRow {
  name: string;
  hue: Hue;
  from: number;
  to: number;
  events: { id: string; label: string; at: number }[];
}

export interface Topic {
  name: string;
  /** The pictures this topic can be drawn as; the first is how it's drawn. */
  kinds: PictureKind[];
  mind?: MindNode[];
  matrix?: {
    quads: [string, string, string, string];
    x: [string, string];
    y: string;
    points: MatrixPoint[];
  };
  steps?: { id: string; label: string }[];
  timeline?: { periods: string[]; rows: TimelineRow[] };
  bar?: { title: string; bars: { id: string; label: string; value: number }[] };
}

export const TOPICS: Topic[] = [
  {
    name: "Lisbon or Berlin",
    kinds: ["mind", "matrix"],
    mind: [
      { id: "c", label: "Move to Lisbon?", kind: "center", x: 50, y: 50 },
      { id: "b1", label: "Pulls me", kind: "branch", hue: "green", x: 68, y: 44, from: "c" },
      {
        id: "l1",
        label: "Same pay",
        kind: "leaf",
        hue: "green",
        x: 79,
        y: 25,
        side: "right",
        from: "b1",
      },
      {
        id: "l2",
        label: "The sea, the light",
        kind: "leaf",
        hue: "green",
        x: 79,
        y: 44,
        side: "right",
        from: "b1",
      },
      {
        id: "l3",
        label: "I’d write more",
        kind: "leaf",
        hue: "green",
        x: 79,
        y: 63,
        side: "right",
        from: "b1",
      },
      { id: "b2", label: "Holds me back", kind: "branch", hue: "orange", x: 32, y: 34, from: "c" },
      {
        id: "l4",
        label: "Portuguese",
        kind: "leaf",
        hue: "orange",
        x: 21,
        y: 22,
        side: "left",
        from: "b2",
      },
      {
        id: "l5",
        label: "Leaving Mia, the band",
        kind: "leaf",
        hue: "orange",
        x: 21,
        y: 44,
        side: "left",
        from: "b2",
      },
      { id: "b3", label: "Money", kind: "branch", hue: "blue", x: 32, y: 72, from: "c" },
      {
        id: "l6",
        label: "Berlin rent rising",
        kind: "leaf",
        hue: "blue",
        x: 21,
        y: 72,
        side: "left",
        from: "b3",
      },
    ],
    matrix: {
      quads: [
        "Big reasons to stay",
        "Big reasons to go",
        "Small reasons to stay",
        "Small reasons to go",
      ],
      x: ["Stay", "Go"],
      y: "Matters more",
      points: [
        { id: "l1", label: "Same pay", x: 0.6, y: 0.2, hue: "green" },
        { id: "l2", label: "The sea, the light", x: 0.84, y: 0.8, hue: "green", flip: true },
        { id: "l3", label: "I’d write more", x: 0.62, y: 0.62, hue: "green" },
        { id: "l4", label: "Portuguese", x: 0.28, y: 0.32, hue: "orange" },
        { id: "l5", label: "Leaving Mia, the band", x: 0.1, y: 0.7, hue: "orange" },
        { id: "l6", label: "Berlin rent rising", x: 0.8, y: 0.42, hue: "blue", flip: true },
      ],
    },
  },
  {
    name: "The move",
    kinds: ["steps", "timeline"],
    steps: [
      { id: "s1", label: "Give notice on the flat" },
      { id: "s2", label: "Ship the books" },
      { id: "s3", label: "Find a flat in Graça" },
      { id: "s4", label: "Start in March" },
    ],
    timeline: {
      periods: ["January", "February", "March"],
      rows: [
        {
          name: "Flat",
          hue: "blue",
          from: 0.05,
          to: 1.9,
          events: [
            { id: "s1", label: "Give notice", at: 0.2 },
            { id: "s3", label: "Find a flat in Graça", at: 1.6 },
          ],
        },
        {
          name: "Books",
          hue: "purple",
          from: 0.6,
          to: 1.35,
          events: [{ id: "s2", label: "Ship the books", at: 1 }],
        },
        {
          name: "Job",
          hue: "green",
          from: 2,
          to: 2.95,
          events: [{ id: "s4", label: "Start", at: 2.05 }],
        },
      ],
    },
  },
  {
    name: "Rent",
    kinds: ["bar"],
    bar: {
      title: "Rent a month",
      bars: [
        { id: "r1", label: "Berlin", value: 1450 },
        { id: "r2", label: "Lisbon", value: 1300 },
        { id: "r3", label: "Porto", value: 950 },
      ],
    },
  },
];

/**
 * The talk, line by line: when it starts (seconds into the take), which
 * topic it's about, and which pieces it draws when it ends. A line that turns
 * to something new shows New topic? at word `ask` and opens the tab at word
 * `open`, as the app does when you carry on talking.
 */
export interface TalkLine {
  t: number;
  text: string;
  topic: number;
  draws: string[];
  ask?: number;
  open?: number;
}

export const TALK: TalkLine[] = [
  { t: 0, text: "Okay, so the job in Lisbon. Do I actually take it?", topic: 0, draws: ["c"] },
  {
    t: 5,
    text: "The pay’s about the same. It’s, yeah, basically the same.",
    topic: 0,
    draws: ["b1", "l1"],
  },
  {
    t: 10,
    text: "But the sea, the light… I think I’d write more there.",
    topic: 0,
    draws: ["l2", "l3"],
  },
  {
    t: 16,
    text: "What worries me is Portuguese. And leaving Mia, and the band.",
    topic: 0,
    draws: ["b2", "l4", "l5"],
  },
  {
    t: 23,
    text: "Also Berlin rent keeps going up. It’s 1,450 now.",
    topic: 0,
    draws: ["b3", "l6"],
  },
  {
    t: 29,
    text: "Okay, next. If I go, first I give notice on the flat,",
    topic: 1,
    ask: 1,
    open: 4,
    draws: ["s1"],
  },
  {
    t: 34,
    text: "then ship the books, and once that’s done, find a flat in Graça.",
    topic: 1,
    draws: ["s2", "s3"],
  },
  { t: 40, text: "And I start in March.", topic: 1, draws: ["s4"] },
  {
    t: 43,
    text: "Rent, though. Lisbon’s around 1,300, Porto’s under a thousand.",
    topic: 2,
    draws: ["r1", "r2", "r3"],
  },
];

export const TALK_LENGTH = 48;

/** What the note says above the boards after Stop. */
export const CONCLUSION =
  "Leaning towards Lisbon. The reasons to go are the bigger ones; the one big reason to stay is Mia and the band. If I go, the flat comes first.";
export const NOTE_TITLE = "Lisbon?";
export const NOTE_LINE = "The offer came in on Monday. They want an answer by Friday.";
