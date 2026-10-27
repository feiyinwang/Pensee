import { create } from "zustand";
import * as tauri from "@/lib/tauri";
import { mermaidToElements } from "@/components/editor-area/board/board-mermaid";
import { type BoardScene, emptyScene } from "@/components/editor-area/board/board-model";
import { readBoardSvg } from "@/components/editor-area/board/board-file";
import { measureText } from "@/components/editor-area/board/board-render";
import {
  boardSaved,
  createBoardFile,
  openBoardFile,
  saveBoardFile,
} from "@/components/editor-area/board/board-file-session";
import { mergeTopicBoard, mindmapText } from "./topic-board-merge";

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

async function apply(key: string, mermaid: string, notePath: string): Promise<void> {
  const next = mermaidToElements(mermaid, measureText);
  if (!next) return;
  if (useTopicBoards.getState().editing === key) {
    held.set(key, mermaid);
    return;
  }
  const entry = entries.get(key);
  if (!entry) {
    const scene = emptyScene();
    scene.els = next;
    const file = await createBoardFile(notePath, scene);
    entries.set(key, { ...file, written: structuredClone(scene), frozen: false });
    show(key, scene, false);
    return;
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
