import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/menu/menu", () => ({ Menu: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/predefinedMenuItem", () => ({
  PredefinedMenuItem: { new: vi.fn() },
}));
vi.mock("@tauri-apps/api/menu/menuItem", () => ({ MenuItem: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/submenu", () => ({ Submenu: { new: vi.fn() } }));

import {
  buildEditorBodyMenuItemsSpec,
  buildTabMenuItemsSpec,
  buildTitleMenuItemsSpec,
  type EditorBodyMenuHandlers,
  type TabMenuHandlers,
  type TitleMenuHandlers,
} from "../src/components/editor-area/editor-context-menu";

function makeBodyHandlers(): EditorBodyMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onCut: () => calls.push("cut"),
    onCopy: () => calls.push("copy"),
    onPaste: () => calls.push("paste"),
    onSelectAll: () => calls.push("select-all"),
    onOpenLink: () => calls.push("open-link"),
    onCopyLink: () => calls.push("copy-link"),
  };
}

function makeTabHandlers(): TabMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onClose: () => calls.push("close"),
    onRename: () => calls.push("rename"),
    onDelete: () => calls.push("delete"),
    onCloseOthers: () => calls.push("close-others"),
    onCloseAll: () => calls.push("close-all"),
    onRevealInSidebar: () => calls.push("reveal-in-sidebar"),
    onCopyPath: () => calls.push("copy-path"),
  };
}

function makeTitleHandlers(): TitleMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onRename: () => calls.push("rename"),
    onReveal: () => calls.push("reveal"),
    onCopyPath: () => calls.push("copy-path"),
  };
}

describe("buildEditorBodyMenuItemsSpec", () => {
  test("emits base items without link actions when hasLink is false", () => {
    const spec = buildEditorBodyMenuItemsSpec(makeBodyHandlers(), false);
    const summary = spec.map((e) =>
      e.kind === "separator" ? "---" : e.kind === "submenu" ? `[${e.text}]` : e.id,
    );
    expect(summary).toEqual(["cut", "copy", "paste", "---", "select-all"]);
  });

  test("appends link actions when hasLink is true", () => {
    const spec = buildEditorBodyMenuItemsSpec(makeBodyHandlers(), true);
    const summary = spec.map((e) =>
      e.kind === "separator" ? "---" : e.kind === "submenu" ? `[${e.text}]` : e.id,
    );
    expect(summary).toEqual([
      "cut",
      "copy",
      "paste",
      "---",
      "select-all",
      "---",
      "open-link",
      "copy-link",
    ]);
  });

  test("each item invokes the matching handler", () => {
    const handlers = makeBodyHandlers();
    const spec = buildEditorBodyMenuItemsSpec(handlers, true);
    for (const entry of spec) {
      if (entry.kind === "item") entry.action();
    }
    expect(handlers.calls).toEqual([
      "cut",
      "copy",
      "paste",
      "select-all",
      "open-link",
      "copy-link",
    ]);
  });

  test("no submenus when onRunCommand is not provided", () => {
    const spec = buildEditorBodyMenuItemsSpec(makeBodyHandlers(), false);
    const submenus = spec.filter((e) => e.kind === "submenu");
    expect(submenus).toHaveLength(0);
  });

  test("includes Format, Paragraph, Insert submenus when onRunCommand is provided", () => {
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = () => {};
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const topLevel = spec
      .filter((e) => e.kind !== "separator")
      .map((e) => (e.kind === "submenu" ? `[${e.text}]` : e.id));
    expect(topLevel).toEqual([
      "cut",
      "copy",
      "paste",
      "[Format]",
      "[Paragraph]",
      "[Insert]",
      "select-all",
    ]);
  });

  test("Format submenu contains expected items", () => {
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = () => {};
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const formatSubmenu = spec.find((e) => e.kind === "submenu" && e.text === "Format");
    expect(formatSubmenu).toBeDefined();
    if (formatSubmenu?.kind !== "submenu") throw new Error("expected submenu");
    const items = formatSubmenu.items.filter((e) => e.kind === "item").map((e) => e.id);
    expect(items).toContain("fmt.bold");
    expect(items).toContain("fmt.italic");
    expect(items).toContain("fmt.strikethrough");
    expect(items).toContain("fmt.code");
    expect(items).toContain("fmt.link");
    expect(items).toContain("fmt.clear");
  });

  test("Paragraph submenu contains heading and list items", () => {
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = () => {};
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const paraSubmenu = spec.find((e) => e.kind === "submenu" && e.text === "Paragraph");
    expect(paraSubmenu).toBeDefined();
    if (paraSubmenu?.kind !== "submenu") throw new Error("expected submenu");
    const items = paraSubmenu.items.filter((e) => e.kind === "item").map((e) => e.id);
    expect(items).toContain("para.h1");
    expect(items).toContain("para.h6");
    expect(items).toContain("para.bullet");
    expect(items).toContain("para.numbered");
    expect(items).toContain("para.task");
    expect(items).toContain("para.blockquote");
    expect(items).toContain("para.codeblock");
  });

  test("Insert submenu contains expected items", () => {
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = () => {};
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const insertSubmenu = spec.find((e) => e.kind === "submenu" && e.text === "Insert");
    expect(insertSubmenu).toBeDefined();
    if (insertSubmenu?.kind !== "submenu") throw new Error("expected submenu");
    const items = insertSubmenu.items.filter((e) => e.kind === "item").map((e) => e.id);
    expect(items).toContain("ins.link");
    expect(items).toContain("ins.table");
    expect(items).toContain("ins.hr");
    expect(items).toContain("ins.date");
    expect(items).toContain("ins.time");
  });

  test("submenu items have accelerator strings", () => {
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = () => {};
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const formatSubmenu = spec.find((e) => e.kind === "submenu" && e.text === "Format");
    if (formatSubmenu?.kind !== "submenu") throw new Error("expected submenu");
    const bold = formatSubmenu.items.find((e) => e.kind === "item" && e.id === "fmt.bold");
    expect(bold && bold.kind === "item" ? bold.accelerator : undefined).toBe("CmdOrCtrl+B");
  });

  test("onRunCommand callback is invoked with correct id", () => {
    const calls: string[] = [];
    const handlers = makeBodyHandlers();
    handlers.onRunCommand = (id: string) => calls.push(id);
    const spec = buildEditorBodyMenuItemsSpec(handlers, false);
    const formatSubmenu = spec.find((e) => e.kind === "submenu" && e.text === "Format");
    if (formatSubmenu?.kind !== "submenu") throw new Error("expected submenu");
    const bold = formatSubmenu.items.find((e) => e.kind === "item" && e.id === "fmt.bold");
    if (bold?.kind === "item") bold.action();
    expect(calls).toEqual(["format.bold"]);
  });
});

