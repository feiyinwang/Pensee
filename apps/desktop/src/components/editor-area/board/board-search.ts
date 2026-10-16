/**
 * Find & replace on a board — pure, no DOM.
 *
 * Searches every element that carries text: text boxes, sticky notes, shape
 * labels, connector labels, mind-map topics, and section names. Matching is
 * case-insensitive and literal (no regex syntax). Results come back in reading
 * order (top to bottom, then left to right) so "next" moves the way the eye
 * does.
 */

import { type BoardEl, type BoardScene, setTextOf, textOf } from "./board-model";

function literal(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

export function countIn(text: string, query: string): number {
  if (!query) return 0;
  return text.match(literal(query))?.length ?? 0;
}

/** Ids of the elements whose text contains `query`, in reading order. */
export function findMatches(scene: BoardScene, query: string): string[] {
  if (!query.trim()) return [];
  return scene.els
    .filter((el) => countIn(textOf(el), query) > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((el) => el.id);
}

/** Replaces every occurrence in one element. Returns how many it replaced. */
export function replaceInElement(el: BoardEl, query: string, replacement: string): number {
  const text = textOf(el);
  const n = countIn(text, query);
  if (n)
    setTextOf(
      el,
      text.replace(literal(query), () => replacement),
    );
  return n;
}
