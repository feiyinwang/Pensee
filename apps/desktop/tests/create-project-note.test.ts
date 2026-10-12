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
  readFile: vi.fn(async (path: string) => ({ content: files.get(path) ?? "" })),
  // Every file whose path contains the query, as the Rust fuzzy search would rank them.
  fuzzySearch: vi.fn(async (query: string) =>
    [...files.keys()]
      .filter((path) => path.toLowerCase().includes(query.toLowerCase()))
      .map((path) => ({
        path,
        filename: path.split("/").pop()!,
        relative_path: path.slice("/vault/".length),
        score: 1,
        match_indices: [],
      })),
  ),
}));

const { adoptProjectNote, createProjectNote, findNoteNamed } =
  await import("../src/hooks/use-spaces");
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

describe("findNoteNamed", () => {
  beforeEach(() => {
    files.clear();
    useWorkspaceStore.setState({ root: "/vault" });
  });

  test("finds the note with that name anywhere, ignoring case", async () => {
    files.set("/vault/2. Area/Trip.md", "");
    files.set("/vault/Trip planning.md", "");
    files.set("/vault/books/Trip.pdf", "");
    expect(await findNoteNamed("trip")).toBe("/vault/2. Area/Trip.md");
  });

  test("null when no note has the name", async () => {
    files.set("/vault/Trip planning.md", "");
    expect(await findNoteNamed("Trip")).toBeNull();
  });

  test("of several, a preferred one first, then the shortest path", async () => {
    files.set("/vault/4. Archive/old/Trip.md", "");
    files.set("/vault/4. Archive/Trip.md", "");
    files.set("/vault/x/nested/deeper/Trip.md", "");
    expect(await findNoteNamed("Trip")).toBe("/vault/4. Archive/Trip.md");
    expect(await findNoteNamed("Trip", (path) => path.startsWith("/vault/x/"))).toBe(
      "/vault/x/nested/deeper/Trip.md",
    );
  });
});

describe("adoptProjectNote", () => {
  beforeEach(() => {
    files.clear();
    useWorkspaceStore.setState({ root: "/vault" });
  });

  test("makes a note a project, keeping everything else", async () => {
    files.set("/vault/Trip.md", "---\nPeople: Ana\n---\n# Trip\nNotes\n");
    expect(await adoptProjectNote("/vault/Trip.md", { status: "Ongoing" }, () => false)).toBe(true);
    expect(files.get("/vault/Trip.md")).toBe(
      "---\nPeople: Ana\nType: Project\nStatus: Ongoing\n---\n# Trip\nNotes\n",
    );
  });

  test("gives a note without properties some", async () => {
    files.set("/vault/Trip.md", "Notes\n");
    await adoptProjectNote("/vault/Trip.md", { status: "" }, () => false);
    expect(files.get("/vault/Trip.md")).toBe("---\nType: Project\nStatus:\n---\nNotes\n");
  });

  test("asks before taking a note of another type, and keeps it when told no", async () => {
    files.set("/vault/Trip.md", "---\nType: Book\n---\n");
    const asked: string[] = [];
    const no = (type: string) => (asked.push(type), false);
    expect(await adoptProjectNote("/vault/Trip.md", { status: "Done" }, no)).toBe(false);
    expect(asked).toEqual(["Book"]);
    expect(files.get("/vault/Trip.md")).toBe("---\nType: Book\n---\n");

    expect(await adoptProjectNote("/vault/Trip.md", { status: "Done" }, () => true)).toBe(true);
    expect(files.get("/vault/Trip.md")).toBe("---\nType: Project\nStatus: Done\n---\n");
  });

  test("a project already needs no asking", async () => {
    files.set("/vault/Trip.md", "---\ntype: project\n---\n");
    const ask = vi.fn(() => false);
    await adoptProjectNote("/vault/Trip.md", { status: "Done" }, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(files.get("/vault/Trip.md")).toBe("---\ntype: Project\nStatus: Done\n---\n");
  });
});
