import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorState, type Extension, Transaction } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  prosemarkBasicSetup,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "@/lib/prosemark-core/main";
import * as tauri from "@/lib/tauri";
import { getFileStem } from "@/lib/paths";
import {
  BLOCK_ID_AT_END_RE,
  blockIdOnLine,
  blockLinkPage,
  blockText,
  findBlock,
  minimalChange,
  newBlockId,
  parseBlockEmbedTarget,
} from "@/lib/block-refs";
import { WIKI_LINK_RE } from "@/lib/wiki-links";
import { findWikiPage } from "@/lib/wiki-pages";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import * as editorApi from "@/hooks/editor-api";
import type { ActionTarget } from "./block-actions";
import { getEffectiveSelectionRanges } from "./drag-selection-gate";
import { showEditorNotice } from "./editor-notice-store";
import { headingDecorations } from "./heading-decorations";
import { imageSrcResolver } from "./image-src-resolver";
import { markdownFormatting } from "./markdown-formatting";
import { wikiLinkExtension } from "./wiki-link-extension";
import {
  blockEmbedHost,
  currentPageText,
  linkedBlockSync,
  liveEditorRegistry,
  loadPageText,
  subscribePage,
  writeBlock,
} from "./linked-block-sync";
import { BacklinkBadge, backlinksField, blockBacklinks } from "./block-backlinks";
import "./block-embed.css";

// `![[Page#^id]]` shows block `id` of Page, live and editable where it is
// embedded; typing there edits Page. Per SPECs/block-embed-spec.md.
//
// Cost model: nothing happens for an embed until CodeMirror draws it (only
// visible ranges are scanned). Drawing one reads its page once — from memory
// when open, else one cached disk read — and builds a small editor holding
// just that block.

const CODE_NODES = new Set(["FencedCode", "InlineCode", "CodeBlock", "CodeText", "HTMLBlock"]);

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(
      pos,
      -1,
    );
    node;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}

/* ------------------------------------------------------------ page lookup */

// Page name → path, per workspace and linking note. Positive-only, like the
// image embed resolver: a miss re-probes next time so a new page shows up.
const pagePaths = new Map<string, string>();

async function resolvePage(
  page: string,
  hostPath: string | null,
  root: string | null,
): Promise<string | null> {
  if (!page) return hostPath;
  if (!root) return null;
  const key = `${root}\0${hostPath ?? ""}\0${page}`;
  const cached = pagePaths.get(key);
  if (cached) return cached;
  const path = await findWikiPage(page, root, hostPath, tauri);
  if (path) pagePaths.set(key, path);
  return path;
}

/* ------------------------------------------------------------ the widget */

function nestedExtensions(path: string, id: string, isDisposed: () => boolean): Extension[] {
  return [
    markdown({ codeLanguages: languages, extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
    history(),
    prosemarkBasicSetup(),
    prosemarkBaseThemeSetup(),
    headingDecorations,
    imageSrcResolver(() => path),
    wikiLinkExtension(() => path, isDisposed),
    markdownFormatting,
    // Only edits that leave one block: a blank line (or a new list item under
    // a list item) would split it, and the part above the id would quietly
    // drop out of this embed while staying in the page.
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || tr.annotation(linkedBlockSync)) return tr;
      return findBlock(`${tr.newDoc.toString()} ^${id}`, id)?.from === 0 ? tr : [];
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.every((tr) => tr.annotation(linkedBlockSync))) return;
      if (!writeBlock(path, id, update.state.doc.toString())) {
        showEditorNotice("This block was removed from its page, so the edit wasn't saved.");
      }
    }),
  ];
}

interface Mounted {
  inner: EditorView | null;
  unsubscribe: (() => void) | null;
}

const mounted = new WeakMap<HTMLElement, Mounted>();

class BlockEmbedWidget extends WidgetType {
  constructor(
    readonly page: string,
    readonly id: string,
    readonly hostPath: string | null,
    readonly root: string | null,
  ) {
    super();
  }

