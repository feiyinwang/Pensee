import { create } from "zustand";
import * as tauri from "@/lib/tauri";
import {
  flowchartToElements,
  mermaidToElements,
  parseMermaidFlowchart,
} from "@/components/editor-area/board/board-mermaid";
import {
  type BoardEl,
  type BoardScene,
  type MindEl,
  emptyScene,
  newShapeStyle,
} from "@/components/editor-area/board/board-model";
import {
  MIND_PALETTE,
  isMind,
  layoutMind,
  mindSubtree,
} from "@/components/editor-area/board/board-mind";
import { readBoardSvg } from "@/components/editor-area/board/board-file";
import { measureText, wrapText } from "@/components/editor-area/board/board-render";
import {
  boardSaved,
  createBoardFile,
  openBoardFile,
  saveBoardFile,
} from "@/components/editor-area/board/board-file-session";
import { boardKind, handEdited, mergeTopicBoard, mindmapText } from "./topic-board-merge";

// A talk topic drawn as a board (SPECs/talk-notes-spec.md#topic-boards): a
// mind map or a flowchart becomes a real `.board.svg` beside the note the
// first time the AI draws it, so it can be opened and edited like any board,
// while you're talking and after. Each later drawing is merged into the file
// (topic-board-merge.ts: what you did by hand stays). While you have a
// topic's board open, its drawings wait and are merged when you close it.
// Charts (pie, bar, quadrant…) aren't boards: they stay Arc charts.
//
// Loaded with the first topic, so a note never pays for the board code.

interface Entry {
  absolute: string;
  /** As the note embeds it, relative to the note. */
  relative: string;
  /** What this module last wrote: the measure of what you changed by hand. */
  written: BoardScene;
  /** A flowchart you edited: the AI leaves it. */
  frozen: boolean;
}

interface TopicBoardsState {
  /** The boards as they are now, for the talk box. */
  boards: Record<string, { scene: BoardScene; frozen: boolean }>;
  /** The topic whose board is open in the editor. */
  editing: string | null;
}

export const useTopicBoards = create<TopicBoardsState>(() => ({ boards: {}, editing: null }));

const entries = new Map<string, Entry>();
/** One write at a time per topic, in the order the drawings came. */
const queues = new Map<string, Promise<void>>();
/** The newest drawing of the topic you have open, merged when you close it. */
const held = new Map<string, string>();

const show = (key: string, scene: BoardScene, frozen: boolean) =>
  useTopicBoards.setState((s) => ({ boards: { ...s.boards, [key]: { scene, frozen } } }));

async function readScene(absolute: string): Promise<BoardScene> {
  await boardSaved(absolute);
  const parsed = readBoardSvg((await tauri.readFile(absolute)).content);
  if (!parsed) throw new Error(`${absolute} no longer holds a Pensée board.`);
  return parsed.scene;
}

/** How wide a step's words run before they wrap, so a chain of five still
 *  reads in the talk box. */
const STEP_TEXT = 104;
/** The space between two steps, wider where an arrow carries a label. */
const STEP_GAP = 40;

/**
 * The AI's drawing as board elements. Steps are the board's own cards (a
 * rounded rectangle, soft blue with a blue outline) read left to right, their
 * words wrapped so the chain stays narrow; a mind map is the board's own.
 */
export function boardElements(mermaid: string): BoardEl[] | null {
  const flow = parseMermaidFlowchart(mermaid);
  if (!flow) return mermaidToElements(mermaid, measureText);
  flow.dir = "LR";
  for (const node of flow.nodes.values()) {
    node.shape = "roundRect";
    node.text = wrapText(node.text.replace(/\s+/g, " ").trim(), 14, STEP_TEXT).join("\n");
  }
  const els = flowchartToElements(flow, measureText, STEP_GAP);
  for (const el of els) if (el.t === "roundRect") el.st = newShapeStyle();
  return els;
}

async function apply(key: string, mermaid: string, notePath: string): Promise<void> {
  const next = boardElements(mermaid);
  if (!next) return;
  if (useTopicBoards.getState().editing === key) {
    held.set(key, mermaid);
    return;
  }
  const create = async () => {
    const scene = emptyScene();
    scene.els = next;
    const file = await createBoardFile(notePath, scene);
    entries.set(key, { ...file, written: structuredClone(scene), frozen: false });
    show(key, scene, false);
  };
  const entry = entries.get(key);
  if (!entry) return create();
  // Redrawn as the other kind (a map as steps, or back): a board of its own
  // when you'd changed this one, so your version stays on disk as you left it.
  if (boardKind(next) !== boardKind(entry.written.els)) {
    if (handEdited(await readScene(entry.absolute), entry.written)) return create();
    entry.frozen = false;
  }
  if (entry.frozen) return;
  const disk = await readScene(entry.absolute);
  const { scene, frozen } = mergeTopicBoard(disk, entry.written, next, measureText);
  entry.frozen = frozen;
  if (!frozen) {
    await saveBoardFile(entry.absolute, scene);
    entry.written = structuredClone(scene);
  }
  show(key, scene, frozen);
}

