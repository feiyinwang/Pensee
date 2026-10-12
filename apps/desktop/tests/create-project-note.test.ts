import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const files = new Map<string, string>();

vi.mock("@/lib/tauri", () => ({
  fileExists: vi.fn(async (path: string) => files.has(path)),
  // As the Rust command: made exclusively, with the new-note "# " in it.
  createFile: vi.fn(async (path: string) => {
    if (files.has(path)) throw `Already exists: ${path}`;
    files.set(path, "# ");
    return { path, content: "# ", modified_at: 1 };
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

const { adoptProjectNote, createProjectNote, findNoteNamed, searchNotes } =
  await import("../src/hooks/use-spaces");
const { useWorkspaceStore } = await import("../src/stores/workspace-store");
const { clearVaultTemplates, forgetVaultTemplates } = await import("../src/hooks/vault-templates");
const tauri = await import("../src/lib/tauri");
const { parseDay } = await import("../src/lib/projects");

describe("createProjectNote", () => {
  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
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

describe("createProjectNote from the vault's template", () => {
  const settings = "/vault/.obsidian/plugins/templater-obsidian/data.json";
  const template = [
    "---",
    "Type: Project",
    "Organization: Container Living",
    "Creation Dates: <% tp.file.creation_date() %>",
    "Deadline: ",
    "Status: Done",
    "cssclasses:",
    "  - cards",
    "---",
    "# Tasks",
    "",
    '```dataview\nWhere contains(Project, "<% tp.file.title %>")\n```',
    "",
  ].join("\n");

  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
    useWorkspaceStore.setState({ root: "/vault" });
    files.set(
      settings,
      JSON.stringify({
        folder_templates: [
          { folder: "Practical/People", template: "T/Person.md" },
          { folder: "1. Project", template: "T/Project.md" },
        ],
      }),
    );
    files.set("/vault/T/Person.md", "---\nType: People\n---\n");
    files.set("/vault/T/Project.md", template);
  });

  test("is made in the template's folder with its properties and sections", async () => {
    const created = await createProjectNote("Trip", { status: "Ongoing" });
    expect(created.path).toBe("/vault/1. Project/Trip.md");
    const content = files.get("/vault/1. Project/Trip.md")!;
    expect(content).toMatch(
      /^---\nType: Project\nOrganization: Container Living\nCreation Dates: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\nDeadline: \nStatus: Ongoing\ncssclasses:\n {2}- cards\n---\n# Tasks\n/,
    );
    expect(content).toContain('contains(Project, "Trip")');
    expect(content).not.toContain("<%");
  });

  test("No status empties the template's status", async () => {
    await createProjectNote("Trip", { status: "" });
    expect(files.get("/vault/1. Project/Trip.md")).toContain("\nStatus:\ncssclasses:");
  });

  test("without a project template it is just the fields, at the root", async () => {
    files.set(
      settings,
      JSON.stringify({ folder_templates: [{ folder: "P", template: "T/Person.md" }] }),
    );
    await createProjectNote("Trip", { status: "Ongoing" });
    expect(files.get("/vault/Trip.md")).toBe("---\nType: Project\nStatus: Ongoing\n---\n");
  });
});

describe("reading the vault's templates", () => {
  const settings = "/vault/.obsidian/plugins/templater-obsidian/data.json";

  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
    useWorkspaceStore.setState({ root: "/vault" });
    files.set(
      settings,
      JSON.stringify({
        folder_templates: [
          { folder: "People", template: "T/Person.md" },
          { folder: "Daily", template: "T/Daily.md" },
          { folder: "1. Project", template: "T/Project template.md" },
        ],
      }),
    );
    files.set("/vault/T/Person.md", "---\nType: People\n---\n");
    files.set("/vault/T/Daily.md", "---\nType: Daily\n---\n");
    files.set("/vault/T/Project template.md", "---\nType: Project\nStatus: Done\n---\n# Tasks\n");
    vi.mocked(tauri.readFile).mockClear();
  });

  const reads = () => vi.mocked(tauri.readFile).mock.calls.map(([path]) => path);

  test("reads only the template named for projects, once for every new project", async () => {
    await createProjectNote("Trip", { status: "" });
    await createProjectNote("Garden", { status: "" });
    expect(reads()).toEqual([settings, "/vault/T/Project template.md"]);
    expect(files.get("/vault/1. Project/Garden.md")).toContain("# Tasks");
  });

  test("a changed template is read again", async () => {
    await createProjectNote("Trip", { status: "" });
    files.set("/vault/T/Project template.md", "---\nType: Project\n---\n# Plan\n");
    forgetVaultTemplates("/vault/T/Project template.md");
    await createProjectNote("Garden", { status: "" });
    expect(files.get("/vault/1. Project/Garden.md")).toContain("# Plan");
  });

  test("without one named for projects, the rest are read to find it", async () => {
    files.set(
      settings,
      JSON.stringify({
        folder_templates: [
          { folder: "People", template: "T/Person.md" },
          { folder: "Work", template: "T/Work.md" },
        ],
      }),
    );
    files.set("/vault/T/Work.md", "---\nType: Project\n---\n");
    await createProjectNote("Trip", { status: "" });
    expect(files.has("/vault/Work/Trip.md")).toBe(true);
  });
});

describe("findNoteNamed", () => {
  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
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

describe("template folders", () => {
  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
    useWorkspaceStore.setState({ root: "/vault" });
  });

  test("Templater's templates folder is never found or suggested", async () => {
    files.set(
      "/vault/.obsidian/plugins/templater-obsidian/data.json",
      JSON.stringify({ templates_folder: "Practical/🖨 Template" }),
    );
    files.set("/vault/Practical/🖨 Template/Project template.md", "");
    expect(await findNoteNamed("Project template")).toBeNull();
    files.set("/vault/1. Project/Project template.md", "");
    expect(await findNoteNamed("Project template")).toBe("/vault/1. Project/Project template.md");
    expect((await searchNotes("template", 30)).map((r) => r.path)).toEqual([
      "/vault/1. Project/Project template.md",
    ]);
  });

  test("the core Templates plugin's folder too", async () => {
    files.set("/vault/.obsidian/templates.json", JSON.stringify({ folder: "Templates" }));
    files.set("/vault/Templates/Trip.md", "");
    files.set("/vault/Templates and more/Trip.md", "");
    expect(await findNoteNamed("Trip")).toBe("/vault/Templates and more/Trip.md");
  });

  test("without template settings, every note counts", async () => {
    files.set("/vault/Templates/Trip.md", "");
    expect(await findNoteNamed("Trip")).toBe("/vault/Templates/Trip.md");
  });
});

describe("adoptProjectNote", () => {
  beforeEach(() => {
    files.clear();
    clearVaultTemplates();
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