  eq(other: BlockEmbedWidget): boolean {
    return (
      this.page === other.page &&
      this.id === other.id &&
      this.hostPath === other.hostPath &&
      this.root === other.root
    );
  }

  get estimatedHeight(): number {
    return 64;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-block-embed";
    root.contentEditable = "false";
    const state: Mounted = { inner: null, unsubscribe: null };
    mounted.set(root, state);

    const header = document.createElement("span");
    header.className = "cm-block-embed-header";
    const source = document.createElement("button");
    source.type = "button";
    source.className = "cm-block-embed-source";
    source.textContent = this.page ? getFileStem(this.page) : "This page";
    source.title = "Open the page this block lives in";
    source.disabled = true;
    header.append(source);

    const body = document.createElement("span");
    body.className = "cm-block-embed-body";
    root.append(header, body);

    void resolvePage(this.page, this.hostPath, this.root)
      .then(async (path) => {
        if (!mounted.has(root)) return;
        if (!path) return this.renderMissing(view, root, "Page not found");
        source.disabled = false;
        source.textContent = getFileStem(path);
        source.addEventListener("mousedown", (event) => event.preventDefault());
        source.addEventListener("click", () => void editorApi.openLinkedPage(path));
        const text = await loadPageText(path);
        if (!mounted.has(root)) return;
        this.mount(view, root, body, path, text);
      })
      .catch((error) => {
        console.error("[editor] Failed to load linked block:", error);
        if (mounted.has(root)) this.renderMissing(view, root, "Couldn't read the page");
      });

    return root;
  }

  private mount(
    view: EditorView,
    root: HTMLElement,
    body: HTMLElement,
    path: string,
    text: string,
  ) {
    const state = mounted.get(root)!;
    const initial = blockText(text, this.id);
    if (initial === null) return this.renderMissing(view, root, "Block not found");

    const inner = new EditorView({
      parent: body,
      state: EditorState.create({
        doc: initial,
        extensions: [
          nestedExtensions(path, this.id, () => state.inner === null),
          EditorView.updateListener.of((update) => {
            // The block grew or shrank: the line holding it changed height.
            if (update.geometryChanged) view.requestMeasure();
          }),
        ],
      }),
    });
    state.inner = inner;
    root.classList.add("is-live");

    // The page changed elsewhere (its own tab, another embed, disk): show it.
    const apply = () => {
      if (state.inner !== inner) return;
      const latest = currentPageText(path);
      const next = latest === null ? null : blockText(latest, this.id);
      root.classList.toggle("is-orphaned", next === null);
      if (next === null) return;
      const change = minimalChange(inner.state.doc.toString(), next);
      if (!change) return;
      inner.dispatch({
        changes: change,
        annotations: [linkedBlockSync.of(true), Transaction.addToHistory.of(false)],
      });
    };
    // Deferred: the change may come from this embed's own write, which runs
    // inside its update, and a view cannot be dispatched to mid-update.
    state.unsubscribe = subscribePage(path, () => queueMicrotask(apply));
    view.requestMeasure();
  }

  private renderMissing(view: EditorView, root: HTMLElement, reason: string) {
    root.classList.add("is-missing");
    const body = root.querySelector(".cm-block-embed-body");
    if (body) body.textContent = `${reason} — ^${this.id}`;
    view.requestMeasure();
  }

  destroy(dom: HTMLElement): void {
    const state = mounted.get(dom);
    mounted.delete(dom);
    if (!state) return;
    state.unsubscribe?.();
    const inner = state.inner;
    state.inner = null;
    inner?.destroy();
  }

  ignoreEvent(): boolean {
    // The inner editor owns typing, clicks and selection inside the embed.
    return true;
  }
}

/* ------------------------------------------------------------ decorations */

const embedEditingMark = Decoration.mark({ class: "cm-wiki-link-editing" });
const hiddenId = Decoration.replace({});
const visibleId = Decoration.mark({ class: "cm-block-id" });

