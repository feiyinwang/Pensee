import { describe, expect, test } from "vite-plus/test";
import {
  cardSiblings,
  cardTree,
  cardsInReadingOrder,
} from "../src/components/editor-area/board/board-flow";
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

function arrow(id: string, from: string, to: string): BoardEl {
  return {
    id,
    t: "arrow",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    b1: { el: from },
    b2: { el: to },
  } as unknown as BoardEl;
}

describe("board card tree", () => {
  // root → a, b, c stacked in a column; d is loose; a → a1.
  const els = [
    note("root", 0, 200),
    note("a", 300, 0),
    note("b", 300, 200),
    note("c", 300, 400),
    note("d", 0, 600),
    note("a1", 600, 0),
    arrow("l1", "root", "a"),
    arrow("l2", "root", "b"),
    arrow("l3", "root", "c"),
    arrow("l4", "a", "a1"),
  ];
  const tree = cardTree(els);
  const ids = (list: BoardEl[]) => list.map((el) => el.id);

  test("siblings are the cards one card's arrows lead into", () => {
    expect(ids(cardSiblings(tree, "b"))).toEqual(["a", "b", "c"]);
  });

  test("cards nothing leads into share the top level", () => {
    expect(ids(cardSiblings(tree, "root"))).toEqual(["root", "d"]);
  });

  test("parent and children follow the arrows", () => {
    expect(tree.parent.get("a1")).toBe("a");
    expect(ids(tree.kids.get("root") ?? [])).toEqual(["a", "b", "c"]);
  });

  test("mind topics use their parent topic", () => {
    const mind = [
      { id: "m", t: "mind", x: 0, y: 0, w: 80, h: 30, tx: "m" },
      { id: "m1", t: "mind", x: 200, y: 0, w: 80, h: 30, tx: "m1", pa: "m" },
    ] as unknown as BoardEl[];
    expect(cardTree(mind).parent.get("m1")).toBe("m");
  });
});
