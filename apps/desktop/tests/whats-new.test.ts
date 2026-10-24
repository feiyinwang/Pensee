import { describe, expect, it } from "vite-plus/test";
import {
  firstSentence,
  formatDay,
  formatDays,
  inlineParts,
  paintingIndex,
  parseChangelog,
  unseenDays,
} from "../src/lib/whats-new";

const CHANGELOG = `# Changelog

## 2026-10-17

- ⌘↓ now takes you to the very bottom of a note.

## 2026-10-18

- Pensée now welcomes you on first launch. It asks one thing per screen.
- When **Add to Projects** finds a line,
  it now asks first. **Already a project?** shows your line.
`;

describe("parseChangelog", () => {
  it("reads each dated section, newest first, joining wrapped entries", () => {
    const days = parseChangelog(CHANGELOG);
    expect(days.map((d) => d.date)).toEqual(["2026-10-18", "2026-10-17"]);
    expect(days[0].entries).toHaveLength(2);
    expect(days[0].entries[1]).toBe(
      "When **Add to Projects** finds a line, it now asks first. **Already a project?** shows your line.",
    );
  });

  it("skips headings without a date and sections without entries", () => {
    expect(parseChangelog("# Changelog\n\n## Unreleased\n\n- x\n\n## 2026-10-01\n")).toEqual([]);
  });
});

describe("firstSentence", () => {
  it("stops at the first sentence end", () => {
    expect(firstSentence("Pensée now welcomes you on first launch. It asks one thing.")).toBe(
      "Pensée now welcomes you on first launch.",
    );
  });

  it("doesn't stop inside code, version numbers or before a lowercase word", () => {
    expect(firstSentence("Install `brew install x. y` or 0.6.0 e.g. here. Next.")).toBe(
      "Install `brew install x. y` or 0.6.0 e.g. here.",
    );
  });

  it("keeps a bold label that ends in a question mark inside the sentence", () => {
    expect(firstSentence("**Already a project?** shows your line. More.")).toBe(
      "**Already a project?** shows your line.",
    );
  });
});

describe("inlineParts", () => {
  it("keeps code and italics, and drops bold and link markup", () => {
    expect(inlineParts("Run `pensee` on **Today** with _care_ via [docs](https://x.y).")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "pensee" },
      { kind: "text", text: " on " },
      { kind: "text", text: "Today" },
      { kind: "text", text: " with " },
      { kind: "em", text: "care" },
      { kind: "text", text: " via " },
      { kind: "text", text: "docs" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves snake_case words alone", () => {
    expect(inlineParts("a my_file_name b")).toEqual([{ kind: "text", text: "a my_file_name b" }]);
  });
});

describe("unseenDays", () => {
  const days = parseChangelog(CHANGELOG);

  it("on a first run records the newest day and shows nothing", () => {
    expect(unseenDays(days, null)).toEqual({ record: "2026-10-18" });
  });

  it("shows the newest day when it's after the last one seen", () => {
    expect(unseenDays(days, "2026-10-17")).toEqual({ show: [days[0]] });
  });

  it("shows every day since the last one seen, newest first", () => {
    expect(unseenDays(days, "2026-10-01")).toEqual({ show: days });
  });

  it("shows nothing once the newest day is seen", () => {
    expect(unseenDays(days, "2026-10-18")).toBeNull();
    expect(unseenDays([], "2026-10-18")).toBeNull();
  });
});

describe("formatDay and paintingIndex", () => {
  it("names the day", () => {
    expect(formatDay("2026-10-18")).toBe("October 18");
  });

  it("names a run of days by its first and last", () => {
    const day = (date: string) => ({ date, entries: ["x"] });
    expect(formatDays([day("2026-10-18")])).toBe("October 18");
    expect(formatDays([day("2026-10-18"), day("2026-10-16")])).toBe("October 16–18");
    expect(formatDays([day("2026-10-02"), day("2026-09-30")])).toBe("September 30 – October 2");
  });

  it("gives a day the same painting every time, within range", () => {
    expect(paintingIndex("2026-10-18", 10)).toBe(paintingIndex("2026-10-18", 10));
    for (const d of ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]) {
      const i = paintingIndex(d, 10);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(10);
    }
  });
});
