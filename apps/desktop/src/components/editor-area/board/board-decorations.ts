/**
 * CodeMirror integration for boards.
 *
 * A board is now a `.board.svg` image (see `board-file-session.ts`); this file
 * still renders the legacy ```board fence and converts it on Open.
 *
 * The fence is replaced by a **static** preview card. It is deliberately not an
 * interactive canvas: an embedded infinite canvas competes with document scroll
 * and there is no good resolution to that fight. Editing happens in the
 * full-screen overlay.
 *
 * Card height is a fixed token — never derived from width — for the reason
 * recorded in the project notes: ratio-derived heights clip their contents.
 */

import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { foldableSyntaxFacet } from "@/lib/prosemark-core/main";
import { formatMarkdownDestination, getParentDir } from "@/lib/paths";
import { BOARD_FENCE_INFO, type BoardScene, fenceFor, parseBoard, sceneSize } from "./board-model";
import { prefetchBoardChrome, renderStaticBoard } from "./board-canvas";
import { openBoardFullscreen } from "./board-fullscreen";
import {
  boardImageEnhancer,
  createBoardFile,
  editorResolver,
  openBoardFile,
} from "./board-file-session";
import "./board.css";

/** Fixed. See the header note — do not turn this into a ratio of the width. */
export const BOARD_CARD_HEIGHT = 360;
const CARD_VERTICAL_PADDING = 16;

/* ----------------------------------------------------------------- widget */

interface WidgetDeps {
  getFilePath: () => string | null;
}

class BoardWidget extends WidgetType {
  constructor(
    readonly body: string,
    readonly fenceText: string,
    readonly deps: WidgetDeps,
  ) {
    super();
  }

  eq(other: BoardWidget): boolean {
    return this.body === other.body && this.fenceText === other.fenceText;
  }

  get estimatedHeight(): number {
    return BOARD_CARD_HEIGHT + CARD_VERTICAL_PADDING;
  }

  ignoreEvent(): boolean {
    // Must stay false. The card needs clicks, and the block handle needs to be
    // able to target this block — the same constraint the columns widgets have.
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    prefetchBoardChrome();
    const wrapper = document.createElement("div");
    wrapper.className = "wr-board-card-wrap";

    const card = document.createElement("div");
    card.className = "wr-board-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", "Open board");
    card.style.height = `${BOARD_CARD_HEIGHT}px`;
    wrapper.append(card);

    const { scene, badLines } = parseBoard(this.body);
    const notePath = this.deps.getFilePath();

    if (badLines > 0 && scene.els.length === 0) {
      card.classList.add("is-error");
      card.append(
        message("Board data is invalid", `${badLines} line(s) could not be read.`),
        codeButton(view, this),
      );
      return wrapper;
    }

    if (scene.els.length === 0) {
      card.classList.add("is-empty");
      card.append(message("Empty board", "Click to draw"));
    } else {
      const surface = document.createElement("div");
      surface.className = "wr-board-card-surface";
      card.append(surface);
      queueMicrotask(() => {
        const width = surface.clientWidth || 640;
        surface.append(
          renderStaticBoard(scene, width, BOARD_CARD_HEIGHT, editorResolver(noteDir(notePath))),
        );
      });
    }

    if (badLines > 0) {
      card.append(note(`${badLines} element(s) could not be read`));
    }
    const size = sceneSize(scene);
    if (size.overBudget) {
      card.append(note(`${(size.bytes / 1024).toFixed(0)} KB in this note`));
    }

    const actions = document.createElement("div");
    actions.className = "wr-board-card-actions";
    actions.append(
      actionButton("Open", () => open()),
      codeButton(view, this),
    );
    card.append(actions);

    const open = (): void => {
      const path = this.deps.getFilePath();
      if (path) {
        void migrateAndOpen(view, this, scene, path);
        return;
      }
      // An unsaved note has no folder to put a board file in; edit in place.
      openBoardFullscreen({
        scene,
        resolveSrc: editorResolver(null),
        onCommit: (next) => writeBack(view, this, next),
        onFinalCommit: (next) => writeBack(view, this, next),
      });
    };

    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".wr-board-card-actions")) return;
      e.preventDefault();
      open();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      open();
    });

    return wrapper;
  }
}

function message(title: string, detail: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "wr-board-card-message";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = detail;
  box.append(strong, span);
  return box;
}