/** Draws (or redraws) a topic's board from the AI's Mermaid; charts are skipped. */
export function syncTopicBoard(key: string, mermaid: string, notePath: string): Promise<void> {
  const run = (queues.get(key) ?? Promise.resolve())
    .then(() => apply(key, mermaid, notePath))
    .catch((error: unknown) => console.error(`[talk] topic board ${key} not drawn:`, error));
  queues.set(key, run);
  return run;
}

/** Opens a topic's board in the board editor; its drawings wait until you close it. */
export async function editTopicBoard(key: string, notePath: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  useTopicBoards.setState({ editing: key });
  await queues.get(key);
  try {
    await openBoardFile(entry.absolute, notePath, {
      onClosed: () => void closed(key, notePath),
    });
  } catch (error) {
    useTopicBoards.setState({ editing: null });
    throw error;
  }
}

async function closed(key: string, notePath: string): Promise<void> {
  useTopicBoards.setState({ editing: null });
  const entry = entries.get(key);
  if (!entry) return;
  try {
    const scene = await readScene(entry.absolute);
    // A mind map is merged on the next drawing; a flowchart you changed is yours now.
    if (!scene.els.some((el) => el.t === "mind")) {
      const { frozen } = mergeTopicBoard(scene, entry.written, entry.written.els, measureText);
      entry.frozen = frozen;
    }
    show(key, scene, entry.frozen);
  } catch (error) {
    console.error(`[talk] topic board ${key} not read back:`, error);
  }
  const mermaid = held.get(key);
  held.delete(key);
  if (mermaid) void syncTopicBoard(key, mermaid, notePath);
}

export type MovePlace = "child" | "before" | "after";

/**
 * Moves a mind-map topic in the talk box, by hand: under `target` (its last
 * child), or just before or after it among its siblings. It is yours from
 * then on, so the AI's drawings leave it where you put it.
 */
export function moveTopic(
  key: string,
  id: string,
  target: string,
  place: MovePlace,
): Promise<void> {
  const run = (queues.get(key) ?? Promise.resolve())
    .then(async () => {
      const entry = entries.get(key);
      if (!entry) return;
      const scene = await readScene(entry.absolute);
      const el = scene.els.find((e) => e.id === id);
      const to = scene.els.find((e) => e.id === target);
      if (!isMind(el) || !isMind(to) || !el.pa) return;
      // Not into itself or a branch of its own.
      if (mindSubtree(scene, id).some((m) => m.id === target)) return;
      const parent = place === "child" ? to.id : to.pa;
      if (!parent) return;
      scene.els.splice(scene.els.indexOf(el), 1);
      let at: number;
      if (place === "before") at = scene.els.indexOf(to);
      else {
        const branch = mindSubtree(scene, to.id).map((m) => scene.els.indexOf(m));
        at = Math.max(...branch) + 1;
      }
      scene.els.splice(at, 0, el);
      el.pa = parent;
      delete el.sd;
      const root = scene.els.find((e): e is MindEl => isMind(e) && !e.pa);
      if (!root) return;
      if (parent === root.id) el.c ??= MIND_PALETTE[0];
      else delete el.c;
      layoutMind(scene, root.id, measureText);
      await saveBoardFile(entry.absolute, scene);
      show(key, scene, entry.frozen);
    })
    .catch((error: unknown) => console.error(`[talk] topic not moved on ${key}:`, error));
  queues.set(key, run);
  return run;
}

/** How the AI should see a topic: its board as it is now, when it has one. */
export function topicBoardMermaid(key: string): string | null {
  const board = useTopicBoards.getState().boards[key];
  if (!board) return null;
  return mindmapText(board.scene);
}

/** The board's embed for the note, once every drawing has landed. */
export async function topicBoardEmbed(key: string): Promise<string | null> {
  await queues.get(key);
  return entries.get(key)?.relative ?? null;
}

/** A new talk starts with no boards (a Continue keeps them). */
export function resetTopicBoards(): void {
  entries.clear();
  queues.clear();
  held.clear();
  useTopicBoards.setState({ boards: {}, editing: null });
}
