import { describe, expect, test } from "vite-plus/test";
import {
  NO_STATUS,
  dayToIso,
  parseDay,
  projectOf,
  statusColumns,
  statusValue,
  withProjectEdit,
  withProperty,
} from "../src/lib/projects";
import type { TypedNote } from "../src/lib/tauri";

function note(properties: Record<string, string>, name = "Plan"): TypedNote {
  return {
    path: `/vault/${name}.md`,
    relative_path: `${name}.md`,
    name,
    title: null,
    note_type: "Project",
    modified_at: 0,
    properties,
    excerpt: null,
  };
}

describe("parseDay", () => {
  test("reads dates with a time or a wiki link", () => {
    expect(dayToIso(parseDay("2023-01-30")!)).toBe("2023-01-30");
    expect(dayToIso(parseDay("2023-01-30 16:32")!)).toBe("2023-01-30");
    expect(dayToIso(parseDay("[[2023-01-30]]")!)).toBe("2023-01-30");
  });

  test("anything else is no date", () => {
    expect(parseDay("<% tp.file.creation_date() %>")).toBeNull();
    expect(parseDay("2023-02-30")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});

describe("projectOf", () => {
  test("maps status spellings onto one column", () => {
    expect(projectOf(note({ status: "ongoing" })).status).toBe("ongoing");
    expect(projectOf(note({ status: "In progress" })).status).toBe("ongoing");
    expect(projectOf(note({ status: "To-do" })).status).toBe("to-do");
    expect(projectOf(note({})).status).toBe(NO_STATUS);
  });

  test("a start key wins over the creation date, which stands in for it", () => {
    const created = projectOf(note({ dates: "2023-01-30 16:32" }));
    expect(dayToIso(created.start!)).toBe("2023-01-30");
    const started = projectOf(note({ dates: "2023-01-30", starting_date: "2022-10-19" }));
    expect(dayToIso(started.start!)).toBe("2022-10-19");
    expect(projectOf(note({ deadline: "2024-02-04" })).deadline).toBe(parseDay("2024-02-04"));
  });
});

describe("statusColumns", () => {
  test("other values sit before Done, labelled as written", () => {
    const columns = statusColumns([projectOf(note({ status: "Paused" }))]);
    expect(columns.map((c) => c.label)).toEqual([
      "No status",
      "To-do",
      "Ongoing",
      "Paused",
      "Done",
    ]);
    expect(statusValue(columns[0])).toBe("");
  });
});

describe("withProperty", () => {
  test("rewrites only the matching line, keeping the key as written", () => {
    const fm = "Type: Project\nstatus: ongoing\nPeople: \ncssclasses:\n  - cards";
    expect(withProperty(fm, ["Status"], "Done")).toBe(
      "Type: Project\nstatus: Done\nPeople: \ncssclasses:\n  - cards",
    );
  });

  test("replaces a block value's continuation lines", () => {
    const fm = "Type: Project\nStatus:\n  - a\n  - b\nPeople: x";
    expect(withProperty(fm, ["Status"], "To-do")).toBe("Type: Project\nStatus: To-do\nPeople: x");
  });

  test("adds a missing key at the end, and an empty value as a bare key", () => {
    expect(withProperty("Type: Project", ["Deadline", "Due"], "2026-10-12")).toBe(
      "Type: Project\nDeadline: 2026-10-12",
    );
    expect(withProperty("Status: Done", ["Status"], "")).toBe("Status:");
    expect(withProperty(null, ["Start"], "2026-10-12")).toBe("Start: 2026-10-12");
  });

  test("writes into the alias the note already uses", () => {
    const fm = "Type: Project\nStarting_date: 2022-10-10";
    expect(withProperty(fm, ["Start", "Starting_date"], "2022-11-01")).toBe(
      "Type: Project\nStarting_date: 2022-11-01",
    );
  });

  test("returns the input untouched when nothing changes", () => {
    const fm = "Type: Project\nStatus: Done";
    expect(withProperty(fm, ["Status"], "Done")).toBe(fm);
  });

  test("never writes the creation date", () => {
    const fm = "Type: Project\nDates: 2023-01-30 16:32";
    expect(withProjectEdit(fm, { start: parseDay("2023-02-01")! })).toBe(
      "Type: Project\nDates: 2023-01-30 16:32\nStart: 2023-02-01",
    );
  });
});
