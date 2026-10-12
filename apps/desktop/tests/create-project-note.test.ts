import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const files = new Map<string, string>();

vi.mock("@/lib/tauri", () => ({
  fileExists: vi.fn(async (path: string) => files.has(path)),
  createFileIfMissing: vi.fn(async (path: string) => {
    const content = files.get(path) ?? "";
    if (!files.has(path)) files.set(path, "");
    return { path, content };
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
    return { path, modified_at: 1 };
  }),
}));

const { createProjectNote } = await import("../src/hooks/use-spaces");
const { useWorkspaceStore } = await import("../src/stores/workspace-store");
const { parseDay } = await import("../src/lib/projects");

describe("createProjectNote", () => {
  beforeEach(() => {
    files.clear();
    useWorkspaceStore.setState({ root: "/vault" });
  });

  test("writes <Name>.md at the vault root as a project", async () => {
    const created = await createProjectNote("Garden: plan", { status: "Ongoing" });
    expect(created).toEqual({ path: "/vault/Garden plan.md", stem: "Garden plan" });
    expect(files.get("/vault/Garden plan.md")).toBe("---\nType: Project\nStatus: Ongoing\n---\n");
  });

  test("a timeline project starts today", async () => {
    await createProjectNote("Trip", { start: parseDay("2026-10-12")! });
    expect(files.get("/vault/Trip.md")).toBe("---\nType: Project\nStart: 2026-10-12\n---\n");
  });

  test("refuses an empty name", async () => {
    await expect(createProjectNote("   ", {})).rejects.toThrow("Enter a name first");
    expect(files.size).toBe(0);
  });

  test("refuses a name that is taken and leaves the note alone", async () => {
    files.set("/vault/Trip.md", "# mine");
    await expect(createProjectNote("Trip", { status: "" })).rejects.toThrow(
      'A note named "Trip" already exists',
    );
    expect(files.get("/vault/Trip.md")).toBe("# mine");
  });
});
