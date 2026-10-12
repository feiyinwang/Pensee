import { describe, expect, test } from "vite-plus/test";

import { isoWeek, periodNoteStem, resolvePeriodNotePath } from "../src/lib/periodic-notes";

describe("periodNoteStem", () => {
  const day = new Date(2026, 9, 12, 23, 30);

  test("names every period the Obsidian Periodic Notes way", () => {
    expect(periodNoteStem("day", day)).toBe("2026-10-12");
    expect(periodNoteStem("week", day)).toBe("2026-W42");
    expect(periodNoteStem("month", day)).toBe("2026-10");
    expect(periodNoteStem("quarter", day)).toBe("2026-Q4");
    expect(periodNoteStem("year", day)).toBe("2026");
  });

  test("weeks belong to their ISO week-year at year boundaries", () => {
    // Thursday 2026-12-31 is in week 53 of 2026; Friday 2027-01-01 too.
    expect(periodNoteStem("week", new Date(2026, 11, 31))).toBe("2026-W53");
    expect(periodNoteStem("week", new Date(2027, 0, 1))).toBe("2026-W53");
    // Monday 2024-12-30 starts week 1 of 2025.
    expect(periodNoteStem("week", new Date(2024, 11, 30))).toBe("2025-W01");
  });

  test("quarters split the year in three-month blocks", () => {
    expect(periodNoteStem("quarter", new Date(2026, 0, 1))).toBe("2026-Q1");
    expect(periodNoteStem("quarter", new Date(2026, 5, 30))).toBe("2026-Q2");
    expect(periodNoteStem("quarter", new Date(2026, 6, 1))).toBe("2026-Q3");
  });
});

describe("isoWeek", () => {
  test("a Sunday belongs to the week that started on the Monday before", () => {
    expect(isoWeek(new Date(2026, 9, 18))).toEqual({ year: 2026, week: 42 });
    expect(isoWeek(new Date(2026, 9, 19))).toEqual({ year: 2026, week: 43 });
  });
});

describe("resolvePeriodNotePath", () => {
  test("puts every period note in the daily-note folder", () => {
    expect(resolvePeriodNotePath("/vault", "Journal", "week", new Date(2026, 9, 12))).toEqual({
      ok: true,
      path: "/vault/Journal/2026-W42.md",
    });
  });
});
