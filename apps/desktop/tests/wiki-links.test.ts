import { describe, expect, test, vi } from "vite-plus/test";
import {
  HTML_EMBED_DEFAULT_HEIGHT,
  HTML_EMBED_MAX_HEIGHT,
  HTML_EMBED_MIN_HEIGHT,
  canonicalWikiTarget,
  findWikiLinkAt,
  normalizeWikiTarget,
  parseWikiHtmlEmbedTarget,
  parseWikiLink,
  parseWikiImageEmbedTarget,
  resolveWikiEmbed,
  resolveWikiLink,
  withWikiEmbedHeight,
} from "../src/lib/wiki-links";
import type { SearchResult } from "../src/types/fs";

// ---------------------------------------------------------------------------
// normalizeWikiTarget
// ---------------------------------------------------------------------------

describe("normalizeWikiTarget", () => {
  test("trims whitespace", () => {
    expect(normalizeWikiTarget("  Roadmap  ")).toBe("Roadmap");
  });

  test("normalizes backslashes to forward slashes", () => {
    expect(normalizeWikiTarget("planning\\Roadmap")).toBe("planning/Roadmap");
  });

  test("strips .md extension", () => {
    expect(normalizeWikiTarget("Roadmap.md")).toBe("Roadmap");
  });

  test("strips .markdown extension", () => {
    expect(normalizeWikiTarget("Roadmap.markdown")).toBe("Roadmap");
  });

  test("strips extension case-insensitively", () => {
    expect(normalizeWikiTarget("Roadmap.MD")).toBe("Roadmap");
    expect(normalizeWikiTarget("Roadmap.Markdown")).toBe("Roadmap");
  });

  test("preserves target without extension", () => {
    expect(normalizeWikiTarget("Roadmap")).toBe("Roadmap");
  });

  test("handles combined normalization", () => {
    expect(normalizeWikiTarget("  planning\\Roadmap.md  ")).toBe("planning/Roadmap");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(normalizeWikiTarget("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseWikiLink
// ---------------------------------------------------------------------------

describe("parseWikiLink", () => {
  test("splits Obsidian aliases from targets", () => {
    expect(parseWikiLink("No prior experience|I have no prior experience")).toMatchObject({
      path: "No prior experience",
      fragment: null,
      alias: "I have no prior experience",
      displayText: "I have no prior experience",
    });
  });

  test("keeps heading and block fragments out of the file path", () => {
    expect(parseWikiLink("Format your notes#^376b9d|second option")).toMatchObject({
      path: "Format your notes",
      fragment: "^376b9d",
      alias: "second option",
      displayText: "second option",
    });
  });

  test("supports same-file fragment links", () => {
    expect(parseWikiLink("#^0f681f|with great power comes great responsibility")).toMatchObject({
      path: "",
      fragment: "^0f681f",
      alias: "with great power comes great responsibility",
      displayText: "with great power comes great responsibility",
    });
  });

  test("treats table-escaped pipes as Obsidian alias separators", () => {
    expect(parseWikiLink("Format your notes\\|Formatting")).toMatchObject({
      path: "Format your notes",
      alias: "Formatting",
      displayText: "Formatting",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveWikiLink
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SearchResult> & { path: string }): SearchResult {
  const path = overrides.path;
  const filename = overrides.filename ?? path.split("/").pop()!;
  return {
    path,
    filename,
    relative_path: overrides.relative_path ?? filename,
    score: overrides.score ?? 100,
    match_indices: overrides.match_indices ?? [],
  };
}

describe("resolveWikiLink", () => {
  test("resolves unique stem to internal path", async () => {
    const fuzzySearch = vi
      .fn()
      .mockResolvedValue([makeResult({ path: "/vault/Roadmap.md", relative_path: "Roadmap.md" })]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("Roadmap", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "internal", path: "/vault/Roadmap.md" });
    expect(fuzzySearch).toHaveBeenCalledWith("Roadmap", 50);
  });

  test("returns unresolved for ambiguous stem", async () => {
    const fuzzySearch = vi.fn().mockResolvedValue([
      makeResult({
        path: "/vault/planning/Roadmap.md",
        filename: "Roadmap.md",
        relative_path: "planning/Roadmap.md",
      }),
      makeResult({
        path: "/vault/teams/Roadmap.md",
        filename: "Roadmap.md",
        relative_path: "teams/Roadmap.md",
      }),
    ]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("Roadmap", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "unresolved" });
  });

  test("resolves workspace-relative path with slash", async () => {
    const fuzzySearch = vi.fn();
    const fileExists = vi.fn().mockResolvedValue(true);

    const result = await resolveWikiLink("planning/Roadmap", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "internal", path: "/vault/planning/Roadmap.md" });
    expect(fileExists).toHaveBeenCalledWith("/vault/planning/Roadmap.md");
    expect(fuzzySearch).not.toHaveBeenCalled();
  });

  test("resolves workspace-relative paths with spaces and aliases with spaces", async () => {
    const fuzzySearch = vi.fn();
    const fileExists = vi.fn().mockResolvedValue(true);

    const result = await resolveWikiLink(
      "Project Notes/My Note|Label With Spaces",
      "/vault",
      fuzzySearch,
      fileExists,
    );

    expect(result).toEqual({ kind: "internal", path: "/vault/Project Notes/My Note.md" });
    expect(fileExists).toHaveBeenCalledWith("/vault/Project Notes/My Note.md");
    expect(fuzzySearch).not.toHaveBeenCalled();
    expect(parseWikiLink("Project Notes/My Note|Label With Spaces")).toMatchObject({
      path: "Project Notes/My Note",
      displayText: "Label With Spaces",
    });
  });

  test("returns unresolved for missing path target", async () => {
    const fuzzySearch = vi.fn();
    const fileExists = vi.fn().mockResolvedValue(false);

    const result = await resolveWikiLink("planning/Missing", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "unresolved" });
  });

  test("strips .md before resolution", async () => {
    const fuzzySearch = vi
      .fn()
      .mockResolvedValue([makeResult({ path: "/vault/Notes.md", relative_path: "Notes.md" })]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("Notes.md", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "internal", path: "/vault/Notes.md" });
    expect(fuzzySearch).toHaveBeenCalledWith("Notes", 50);
  });

  test("strips .markdown before resolution", async () => {
    const fuzzySearch = vi
      .fn()
      .mockResolvedValue([
        makeResult({ path: "/vault/Notes.md", filename: "Notes.md", relative_path: "Notes.md" }),
      ]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("Notes.markdown", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "internal", path: "/vault/Notes.md" });
  });

  test("returns unresolved for empty target", async () => {
    const fuzzySearch = vi.fn();
    const fileExists = vi.fn();

    const result = await resolveWikiLink("  ", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "unresolved" });
  });

  test("case-insensitive stem matching", async () => {
    const fuzzySearch = vi
      .fn()
      .mockResolvedValue([makeResult({ path: "/vault/Roadmap.md", relative_path: "Roadmap.md" })]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("roadmap", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "internal", path: "/vault/Roadmap.md" });
  });

  test("returns unresolved when no results match stem", async () => {
    const fuzzySearch = vi
      .fn()
      .mockResolvedValue([
        makeResult({ path: "/vault/SomeOther.md", relative_path: "SomeOther.md" }),
      ]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink("Missing", "/vault", fuzzySearch, fileExists);
    expect(result).toEqual({ kind: "unresolved" });
  });

  test("resolves piped links by target instead of alias text", async () => {
    const fuzzySearch = vi.fn().mockResolvedValue([
      makeResult({
        path: "/vault/Adventurer/No prior experience.md",
        relative_path: "Adventurer/No prior experience.md",
      }),
    ]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink(
      "No prior experience|I have no prior experience",
      "/vault",
      fuzzySearch,
      fileExists,
    );

    expect(result).toEqual({
      kind: "internal",
      path: "/vault/Adventurer/No prior experience.md",
    });
  });

  test("resolves fragments against the target file", async () => {
    const fuzzySearch = vi.fn().mockResolvedValue([
      makeResult({
        path: "/vault/Formatting/Format your notes.md",
        relative_path: "Formatting/Format your notes.md",
      }),
    ]);
    const fileExists = vi.fn();

    const result = await resolveWikiLink(
      "Format your notes#^376b9d|second option",
      "/vault",
      fuzzySearch,
      fileExists,
    );

    expect(result).toEqual({
      kind: "internal",
      path: "/vault/Formatting/Format your notes.md",
    });
  });

  test("resolves same-file fragment links to the current file", async () => {
    const fuzzySearch = vi.fn();
    const fileExists = vi.fn();

    const result = await resolveWikiLink(
      "#^0f681f|with great power comes great responsibility",
      "/vault",
      fuzzySearch,
      fileExists,
      "/vault/Vault is just a local folder.md",
    );

    expect(result).toEqual({
      kind: "internal",
      path: "/vault/Vault is just a local folder.md",
    });
    expect(fuzzySearch).not.toHaveBeenCalled();
  });

  test("keeps duplicate stems unresolved unless the path is qualified", async () => {
    const fuzzySearch = vi.fn().mockResolvedValue([
      makeResult({
        path: "/vault/Formatting/Callout.md",
        filename: "Callout.md",
        relative_path: "Formatting/Callout.md",
      }),
      makeResult({
        path: "/vault/Other/Callout.md",
        filename: "Callout.md",
        relative_path: "Other/Callout.md",
      }),
    ]);
    const fileExists = vi.fn().mockResolvedValue(false);

    const result = await resolveWikiLink("Callout", "/vault", fuzzySearch, fileExists);

    expect(result).toEqual({ kind: "unresolved" });
  });
});

// ---------------------------------------------------------------------------
// canonicalWikiTarget
// ---------------------------------------------------------------------------

describe("canonicalWikiTarget", () => {
  test("returns bare stem for unique filename", () => {
    const file = makeResult({ path: "/vault/Roadmap.md", relative_path: "Roadmap.md" });
    const allFiles = [file, makeResult({ path: "/vault/Notes.md", relative_path: "Notes.md" })];

    expect(canonicalWikiTarget(file, allFiles)).toBe("Roadmap");
  });

  test("returns relative path for duplicate stems", () => {
    const file = makeResult({
      path: "/vault/planning/Roadmap.md",
      filename: "Roadmap.md",
      relative_path: "planning/Roadmap.md",
    });
    const allFiles = [
      file,
      makeResult({
        path: "/vault/teams/Roadmap.md",
        filename: "Roadmap.md",
        relative_path: "teams/Roadmap.md",
      }),
    ];

    expect(canonicalWikiTarget(file, allFiles)).toBe("planning/Roadmap");
  });

  test("strips .md from relative path for duplicates", () => {
    const file = makeResult({
      path: "/vault/docs/Guide.md",
      filename: "Guide.md",
      relative_path: "docs/Guide.md",
    });
    const allFiles = [
      file,
      makeResult({
        path: "/vault/archive/Guide.md",
        filename: "Guide.md",
        relative_path: "archive/Guide.md",
      }),
    ];

    expect(canonicalWikiTarget(file, allFiles)).toBe("docs/Guide");
  });

  test("preserves spaces and casing in stem", () => {
    const file = makeResult({
      path: "/vault/Art direction ideas.md",
      filename: "Art direction ideas.md",
      relative_path: "Art direction ideas.md",
    });
    const allFiles = [file];

    expect(canonicalWikiTarget(file, allFiles)).toBe("Art direction ideas");
  });

  test("case-insensitive duplicate detection", () => {
    const file = makeResult({
      path: "/vault/a/Notes.md",
      filename: "Notes.md",
      relative_path: "a/Notes.md",
    });
    const allFiles = [
      file,
      makeResult({
        path: "/vault/b/notes.md",
        filename: "notes.md",
        relative_path: "b/notes.md",
      }),
    ];

    expect(canonicalWikiTarget(file, allFiles)).toBe("a/Notes");
  });
});

// ---------------------------------------------------------------------------
// parseWikiImageEmbedTarget
// ---------------------------------------------------------------------------

describe("parseWikiImageEmbedTarget", () => {
  test("accepts supported image extensions case-insensitively", () => {
    expect(parseWikiImageEmbedTarget("diagram.png")).toBe("diagram.png");
    expect(parseWikiImageEmbedTarget("Photo.JPEG")).toBe("Photo.JPEG");
    expect(parseWikiImageEmbedTarget("anim.gif")).toBe("anim.gif");
    expect(parseWikiImageEmbedTarget("icon.svg")).toBe("icon.svg");
  });

  test("normalizes slashes and strips leading slash", () => {
    expect(parseWikiImageEmbedTarget("assets\\pic.png")).toBe("assets/pic.png");
    expect(parseWikiImageEmbedTarget("/assets/pic.png")).toBe("assets/pic.png");
  });

  test("ignores alias and size modifiers after a pipe", () => {
    expect(parseWikiImageEmbedTarget("pic.png|400")).toBe("pic.png");
    expect(parseWikiImageEmbedTarget("pic.png|alt text")).toBe("pic.png");
  });

  test("rejects non-image targets", () => {
    expect(parseWikiImageEmbedTarget("Some Note")).toBeNull();
    expect(parseWikiImageEmbedTarget("Some Note.md")).toBeNull();
    expect(parseWikiImageEmbedTarget("report.pdf")).toBeNull();
    expect(parseWikiImageEmbedTarget(".png")).toBeNull();
    expect(parseWikiImageEmbedTarget("dot.")).toBeNull();
    expect(parseWikiImageEmbedTarget("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWikiEmbed
// ---------------------------------------------------------------------------

describe("resolveWikiEmbed", () => {
  const noFind = vi.fn(async () => null);

  test("resolves path targets workspace-relative first", async () => {
    const fileExists = vi.fn(async (p: string) => p === "/vault/assets/pic.png");
    const result = await resolveWikiEmbed(
      "assets/pic.png",
      "/vault",
      "/vault/notes/note.md",
      fileExists,
      noFind,
    );
    expect(result).toBe("/vault/assets/pic.png");
  });

  test("falls back to note-relative for path targets", async () => {
    const fileExists = vi.fn(async (p: string) => p === "/vault/notes/assets/pic.png");
    const result = await resolveWikiEmbed(
      "assets/pic.png",
      "/vault",
      "/vault/notes/note.md",
      fileExists,
      noFind,
    );
    expect(result).toBe("/vault/notes/assets/pic.png");
  });

  test("probes note dir first for bare basenames", async () => {
    const fileExists = vi.fn(async (p: string) => p === "/vault/notes/pic.png");
    const result = await resolveWikiEmbed(
      "pic.png",
      "/vault",
      "/vault/notes/note.md",
      fileExists,
      noFind,
    );
    expect(result).toBe("/vault/notes/pic.png");
    expect(noFind).not.toHaveBeenCalled();
  });

  test("falls back to workspace basename search for bare names", async () => {
    const fileExists = vi.fn(async () => false);
    const findFileByName = vi.fn(async (root: string, name: string) =>
      root === "/vault" && name === "pic.png" ? "/vault/deep/attachments/pic.png" : null,
    );
    const result = await resolveWikiEmbed(
      "pic.png",
      "/vault",
      "/vault/notes/note.md",
      fileExists,
      findFileByName,
    );
    expect(result).toBe("/vault/deep/attachments/pic.png");
  });

  test("does not basename-search for path targets", async () => {
    const fileExists = vi.fn(async () => false);
    const findFileByName = vi.fn(async () => "/vault/wrong.png");
    const result = await resolveWikiEmbed(
      "assets/pic.png",
      "/vault",
      null,
      fileExists,
      findFileByName,
    );
    expect(result).toBeNull();
    expect(findFileByName).not.toHaveBeenCalled();
  });

  test("resolves note-relative without a workspace (compact mode)", async () => {
    const fileExists = vi.fn(async (p: string) => p === "/anywhere/pic.png");
    const result = await resolveWikiEmbed("pic.png", null, "/anywhere/note.md", fileExists, noFind);
    expect(result).toBe("/anywhere/pic.png");
    expect(noFind).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTML embeds (SPECs/html-file-embed-spec.md)
// ---------------------------------------------------------------------------

describe("parseWikiHtmlEmbedTarget", () => {
  test("accepts .html and .htm case-insensitively with the default height", () => {
    expect(parseWikiHtmlEmbedTarget("demo.html")).toEqual({
      path: "demo.html",
      height: HTML_EMBED_DEFAULT_HEIGHT,
      explicitHeight: false,
    });
    expect(parseWikiHtmlEmbedTarget("Report.HTM")?.path).toBe("Report.HTM");
  });

  test("normalizes slashes and strips a leading slash", () => {
    expect(parseWikiHtmlEmbedTarget("assets\\demo.html")?.path).toBe("assets/demo.html");
    expect(parseWikiHtmlEmbedTarget("/assets/demo.html")?.path).toBe("assets/demo.html");
  });

  test("reads an integer height modifier and clamps it", () => {
    expect(parseWikiHtmlEmbedTarget("demo.html|600")).toEqual({
      path: "demo.html",
      height: 600,
      explicitHeight: true,
    });
    expect(parseWikiHtmlEmbedTarget("demo.html| 480 ")?.height).toBe(480);
    expect(parseWikiHtmlEmbedTarget("demo.html|10")?.height).toBe(HTML_EMBED_MIN_HEIGHT);
    expect(parseWikiHtmlEmbedTarget("demo.html|99999")?.height).toBe(HTML_EMBED_MAX_HEIGHT);
  });

  test("ignores non-numeric modifiers and extra segments", () => {
    expect(parseWikiHtmlEmbedTarget("demo.html|abc")).toEqual({
      path: "demo.html",
      height: HTML_EMBED_DEFAULT_HEIGHT,
      explicitHeight: false,
    });
    expect(parseWikiHtmlEmbedTarget("demo.html|600|caption")?.height).toBe(600);
  });

  test("rejects non-HTML targets", () => {
    expect(parseWikiHtmlEmbedTarget("Some Note")).toBeNull();
    expect(parseWikiHtmlEmbedTarget("pic.png")).toBeNull();
    expect(parseWikiHtmlEmbedTarget("report.pdf")).toBeNull();
    expect(parseWikiHtmlEmbedTarget(".html")).toBeNull();
    expect(parseWikiHtmlEmbedTarget("")).toBeNull();
  });
});

describe("withWikiEmbedHeight", () => {
  test("adds a modifier to a bare target", () => {
    expect(withWikiEmbedHeight("assets/demo.html", 620)).toBe("assets/demo.html|620");
  });

  test("replaces an existing modifier and keeps the target text verbatim", () => {
    expect(withWikiEmbedHeight("/Assets\\demo.html|400", 512.4)).toBe("/Assets\\demo.html|512");
    expect(withWikiEmbedHeight("demo.html|400|caption", 300)).toBe("demo.html|300");
  });
});

describe("findWikiLinkAt", () => {
  const doc = {
    lineAt: () => ({ from: 100, text: "see ![[a.html]][[Note]] end" }),
  };

  test("returns the token spanning pos with its embed flag", () => {
    expect(findWikiLinkAt(doc, 106)).toEqual({ from: 104, to: 115, embed: true, inner: "a.html" });
    expect(findWikiLinkAt(doc, 118)).toEqual({ from: 115, to: 123, embed: false, inner: "Note" });
  });

  test("prefers the token starting exactly at pos when two touch", () => {
    expect(findWikiLinkAt(doc, 115)?.inner).toBe("Note");
  });

  test("returns null outside any token", () => {
    expect(findWikiLinkAt(doc, 101)).toBeNull();
    expect(findWikiLinkAt(doc, 125)).toBeNull();
  });
});