describe("buildTabMenuItemsSpec", () => {
  test("emits items in the spec order with separator", () => {
    const spec = buildTabMenuItemsSpec(makeTabHandlers());
    const summary = spec.map((e) => (e.kind === "separator" ? "---" : `${e.id}:${e.text}`));
    expect(summary).toEqual([
      "close:Close",
      "close-others:Close others",
      "close-all:Close all",
      "---",
      "reveal-in-sidebar:Show in Files",
      "copy-path:Copy path",
      "---",
      "rename:Rename",
      "delete:Delete",
    ]);
  });

  test("each item invokes the matching handler", () => {
    const handlers = makeTabHandlers();
    const spec = buildTabMenuItemsSpec(handlers);
    for (const entry of spec) {
      if (entry.kind === "item") entry.action();
    }
    expect(handlers.calls).toEqual([
      "close",
      "close-others",
      "close-all",
      "reveal-in-sidebar",
      "copy-path",
      "rename",
      "delete",
    ]);
  });
});

describe("buildTitleMenuItemsSpec", () => {
  test("uses platform-specific reveal label", () => {
    const macSpec = buildTitleMenuItemsSpec(makeTitleHandlers(), "macos");
    const reveal = macSpec.find((e) => e.kind === "item" && e.id === "reveal");
    expect(reveal && reveal.kind === "item" ? reveal.text : null).toBe("Reveal in Finder");

    const winSpec = buildTitleMenuItemsSpec(makeTitleHandlers(), "windows");
    const winReveal = winSpec.find((e) => e.kind === "item" && e.id === "reveal");
    expect(winReveal && winReveal.kind === "item" ? winReveal.text : null).toBe(
      "Reveal in Explorer",
    );
  });

  test("each item invokes the matching handler", () => {
    const handlers = makeTitleHandlers();
    const spec = buildTitleMenuItemsSpec(handlers, "linux");
    for (const entry of spec) {
      if (entry.kind === "item") entry.action();
    }
    expect(handlers.calls).toEqual(["rename", "reveal", "copy-path"]);
  });

  test("Add to Projects shows only with its handler, after Move selection to page", () => {
    const handlers = makeBodyHandlers();
    handlers.onMoveToPage = () => handlers.calls.push("move-to-page");
    handlers.onAddToProjects = () => handlers.calls.push("add-to-projects");
    const ids = buildEditorBodyMenuItemsSpec(handlers, false).map((e) =>
      e.kind === "item" ? e.id : e.kind,
    );
    expect(ids.slice(ids.indexOf("move-to-page"), ids.indexOf("move-to-page") + 2)).toEqual([
      "move-to-page",
      "add-to-projects",
    ]);
    const alone = makeBodyHandlers();
    alone.onAddToProjects = () => {};
    const aloneIds = buildEditorBodyMenuItemsSpec(alone, false).map((e) =>
      e.kind === "item" ? e.id : e.kind,
    );
    expect(aloneIds).toEqual([
      "cut",
      "copy",
      "paste",
      "separator",
      "add-to-projects",
      "separator",
      "select-all",
    ]);
    expect(
      buildEditorBodyMenuItemsSpec(makeBodyHandlers(), false).some(
        (e) => e.kind === "item" && e.id === "add-to-projects",
      ),
    ).toBe(false);
  });

  describe("block reference items", () => {
    test("shown with their shortcuts when the editor offers them", () => {
      const handlers = {
        ...makeBodyHandlers(),
        onCopyBlockReference: () => {},
        onPasteBlockReference: () => {},
      };
      const spec = buildEditorBodyMenuItemsSpec(handlers, false);
      const items = spec.flatMap((e) => (e.kind === "item" ? [[e.id, e.accelerator]] : []));
      expect(items).toContainEqual(["copy-block-reference", "CmdOrCtrl+Shift+C"]);
      expect(items).toContainEqual(["paste-block-reference", "CmdOrCtrl+Shift+V"]);
    });
    test("absent otherwise", () => {
      const spec = buildEditorBodyMenuItemsSpec(makeBodyHandlers(), false);
      expect(spec.some((e) => e.kind === "item" && e.id === "copy-block-reference")).toBe(false);
    });
  });
});
