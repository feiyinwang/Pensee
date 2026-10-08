import { describe, expect, test } from "vite-plus/test";
import { dayFrom, matchingDateItems } from "../src/components/editor-area/date-mention";
import { formatDailyNoteDate } from "../src/lib/daily-note";

describe("dayFrom", () => {
  test("walks the local calendar across month and year ends", () => {
    expect(formatDailyNoteDate(dayFrom(new Date(2026, 9, 31, 23, 30), 1))).toBe("2026-11-01");
    expect(formatDailyNoteDate(dayFrom(new Date(2027, 0, 1, 0, 5), -1))).toBe("2026-12-31");
    expect(formatDailyNoteDate(dayFrom(new Date(2026, 9, 8, 12), 0))).toBe("2026-10-08");
  });
});

describe("matchingDateItems", () => {
  test("filters by label prefix, case-insensitively", () => {
    expect(matchingDateItems("").map((i) => i.label)).toEqual(["Today", "Tomorrow", "Yesterday"]);
    expect(matchingDateItems("to").map((i) => i.label)).toEqual(["Today", "Tomorrow"]);
    expect(matchingDateItems("TOD").map((i) => i.label)).toEqual(["Today"]);
    expect(matchingDateItems("x")).toEqual([]);
  });
});
