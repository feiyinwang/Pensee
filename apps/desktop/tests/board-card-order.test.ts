import { describe, expect, test } from "vite-plus/test";
import { cardsInReadingOrder } from "../src/components/editor-area/board/board-flow";
import type { BoardEl } from "../src/components/editor-area/board/board-model";

function note(id: string, x: number, y: number): BoardEl {
  return { id, t: "sticky", x, y, w: 100, h: 100, tx: id } as unknown as BoardEl;
}

describe("board card reading order", () => {
  test("rows top to bottom, each left to right", () => {
    const els = [note("d", 200, 300), note("b", 200, 0), note("c", 0, 300), note("a", 0, 0)];
    expect(cardsInReadingOrder(els).map((el) => el.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("slightly misaligned cards still share a row", () => {
    const els = [note("b", 200, 0), note("a", 0, 30), note("c", 0, 200)];
    expect(cardsInReadingOrder(els).map((el) => el.id)).toEqual(["a", "b", "c"]);
  });

  test("connectors are not cards", () => {
    const line = { id: "l", t: "line", x: 0, y: 0, w: 0, h: 0 } as unknown as BoardEl;
    expect(cardsInReadingOrder([line, note("a", 0, 0)]).map((el) => el.id)).toEqual(["a"]);
  });
});
