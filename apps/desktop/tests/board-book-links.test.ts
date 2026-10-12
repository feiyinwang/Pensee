import { describe, expect, test, vi } from "vite-plus/test";

// The page a highlight lives on, edited in memory instead of the editor/disk.
const pages = new Map<string, string>();
vi.mock("../src/components/editor-area/linked-block-sync", () => ({
  editPage: async (
    path: string,
    edit: (p: { frontmatter: null; body: string }) => { body: string },
  ) => {
    pages.set(path, edit({ frontmatter: null, body: pages.get(path) ?? "" }).body);
  },
}));
vi.mock("../src/components/editor-area/wiki-pages-extension", () => ({ tauriWikiPageDeps: {} }));
vi.mock("../src/components/editor-area/editor-notice-store", () => ({
  showEditorNotice: () => {},
}));
vi.mock("../src/hooks/workspace-api", () => ({ getWorkspaceRoot: () => "/v" }));
vi.mock("../src/lib/wiki-pages", () => ({
  findWikiPage: async (name: string) => `/v/${name}.md`,
}));

const { bookLinkSync, bookLinkTarget, parseBookLink } =
  await import("../src/components/editor-area/board/board-book-links");
const { emptyScene, parseBoard, serializeBoard } =
  await import("../src/components/editor-area/board/board-model");
const { shapeLabel } = await import("../src/components/editor-area/board/board-render");
type ShapeEl = import("../src/components/editor-area/board/board-model").ShapeEl;

const location = { unit: "p" as const, section: 12, start: 3, end: 40 };
const LINK = "Skip the Line#^bk-p12-3-40";

const card = (id: string, text = "To live in the world"): ShapeEl => ({
  id,
  t: "rect",
  x: 0,
  y: 0,
  w: 240,
  h: 110,
  a: 0,
  op: 1,
  st: { s: "blue", f: "blue-soft", w: 1.5, d: "solid", r: 8 },
  lb: { tx: text, sz: 14, al: "c" },
  ln: LINK,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("book links", () => {
  test("name the page and the highlight, and nothing else parses", () => {
    expect(bookLinkTarget("/v/books/Skip the Line.md", location)).toBe(LINK);
    expect(parseBookLink(LINK)).toEqual({ page: "Skip the Line", id: "bk-p12-3-40" });
    expect(parseBookLink("Skip the Line#Heading")).toBeNull();
    expect(parseBookLink("Page#^abc123")).toBeNull();
  });

  test("a linked rectangle keeps its link through the file", () => {
    const scene = { ...emptyScene(), els: [card("a")] };
    const back = parseBoard(serializeBoard(scene)).scene.els[0] as ShapeEl;
    expect(back.ln).toBe(LINK);
  });

  test("its whole label is the link, whatever the text says", () => {
    const lines = shapeLabel(card("a", "Edited, **with** emphasis"))!.lines;
    expect(lines.flat().every((run) => run.ln === LINK)).toBe(true);
  });
});

describe("bookLinkSync", () => {
  const PAGE = "/v/Skip the Line.md";
  const bullet = "- To live in the world ^bk-p12-3-40\n";

  test("deleting the last rectangle removes the highlight; undo puts it back", async () => {
    pages.set(PAGE, bullet);
    const start = { ...emptyScene(), els: [card("a"), card("b")] };
    const sync = bookLinkSync(start, "/v/Board note.md");

    // Editing the text keeps it.
    sync.sync({ ...emptyScene(), els: [card("a", "my words"), card("b")] });
    await flush();
    expect(pages.get(PAGE)).toBe(bullet);

    // One of two rectangles gone: another still links to it.
    sync.sync({ ...emptyScene(), els: [card("b")] });
    await flush();
    expect(pages.get(PAGE)).toBe(bullet);

    sync.sync(emptyScene());
    await flush();
    expect(pages.get(PAGE)).toBe("");

    sync.sync({ ...emptyScene(), els: [card("b")] });
    await flush();
    expect(pages.get(PAGE)).toContain("^bk-p12-3-40");
  });
});
