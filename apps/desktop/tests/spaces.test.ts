import { describe, expect, test } from "vite-plus/test";
import {
  BUILT_IN_SPACES,
  allTypes,
  builtInSpace,
  bylineOf,
  coverKindForType,
  notesInTab,
  spaceFileStem,
  spaceFromNote,
  splitTypes,
  titleHash,
} from "../src/lib/spaces";
import type { TypedNote } from "../src/lib/tauri";

function note(partial: Partial<TypedNote> & { note_type: string }): TypedNote {
  return {
    path: `/vault/${partial.name ?? "Note"}.md`,
    relative_path: `${partial.name ?? "Note"}.md`,
    name: "Note",
    title: null,
    modified_at: 0,
    properties: {},
    excerpt: null,
    ...partial,
  };
}

describe("built-in spaces", () => {
  test("Library tabs cover the media types and X bookmarks, Books first", () => {
    const library = builtInSpace("library")!;
    expect(library.tabs.map((t) => t.label)).toEqual([
      "Books",
      "Videos",
      "Courses",
      "Podcasts",
      "Papers",
      "Bookmarks",
    ]);
    expect(allTypes(library)).toContain("YouTube");
    expect(library.tabs.at(-1)).toMatchObject({ types: ["Tweet"], cover: "tweet", source: "x" });
  });

  test("Files has no types and the files view", () => {
    const files = builtInSpace("files")!;
    expect(files.view).toBe("files");
    expect(allTypes(files)).toEqual([]);
  });

  test("keys are unique", () => {
    const keys = BUILT_IN_SPACES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("notesInTab", () => {
  test("matches types case-insensitively, any alias of the tab", () => {
    const videos = builtInSpace("library")!.tabs.find((t) => t.id === "videos")!;
    const notes = [
      note({ name: "a", note_type: "youtube" }),
      note({ name: "b", note_type: "Video" }),
      note({ name: "c", note_type: "Book" }),
    ];
    expect(notesInTab(notes, videos).map((n) => n.name)).toEqual(["a", "b"]);
  });
});

describe("space notes", () => {
  test("reads Shows and View", () => {
    const space = spaceFromNote(
      note({
        name: "Recipes",
        note_type: "Space",
        properties: { shows: "Recipe, Dish", view: "List" },
      }),
    );
    expect(space.key).toBe("note:/vault/Recipes.md");
    expect(space.view).toBe("list");
    expect(space.tabs[0].types).toEqual(["Recipe", "Dish"]);
    expect(space.tabs[0].noun).toBe("recipe");
  });

  test("falls back to the note's name and the gallery view", () => {
    const space = spaceFromNote(
      note({ name: "Book club", note_type: "Space", properties: { view: "wall" } }),
    );
    expect(space.view).toBe("gallery");
    expect(space.tabs[0].types).toEqual(["Book club"]);
  });

  test("a book space draws book covers", () => {
    const space = spaceFromNote(
      note({ name: "Fiction", note_type: "Space", properties: { shows: "Book" } }),
    );
    expect(space.tabs[0].cover).toBe("book");
  });

  test("file stem drops characters a file name can't hold", () => {
    expect(spaceFileStem("  Reading / list: 2026 ")).toBe("Reading list 2026");
    expect(spaceFileStem(" / ")).toBeNull();
  });
});

describe("helpers", () => {
  test("cover kinds by type", () => {
    expect(coverKindForType("YouTube")).toBe("video");
    expect(coverKindForType("Paper")).toBe("paper");
    expect(coverKindForType("Recipe")).toBe("note");
  });

  test("splitTypes trims and drops blanks", () => {
    expect(splitTypes(" Book, ,Paper ")).toEqual(["Book", "Paper"]);
    expect(splitTypes(undefined)).toEqual([]);
  });

  test("titleHash is stable", () => {
    expect(titleHash("Skip the line")).toBe(titleHash("Skip the line"));
    expect(titleHash("Skip the line")).not.toBe(titleHash("Thinking in Systems"));
  });

  test("byline prefers author, then channel or host", () => {
    expect(bylineOf(note({ note_type: "Book", properties: { author: "A" } }))).toBe("A");
    expect(bylineOf(note({ note_type: "YouTube", properties: { channel: "C" } }))).toBe("C");
    expect(bylineOf(note({ note_type: "Paper" }))).toBeNull();
  });
});
