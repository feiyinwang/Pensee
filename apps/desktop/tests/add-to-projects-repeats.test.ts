import { beforeEach, describe, expect, test } from "vite-plus/test";
import {
  answerRepeat,
  askRepeats,
  closeRepeats,
  useRepeatStore,
} from "../src/components/add-to-projects/repeat-store";

const card = (name: string) => ({ name, status: "none", columns: [], excerpt: null });
const Q = [
  { line: "Make a simple one page website.", existing: card("One page website launch") },
  { line: "Make a discord channel", existing: card("Discord community") },
];

describe("the Already a project? popup", () => {
  beforeEach(() => closeRepeats());

  test("asks each question in turn and resolves with every answer", async () => {
    const answers = askRepeats(Q);
    expect(useRepeatStore.getState().questions).toEqual(Q);
    answerRepeat("new");
    expect(useRepeatStore.getState().answers).toEqual(["new"]);
    answerRepeat("same");
    await expect(answers).resolves.toEqual(["new", "same"]);
    expect(useRepeatStore.getState().resolve).toBeNull();
  });

  test("closing answers Same project for the rest, so nothing unasked is made", async () => {
    const answers = askRepeats(Q);
    answerRepeat("new");
    closeRepeats();
    await expect(answers).resolves.toEqual(["new", "same"]);
  });

  test("no questions, no popup", async () => {
    await expect(askRepeats([])).resolves.toEqual([]);
    expect(useRepeatStore.getState().resolve).toBeNull();
  });

  test("a second request closes the first as Same project", async () => {
    const first = askRepeats(Q);
    const second = askRepeats([Q[0]!]);
    await expect(first).resolves.toEqual(["same", "same"]);
    answerRepeat("new");
    await expect(second).resolves.toEqual(["new"]);
  });
});
