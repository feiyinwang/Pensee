import { describe, expect, test, vi } from "vite-plus/test";
import {
  ensureWikiPage,
  appendPageBody,
  findWikiPage,
  newPageContent,
  newPagePath,
  pageFromSelection,
  pageNameFromWikiTarget,
  safePageName,
  textMovedToPage,
  type WikiPageDeps,
} from "../src/lib/wiki-pages";
import type { SearchResult } from "../src/types/fs";

const ROOT = "/vault";

function fakeFs(existing: string[] = []) {
  const files = new Map<string, string>(existing.map((p) => [p, ""]));
  const deps: WikiPageDeps = {
    fuzzySearch: async (query) =>
      [...files.keys()]
        .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
        .map(
          (path) =>
            ({
              path,
              filename: path.slice(path.lastIndexOf("/") + 1),
              relative_path: path.slice(ROOT.length + 1),
            }) as SearchResult,
        ),
    fileExists: async (path) => files.has(path),
    createFile: vi.fn(async (path: string) => {
      if (files.has(path)) throw new Error("exists");
      files.set(path, "");
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
  };
  return { files, deps };
}

describe("pageNameFromWikiTarget", () => {
  test("names a page, dropping alias, fragment and .md", () => {
    expect(pageNameFromWikiTarget("Budget")).toBe("Budget");
    expect(pageNameFromWikiTarget("Budget|my budget")).toBe("Budget");
    expect(pageNameFromWikiTarget("Budget#Rent")).toBe("Budget");
    expect(pageNameFromWikiTarget("Budget.md")).toBe("Budget");
    expect(pageNameFromWikiTarget("notes/Budget")).toBe("notes/Budget");
  });

  test("names nothing for fragments, attachments and blanks", () => {
    expect(pageNameFromWikiTarget("#Heading")).toBeNull();
    expect(pageNameFromWikiTarget("photo.png")).toBeNull();
    expect(pageNameFromWikiTarget("   ")).toBeNull();
  });
});

describe("newPagePath", () => {
  test("bare names land next to the linking note", () => {
    expect(newPagePath("Budget", ROOT, "/vault/money/plan.md")).toBe("/vault/money/Budget.md");
  });
  test("names with a slash are workspace-relative", () => {
    expect(newPagePath("ideas/Budget", ROOT, "/vault/money/plan.md")).toBe(
      "/vault/ideas/Budget.md",
    );
  });
  test("a note outside the workspace sends new pages to the root", () => {
    expect(newPagePath("Budget", ROOT, "/elsewhere/plan.md")).toBe("/vault/Budget.md");
    expect(newPagePath("Budget", ROOT, null)).toBe("/vault/Budget.md");
  });
});

describe("newPagePath for daily notes", () => {
  test("a bare date lands in the daily-note folder, not beside the note", () => {
    expect(newPagePath("2026-10-08", ROOT, "/vault/money/plan.md", "Journal/Daily")).toBe(
      "/vault/Journal/Daily/2026-10-08.md",
    );
  });
  test("an empty folder means the workspace root", () => {
    expect(newPagePath("2026-10-08", ROOT, "/vault/money/plan.md", "")).toBe(
      "/vault/2026-10-08.md",
    );
  });
  test("an escaping folder falls back to the ordinary rule", () => {
    expect(newPagePath("2026-10-08", ROOT, "/vault/money/plan.md", "../out")).toBe(
      "/vault/money/2026-10-08.md",
    );
  });
  test("non-date names and callers without the setting are unchanged", () => {
    expect(newPagePath("Budget", ROOT, "/vault/money/plan.md", "Journal")).toBe(
      "/vault/money/Budget.md",
    );
    expect(newPagePath("2026-10-08", ROOT, "/vault/money/plan.md")).toBe(
      "/vault/money/2026-10-08.md",
    );
  });
});

describe("ensureWikiPage", () => {
  test("creates a missing page, empty: its file name is its title", async () => {
    const { files, deps } = fakeFs();
    const path = await ensureWikiPage("Budget", ROOT, "/vault/plan.md", deps);
    expect(path).toBe("/vault/Budget.md");
    expect(files.get("/vault/Budget.md")).toBe("");
  });

  test("an existing page anywhere in the workspace is reused, not recreated", async () => {
    const { deps } = fakeFs(["/vault/deep/Budget.md"]);
    const path = await ensureWikiPage("Budget", ROOT, "/vault/plan.md", deps);
    expect(path).toBe("/vault/deep/Budget.md");
    expect(deps.createFile).not.toHaveBeenCalled();
  });

  test("concurrent calls create the page once", async () => {
    const { deps } = fakeFs();
    const [a, b] = await Promise.all([
      ensureWikiPage("Budget", ROOT, "/vault/plan.md", deps),
      ensureWikiPage("Budget", ROOT, "/vault/plan.md", deps),
    ]);
    expect(a).toBe(b);
    expect(deps.createFile).toHaveBeenCalledTimes(1);
  });

  test("creates nothing for links that name no page", async () => {
    const { deps } = fakeFs();
    expect(await ensureWikiPage("photo.png", ROOT, null, deps)).toBeNull();
    expect(deps.createFile).not.toHaveBeenCalled();
  });
});

describe("pageFromSelection", () => {
  test("first line is the title, the rest the body", () => {
    expect(pageFromSelection("\nGrocery list\n- eggs\n- milk")).toEqual({
      title: "Grocery list",
      body: "- eggs\n- milk",
    });
  });

  test("strips markdown from the title and makes it file-safe", () => {
    expect(pageFromSelection("## **Plan**: Q3/Q4")?.title).toBe("Plan Q3 Q4");
    expect(pageFromSelection("- [ ] Call [[Mom|mum]]")?.title).toBe("Call mum");
    expect(pageFromSelection("> [site](https://x.y) notes")?.title).toBe("site notes");
  });

  test("no title, no page", () => {
    expect(pageFromSelection("   \n\n")).toBeNull();
    expect(pageFromSelection("***")).toBeNull();
  });
});

test("newPageContent holds only the moved text, without leading blank lines", () => {
  expect(newPageContent("\n\nstep one\n")).toBe("step one\n");
  expect(newPageContent("  \n")).toBe("");
});

describe("findWikiPage", () => {
  test("finds a page by name anywhere in the workspace", async () => {
    const { deps } = fakeFs(["/vault/deep/预算计划.md"]);
    expect(await findWikiPage("预算计划", ROOT, "/vault/a.md", deps)).toBe(
      "/vault/deep/预算计划.md",
    );
  });

  test("falls back to the page beside the current note when the name is ambiguous", async () => {
    const { deps } = fakeFs(["/vault/x/Plan.md", "/vault/y/Plan.md"]);
    expect(await findWikiPage("Plan", ROOT, "/vault/y/note.md", deps)).toBe("/vault/y/Plan.md");
  });

  test("null when there is no such page", async () => {
    const { deps } = fakeFs(["/vault/Other.md"]);
    expect(await findWikiPage("Plan", ROOT, "/vault/a.md", deps)).toBeNull();
  });
});

describe("appendPageBody", () => {
  test("adds the text as a new block at the end", () => {
    expect(appendPageBody("# Plan\n\nstep one\n\n\n", "\nstep two\nstep three\n")).toBe(
      "# Plan\n\nstep one\n\nstep two\nstep three\n",
    );
  });

  test("an empty page becomes the text; empty text changes nothing", () => {
    expect(appendPageBody("", "hello")).toBe("hello\n");
    expect(appendPageBody("# Plan\n", "  \n")).toBe("# Plan\n");
  });
});

test("Chinese titles pass through untouched", () => {
  expect(pageFromSelection("## 中文标题：测试\n内容")).toEqual({
    title: "中文标题：测试",
    body: "内容",
  });
});

describe("textMovedToPage", () => {
  const selection = "预算计划\n第一步\n第二步";

  test("into the page its first line names, the first line is the title and stays behind", () => {
    expect(textMovedToPage(selection, "预算计划")).toBe("第一步\n第二步");
  });

  test("into any other page, everything moves", () => {
    expect(textMovedToPage(selection, "主场")).toBe(selection);
  });
});

test("safePageName keeps any script and drops unsafe characters", () => {
  expect(safePageName("  主场 / 2026:plan  ")).toBe("主场 2026 plan");
  expect(safePageName("...hidden")).toBe("hidden");
});
