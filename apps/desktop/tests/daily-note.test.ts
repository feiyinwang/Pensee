import { describe, expect, test, vi } from "vite-plus/test";

import {
  formatDailyNoteDate,
  openDailyNote,
  resolveDailyNotePath,
  type DailyNoteDependencies,
} from "../src/lib/daily-note";

const ROOT = "/Users/writer/vault";

function makeDependencies(overrides: Partial<DailyNoteDependencies> = {}): DailyNoteDependencies {
  return {
    createFileIfMissing: vi.fn(async () => ({})),
    openFile: vi.fn(async () => {}),
    showError: vi.fn(),
    now: () => new Date(2022, 3, 19, 9, 0, 0),
    ...overrides,
  };
}

describe("formatDailyNoteDate", () => {
  test("formats the local calendar date", () => {
    expect(formatDailyNoteDate(new Date(2022, 3, 19, 9, 0, 0))).toBe("2022-04-19");
  });

  test("zero-pads month and day", () => {
    expect(formatDailyNoteDate(new Date(2022, 0, 5, 12, 0, 0))).toBe("2022-01-05");
  });

  test("names the note after the writer's day, not the UTC day", () => {
    // 23:30 local on the 19th is already the 20th in UTC for any positive offset;
    // the note must still be the 19th's.
    const lateEvening = new Date(2022, 3, 19, 23, 30, 0);
    expect(formatDailyNoteDate(lateEvening)).toBe("2022-04-19");
  });
});

describe("resolveDailyNotePath", () => {
  const date = new Date(2022, 3, 19, 9, 0, 0);

  test("puts the note at the workspace root when no folder is configured", () => {
    expect(resolveDailyNotePath(ROOT, "", date)).toEqual({
      ok: true,
      path: `${ROOT}/2022-04-19.md`,
    });
  });

  test("tolerates a trailing slash on the workspace root", () => {
    expect(resolveDailyNotePath(`${ROOT}/`, "", date)).toEqual({
      ok: true,
      path: `${ROOT}/2022-04-19.md`,
    });
  });

  test("supports nested folders and ignores padding slashes and whitespace", () => {
    for (const folder of [
      "Journal/Daily",
      "  Journal/Daily  ",
      "/Journal/Daily/",
      "./Journal/Daily",
    ]) {
      expect(resolveDailyNotePath(ROOT, folder, date)).toEqual({
        ok: true,
        path: `${ROOT}/Journal/Daily/2022-04-19.md`,
      });
    }
  });

  test("reads a leading slash as workspace-relative, never as a filesystem root", () => {
    expect(resolveDailyNotePath(ROOT, "/Users/elsewhere/Journal", date)).toEqual({
      ok: true,
      path: `${ROOT}/Users/elsewhere/Journal/2022-04-19.md`,
    });
  });

  test("treats a folder that normalizes away as the workspace root", () => {
    expect(resolveDailyNotePath(ROOT, "./", date)).toEqual({
      ok: true,
      path: `${ROOT}/2022-04-19.md`,
    });
  });

  test("rejects folders that escape the workspace instead of guessing", () => {
    for (const folder of ["..", "../elsewhere", "Journal/../../elsewhere", "C:\\elsewhere"]) {
      const resolved = resolveDailyNotePath(ROOT, folder, date);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.error).toContain("outside the workspace");
    }
  });

  test("keeps an interior `..` that stays inside the workspace", () => {
    expect(resolveDailyNotePath(ROOT, "Journal/../Daily", date)).toEqual({
      ok: true,
      path: `${ROOT}/Daily/2022-04-19.md`,
    });
  });
});

describe("openDailyNote", () => {
  test("creates today's note and opens it", async () => {
    const dependencies = makeDependencies();
    await openDailyNote(ROOT, "Journal", dependencies);

    expect(dependencies.createFileIfMissing).toHaveBeenCalledWith(`${ROOT}/Journal/2022-04-19.md`);
    expect(dependencies.openFile).toHaveBeenCalledWith(`${ROOT}/Journal/2022-04-19.md`);
    expect(dependencies.showError).not.toHaveBeenCalled();
  });

  test("is a no-op without a workspace", async () => {
    const dependencies = makeDependencies();
    await openDailyNote(null, "", dependencies);

    expect(dependencies.createFileIfMissing).not.toHaveBeenCalled();
    expect(dependencies.openFile).not.toHaveBeenCalled();
    expect(dependencies.showError).not.toHaveBeenCalled();
  });

  test("reports an escaping folder without touching the filesystem", async () => {
    const dependencies = makeDependencies();
    await openDailyNote(ROOT, "../elsewhere", dependencies);

    expect(dependencies.createFileIfMissing).not.toHaveBeenCalled();
    expect(dependencies.openFile).not.toHaveBeenCalled();
    expect(dependencies.showError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open today's note"),
    );
  });

  test("reports filesystem failures instead of swallowing them", async () => {
    const dependencies = makeDependencies({
      createFileIfMissing: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
    });
    await openDailyNote(ROOT, "", dependencies);

    expect(dependencies.openFile).not.toHaveBeenCalled();
    expect(dependencies.showError).toHaveBeenCalledWith(
      "Failed to open today's note: Permission denied",
    );
  });
});