function build(view: EditorView, getFilePath: () => string): DecorationSet {
  const { state } = view;
  const ranges = getEffectiveSelectionRanges(state);
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
  const hostPath = getFilePath() || null;
  const root = getWorkspaceRoot();
  const backlinks = state.field(backlinksField, false);
  const decorations = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);

    WIKI_LINK_RE.lastIndex = 0;
    let match;
    while ((match = WIKI_LINK_RE.exec(text)) !== null) {
      if (!match[1]) continue;
      const target = parseBlockEmbedTarget(match[2]!);
      if (!target) continue;
      const start = from + match.index;
      const end = start + match[0].length;
      if (inCode(state, start)) continue;
      if (ranges.some((r) => r.from >= start && r.to <= end)) {
        decorations.push(embedEditingMark.range(start, end));
      } else {
        decorations.push(
          Decoration.replace({
            widget: new BlockEmbedWidget(target.page, target.id, hostPath, root),
          }).range(start, end),
        );
      }
    }

    // The ` ^id` that marks a referenced block: hidden, shown faintly while
    // the caret is on its line so it can be edited or deleted.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      const id = BLOCK_ID_AT_END_RE.exec(line.text);
      if (id && !inCode(state, line.to)) {
        const idFrom = line.from + id.index;
        decorations.push(
          (touches(line.from, line.to) ? visibleId : hiddenId).range(idFrom, line.to),
        );
        // Shown elsewhere: say how many places, the way RemNote counts a
        // Rem's references.
        const count = backlinks?.get(id[1]!)?.length ?? 0;
        if (count) {
          decorations.push(
            Decoration.widget({ widget: new BacklinkBadge(id[1]!, count), side: 1 }).range(line.to),
          );
        }
      }
      pos = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

function blockEmbedDecorations(getFilePath: () => string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, getFilePath);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.startState.field(backlinksField, false) !==
            update.state.field(backlinksField, false)
        ) {
          this.decorations = build(update.view, getFilePath);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Block references for the main editor: embeds, hidden ids, and the live
 *  editor registry linked blocks write through. */
export function blockEmbeds(getFilePath: () => string): Extension {
  return [
    blockEmbedHost.of(getFilePath),
    liveEditorRegistry(getFilePath),
    blockBacklinks(),
    blockEmbedDecorations(getFilePath),
  ];
}

/* ------------------------------------------------------------ copy a link */

/** Blocks whose last line cannot carry a ` ^id` without changing what they
 *  are (a fence, a table row, a column row). */
const UNLINKABLE = new Set([
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "CommentBlock",
  "ColumnRow",
  "HorizontalRule",
]);

/** Whether the handle's target can be linked to from another page. */
export function canLinkToBlock(view: EditorView, target: ActionTarget): boolean {
  if (target.kind !== "block" || UNLINKABLE.has(target.name)) return false;
  return !!view.state.facet(blockEmbedHost)?.();
}

/** Give the block an id (once) and copy `![[Page#^id]]` for pasting into any
 *  page. One dispatch, so one undo removes the id again. */
export function copyBlockLink(view: EditorView, target: ActionTarget): boolean {
  if (!canLinkToBlock(view, target) || target.kind !== "block") return false;
  const path = view.state.facet(blockEmbedHost)!();
  const { doc } = view.state;
  if (target.to > doc.length) return false;
  // A list item or heading carries its id on its own (first) line; a
  // paragraph on its last, so the id covers every line of it.
  const firstLineOnly = target.name === "ListItem" || /Heading/.test(target.name);
  const end = target.to > target.from ? target.to - 1 : target.to;
  const line = firstLineOnly ? doc.lineAt(target.from) : doc.lineAt(Math.max(target.from, end));
  let id = blockIdOnLine(line.text);
  if (!id) {
    id = newBlockId();
    view.dispatch({
      changes: { from: line.to, insert: ` ^${id}` },
      userEvent: "input.block-id",
    });
  }
  const link = `![[${blockLinkPage(path, getWorkspaceRoot())}#^${id}]]`;
  writeText(link).then(
    () => showEditorNotice("Block link copied. Paste it into any page to show this block there."),
    (error) => {
      console.error("[editor] Failed to copy block link:", error);
      showEditorNotice("Couldn't copy the block link.");
    },
  );
  return true;
}