function note(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "wr-board-card-note";
  el.textContent = text;
  return el;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wr-board-card-action";
  btn.textContent = label;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/**
 * Raw-source escape hatch. A small modal textarea rather than an inline nested
 * editor: the payload is JSON Lines, not markdown, so there is nothing for the
 * prosemark extensions to do — and a modal cannot get tangled up with the
 * fold decoration that is currently replacing this fence.
 */
function codeButton(view: EditorView, widget: BoardWidget): HTMLButtonElement {
  return actionButton("Edit code", () => {
    const overlay = document.createElement("div");
    overlay.className = "wr-board-code-modal";
    const panel = document.createElement("div");
    panel.className = "wr-board-code-panel";
    const area = document.createElement("textarea");
    area.value = widget.body;
    area.spellcheck = false;
    const bar = document.createElement("div");
    bar.className = "wr-board-code-bar";
    const cancel = actionButton("Cancel", () => overlay.remove());
    const save = actionButton("Save", () => {
      replaceFence(view, widget, "```" + BOARD_FENCE_INFO + "\n" + area.value.trim() + "\n```");
      overlay.remove();
    });
    bar.append(cancel, save);
    panel.append(area, bar);
    overlay.append(panel);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") overlay.remove();
    });
    document.body.append(overlay);
    area.focus();
  });
}

function noteDir(path: string | null): string | null {
  return path ? getParentDir(path) : null;
}

/* ------------------------------------------------------------- write back */

/**
 * Legacy fence → `.board.svg`. Runs on Open: writes the file, swaps the fence
 * for an image line (one transaction, so ⌘Z brings the fence back), then edits
 * the file. Fails loudly and leaves the fence untouched if the write fails.
 */
async function migrateAndOpen(
  view: EditorView,
  widget: BoardWidget,
  scene: BoardScene,
  notePath: string,
): Promise<void> {
  try {
    const file = await createBoardFile(notePath, scene, getParentDir(notePath));
    if (!replaceFence(view, widget, `![Board](${formatMarkdownDestination(file.relative)})`)) {
      throw new Error("the board moved while it was being converted");
    }
    await openBoardFile(file.absolute, notePath);
  } catch (error) {
    console.error("[board] could not convert fence", error);
    window.alert(
      `Couldn't convert this board: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeBack(view: EditorView, widget: BoardWidget, scene: BoardScene): void {
  replaceFence(view, widget, fenceFor(scene));
}

/**
 * Replaces the whole fence in one transaction. Locating it by searching for the
 * widget's own fence text keeps the edit correct even when text above has
 * shifted since the widget was built — the same tactic mermaid uses.
 */
function replaceFence(view: EditorView, widget: BoardWidget, next: string): boolean {
  const doc = view.state.doc.toString();
  const at = doc.indexOf(widget.fenceText);
  if (at < 0) return false;
  if (widget.fenceText === next) return true;
  view.dispatch({
    changes: { from: at, to: at + widget.fenceText.length, insert: next },
  });
  return true;
}

/* ------------------------------------------------------------- extension */

/** Same shape as the mermaid reader: walk the fence's children for its info
 *  string and its body. Typed structurally so it does not depend on the lezer
 *  node type surfacing through the facet. */
function parseFencedCode(
  state: { doc: { sliceString: (from: number, to: number) => string } },
  node: {
    node: {
      firstChild: {
        name: string;
        from: number;
        to: number;
        nextSibling: unknown;
      } | null;
    };
  },
): { info: string; source: string } | undefined {
  let info = "";
  let source = "";
  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") info = state.doc.sliceString(child.from, child.to);
    else if (child.name === "CodeText") source += state.doc.sliceString(child.from, child.to);
    child = child.nextSibling as typeof child;
  }
  if (!info) return undefined;
  return { info, source };
}

function boardFoldExtension(deps: WidgetDeps) {
  return foldableSyntaxFacet.of({
    nodePath: "FencedCode",
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node) => {
      const parsed = parseFencedCode(state, node as never);
      if (!parsed) return undefined;
      if (parsed.info.trim().toLowerCase() !== BOARD_FENCE_INFO) return undefined;

      const fenceText = state.doc.sliceString(node.from, node.to);
      const widget = new BoardWidget(parsed.source.trim(), fenceText, deps);
      return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
        node.from,
        node.to,
      );
    },
  });
}

/** Same incremental-parse nudge the mermaid and table decorations need. */
const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function boardDecorations(getFilePath: () => string | null) {
  return [boardFoldExtension({ getFilePath }), foldTreeSync, boardImageEnhancer(getFilePath)];
}
