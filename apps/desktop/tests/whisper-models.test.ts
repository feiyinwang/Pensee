import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const models = vi.hoisted(() => ({
  list: [] as { id: string; name: string; bytes: number; installed: boolean }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => models.list) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ getSetting: () => undefined }) },
}));

import { modelNow, startsSmall } from "../src/lib/talk/whisper-models";

const small = (installed: boolean) => ({ id: "small", name: "Whisper Small", bytes: 1, installed });
const turbo = (installed: boolean) => ({
  id: "turbo",
  name: "Whisper Large v3 Turbo",
  bytes: 2,
  installed,
});

describe("which Whisper model a talk uses", () => {
  beforeEach(() => void (models.list = []));

  test("the chosen model when it's on this Mac", async () => {
    models.list = [small(true), turbo(true)];
    expect(await modelNow("turbo")).toMatchObject({ now: { id: "turbo" }, later: null });
  });

  test("Small while Large v3 Turbo downloads behind it", async () => {
    models.list = [small(true), turbo(false)];
    expect(await modelNow("turbo")).toMatchObject({ now: { id: "small" }, later: { id: "turbo" } });
  });

  test("Small first, to download, when neither is here", async () => {
    models.list = [small(false), turbo(false)];
    expect(await modelNow("turbo")).toMatchObject({
      now: { id: "small", installed: false },
      later: { id: "turbo" },
    });
  });

  test("Small chosen: no bigger model follows", async () => {
    models.list = [small(false), turbo(false)];
    expect(await modelNow("small")).toMatchObject({ now: { id: "small" }, later: null });
  });

  test("Small stands in for the default, Large v3 Turbo", () => {
    expect(startsSmall("small")).toBe(true);
    expect(startsSmall("turbo")).toBe(false);
  });
});
