import type { BoardEl, BoardScene, MindEl } from "@/components/editor-area/board/board-model";
import {
  MIND_PALETTE,
  addMindChild,
  isMind,
  layoutMind,
  type Measure,
} from "@/components/editor-area/board/board-mind";

// A talk topic's board after the AI redraws it (SPECs/talk-notes-spec.md#topic-boards),
// as plain data in, data out. The board file is the truth: what you did to it
// by hand stays, and only what the AI put there and you left alone follows
// the AI's new drawing.
//
// "By hand" is measured against `written`, the scene this module last wrote:
// - a mind-map topic whose text, parent, colour or side differs from it, or
//   that it never wrote, is yours, and stays where you put it;
// - a topic you deleted stays deleted: the AI can't bring the same words back;
// - shapes, stickies and pen strokes you added are never touched.
// Positions aren't compared: the board lays a mind map out again whenever any
// topic moves, so they change without being edited.
//
// A flowchart has no tree to merge into: once you change anything on it, the
// AI leaves it as it is (`frozen`).

export interface MergeResult {
  scene: BoardScene;
  /** You edited a flowchart, so the AI's drawing was not applied. */
  frozen: boolean;
}

const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const minds = (els: BoardEl[]) => els.filter(isMind);

function sameMind(a: MindEl, b: MindEl): boolean {
  return norm(a.tx) === norm(b.tx) && a.pa === b.pa && a.c === b.c && a.sd === b.sd;
}

/** Strips what layout writes, so a board compares by what was edited. */
function content(el: BoardEl): string {
  const { x: _x, y: _y, w: _w, h: _h, ...rest } = el as BoardEl & Record<string, unknown>;
  return JSON.stringify(rest);
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Merges the AI's new drawing (`next`, the elements of a fresh conversion)
 * into `file`, the board as it is on disk, given `written`, what this module
 * last saved there.
 */
export function mergeTopicBoard(
  file: BoardScene,
  written: BoardScene,
  next: BoardEl[],
  measure: Measure,
): MergeResult {
  const nextRoot = minds(next).find((el) => !el.pa);
  if (!nextRoot) return mergeFlow(file, written, next);
  return { scene: mergeMind(file, written, next, nextRoot, measure), frozen: false };
}

function mergeFlow(file: BoardScene, written: BoardScene, next: BoardEl[]): MergeResult {
  const edited =
    file.els.length !== written.els.length ||
    file.els.some((el, i) => content(el) !== content(written.els[i]));
  if (edited) return { scene: file, frozen: true };
  return { scene: { ...clone(file), els: clone(next) }, frozen: false };
}

function mergeMind(
  file: BoardScene,
  written: BoardScene,
  next: BoardEl[],
  nextRoot: MindEl,
  measure: Measure,
): BoardScene {
  const scene = clone(file);
  const wrote = new Map(minds(written.els).map((el) => [el.id, el]));
  const yours = (el: MindEl) => {
    const before = wrote.get(el.id);
    return !before || !sameMind(el, before);
  };
  const present = new Set(scene.els.map((el) => el.id));
  const deleted = new Set(
    [...wrote.values()].filter((el) => !present.has(el.id)).map((el) => norm(el.tx)),
  );

  const root = minds(scene.els).find((el) => !el.pa);
  if (!root) return scene;
  if (!yours(root)) root.tx = nextRoot.tx;

  // The AI's tree, in its order: each of its topics matched to one of the
  // board's by words, or added; `onBoard` maps its ids to the board's.
  const nextKids = new Map<string, MindEl[]>();
  for (const el of minds(next)) {
    if (!el.pa) continue;
    const kids = nextKids.get(el.pa) ?? [];
    kids.push(el);
    nextKids.set(el.pa, kids);
  }
  const onBoard = new Map<string, string>([[nextRoot.id, root.id]]);
  const matched = new Set<string>([root.id]);
  const aiOrder = new Map<string, string[]>();
  const visit = (aiParent: MindEl) => {
    const parentId = onBoard.get(aiParent.id);
    if (!parentId) return;
    for (const ai of nextKids.get(aiParent.id) ?? []) {
      const words = norm(ai.tx);
      // By its words now, or by the words it had before you renamed it.
      let el = minds(scene.els).find(
        (m) =>
          !matched.has(m.id) &&
          (norm(m.tx) === words || (wrote.has(m.id) && norm(wrote.get(m.id)!.tx) === words)),
      );
      if (!el) {
        // You deleted these words: the branch stays gone.
        if (deleted.has(words)) continue;
        const parent = scene.els.find((e) => e.id === parentId) as MindEl;
        el = addMindChild(scene, parent);
        el.tx = ai.tx;
      } else if (!yours(el) && el.pa !== parentId) {
        el.pa = parentId;
        delete el.sd;
        if (parentId === root.id) el.c ??= MIND_PALETTE[0];
        else delete el.c;
      }
      matched.add(el.id);
      onBoard.set(ai.id, el.id);
      if (el.pa === parentId) aiOrder.set(parentId, [...(aiOrder.get(parentId) ?? []), el.id]);
      visit(ai);
    }
  };
  visit(nextRoot);

  // What the AI drew before and has now dropped goes, unless it's yours or
  // holds something of yours.
  const kidsOf = (id: string) => minds(scene.els).filter((el) => el.pa === id);
  const keeps = (el: MindEl): boolean =>
    matched.has(el.id) || yours(el) || kidsOf(el.id).some(keeps);
  const dropped = new Set(
    minds(scene.els)
      .filter((el) => el.pa && !keeps(el))
      .map((el) => el.id),
  );
  scene.els = scene.els.filter((el) => !dropped.has(el.id));

  // Sibling order is scene order: the AI's order first, then yours as it was.
  const ordered: MindEl[] = [];
  const walk = (el: MindEl) => {
    ordered.push(el);
    const kids = kidsOf(el.id);
    const first = aiOrder.get(el.id) ?? [];
    const byId = new Map(kids.map((k) => [k.id, k]));
    for (const id of first) {
      const kid = byId.get(id);
      if (kid) walk(kid);
    }
    for (const kid of kids) if (!first.includes(kid.id)) walk(kid);
  };
  walk(root);
  scene.els = [...ordered, ...scene.els.filter((el) => !isMind(el))];
  // First-level topics carry the branch colour.
  for (const [i, el] of kidsOf(root.id).entries()) el.c ??= MIND_PALETTE[i % MIND_PALETTE.length];

  // The root keeps its centre, so the map doesn't jump.
  layoutMind(scene, root.id, measure);
  return scene;
}

/** A board's mind map as Mermaid, for telling the AI how the board looks now. */
export function mindmapText(scene: BoardScene): string | null {
  const all = minds(scene.els);
  const root = all.find((el) => !el.pa);
  if (!root) return null;
  const label = (text: string) => text.replace(/[()[\]{}]/g, "").trim() || "…";
  const lines = ["mindmap", `  root((${label(root.tx)}))`];
  const walk = (id: string, depth: number) => {
    for (const el of all.filter((m) => m.pa === id)) {
      lines.push(`${"  ".repeat(depth + 2)}${label(el.tx)}`);
      walk(el.id, depth + 1);
    }
  };
  walk(root.id, 0);
  return lines.join("\n");
}
