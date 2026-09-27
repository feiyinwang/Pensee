import { describe, expect, test, vi } from "vite-plus/test";
import {
  ensureWikiPage,
  freePagePath,
  newPageContent,
  newPagePath,
  pageFromSelection,
  pageNameFromWikiTarget,
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
      files.set(path, "# ");
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

describe("ensureWikiPage", () => {
  test("creates a missing page with its name as the title", async () => {
    const { files, deps } = fakeFs();
    const path = await ensureWikiPage("Budget", ROOT, "/vault/plan.md", deps);
    expect(path).toBe("/vault/Budget.md");
    expect(files.get("/vault/Budget.md")).toBe("# Budget\n");
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

test("newPageContent puts the title first and drops leading blank lines", () => {
  expect(newPageContent("Plan", "\n\nstep one\n")).toBe("# Plan\n\nstep one\n");
  expect(newPageContent("Plan")).toBe("# Plan\n");
});

test("freePagePath never reuses an existing name", async () => {
  const exists = async (p: string) => p === "/vault/Plan.md" || p === "/vault/Plan 2.md";
  expect(await freePagePath("/vault", "Plan", exists)).toBe("/vault/Plan 3.md");
});
