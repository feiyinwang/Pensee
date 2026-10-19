import { describe, expect, it } from "vite-plus/test";
import {
  firstSentence,
  formatDay,
  inlineParts,
  isNewerVersion,
  isUnseenRelease,
  paintingIndex,
  parseChangelog,
  unseenDay,
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

describe("unseenDay", () => {
  const days = parseChangelog(CHANGELOG);

  it("on a first run records the newest day and shows nothing", () => {
    expect(unseenDay(days, null)).toEqual({ record: "2026-10-18" });
  });

  it("shows the newest day when it's after the last one seen", () => {
    expect(unseenDay(days, "2026-10-17")).toEqual({ show: days[0] });
  });

  it("shows nothing once the newest day is seen", () => {
    expect(unseenDay(days, "2026-10-18")).toBeNull();
    expect(unseenDay([], "2026-10-18")).toBeNull();
  });
});

describe("formatDay and paintingIndex", () => {
  it("names the day", () => {
    expect(formatDay("2026-10-18")).toBe("October 18");
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

describe("isNewerVersion", () => {
  it("compares each number, not the text", () => {
    expect(isNewerVersion("0.7.0", "0.6.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.2")).toBe(true);
    expect(isNewerVersion("1.0", "0.99.99")).toBe(true);
  });

  it("is false for the same or an older version", () => {
    expect(isNewerVersion("0.6.0", "0.6.0")).toBe(false);
    expect(isNewerVersion("0.6", "0.6.0")).toBe(false);
    expect(isNewerVersion("0.5.9", "0.6.0")).toBe(false);
  });

  it("reads a v prefix and ignores a suffix", () => {
    expect(isNewerVersion("v0.7.0", "0.6.0")).toBe(true);
    expect(isNewerVersion("0.6.0-beta", "0.6.0")).toBe(false);
  });

  it("throws on something that isn't a version", () => {
    expect(() => isNewerVersion("latest", "0.6.0")).toThrow('Not a version: "latest"');
  });
});

describe("isUnseenRelease", () => {
  it("is unseen until the card was closed for it or a later one", () => {
    expect(isUnseenRelease("0.7.0", null)).toBe(true);
    expect(isUnseenRelease("0.7.0", "0.6.0")).toBe(true);
    expect(isUnseenRelease("0.7.0", "0.7.0")).toBe(false);
    expect(isUnseenRelease("0.7.0", "0.8.0")).toBe(false);
  });
});
