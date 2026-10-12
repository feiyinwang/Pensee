import { formatDailyNoteDate, resolveDailyNoteFile, type DailyNotePath } from "@/lib/daily-note";

/**
 * Periodic notes: one note per day, ISO week, month, quarter and year, named
 * the way Obsidian's Periodic Notes plugin names them so a vault reads the same
 * in both apps. All of them live in the daily-note folder, and every date here
 * is read off the **local** calendar (see `formatDailyNoteDate`).
 */
export type PeriodKind = "day" | "week" | "month" | "quarter" | "year";

/** Broadest first: the order the agent reads them in. */
export const PERIOD_KINDS: readonly PeriodKind[] = ["year", "quarter", "month", "week", "day"];

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO 8601 week: weeks start on Monday, and week 1 is the one holding the
 *  year's first Thursday, so late December can be week 1 of the next year and
 *  early January week 52/53 of the last. Returns that week-year too. */
export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  // Round: a DST change inside the span makes it a whole number of days ± 1h.
  const days = Math.round((thursday.getTime() - firstThursday.getTime()) / 86_400_000);
  return { year: thursday.getFullYear(), week: 1 + days / 7 };
}

export function quarterOf(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

/** The note's file stem for the period holding `date`:
 *  `2026-10-12`, `2026-W42`, `2026-10`, `2026-Q4`, `2026`. */
export function periodNoteStem(kind: PeriodKind, date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  switch (kind) {
    case "day":
      return formatDailyNoteDate(date);
    case "week": {
      const { year: weekYear, week } = isoWeek(date);
      return `${String(weekYear).padStart(4, "0")}-W${pad(week)}`;
    }
    case "month":
      return `${year}-${pad(date.getMonth() + 1)}`;
    case "quarter":
      return `${year}-Q${quarterOf(date)}`;
    case "year":
      return year;
  }
}

export function resolvePeriodNotePath(
  root: string,
  folder: string,
  kind: PeriodKind,
  date: Date,
): DailyNotePath {
  return resolveDailyNoteFile(root, folder, `${periodNoteStem(kind, date)}.md`);
}
