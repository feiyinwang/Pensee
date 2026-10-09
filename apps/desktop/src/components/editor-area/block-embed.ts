import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Compartment, EditorState, type Extension, Prec, Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  prosemarkBasicSetup,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
  selectionInertFacet,
} from "@/lib/prosemark-core/main";
import * as tauri from "@/lib/tauri";
import { getFileStem } from "@/lib/paths";
import {
  BLOCK_ID_AT_END_RE,
  blockIdOnLine,
  blockLinkPage,
  blockAfterInsertion,
  blockText,
  displayAsBullet,
  isPictureBlock,
  bodyStaysOneBlock,
  minimalChange,
  newBlockId,
  parseBlockEmbedTarget,
  referenceFromClipboard,
  referenceInsertion,
  restoreMarker,
} from "@/lib/block-refs";
import { WIKI_LINK_RE, findWikiLinkAt } from "@/lib/wiki-links";
import { findWikiPage } from "@/lib/wiki-pages";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import * as editorApi from "@/hooks/editor-api";
import { gripBlockAt, type ActionTarget } from "./block-actions";
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

/** Pasted as a list item, the host line's bullet is the marker: hide the
 *  embedded item's own (`- `, `6. `, a task box) so it reads as one bullet.
 *  Atomic, so the caret steps over it. Only the first line is looked at. */
const HOST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

function hiddenFirstMarker(state: EditorState): DecorationSet {
  const marker = HOST_MARKER_RE.exec(state.doc.line(1).text);
  return marker
    ? Decoration.set(Decoration.replace({}).range(0, marker[0].length))
    : Decoration.none;
}

const hideOwnMarker: Extension = [
  EditorView.decorations.compute(["doc"], hiddenFirstMarker),
  EditorView.atomicRanges.of((view) => hiddenFirstMarker(view.state)),
];

/** Display ↔ source text for one embed: a numbered item shows as a bullet,
 *  and its number goes back on every write (`displayAsBullet`). */
interface BodyCodec {
  marker: string | null;
}

/** Remove this embed's `![[Page#^id]]` from the host page — the reference,
 *  never the block it shows. A line left with nothing else on it (or only a
 *  list marker) goes with it. */
function removeReference(host: EditorView, root: HTMLElement) {
  let pos: number;
  try {
    pos = host.posAtDOM(root);
  } catch {
    return;
  }
  const { doc } = host.state;
  const match = findWikiLinkAt(doc, pos);
  if (!match) return;
  const line = doc.lineAt(match.from);
  const rest = line.text.slice(0, match.from - line.from) + line.text.slice(match.to - line.from);
  let from = match.from;
  let to = match.to;
  if (!rest.trim() || /^\s*(?:[-*+]|\d+[.)])[ \t]*$/.test(rest)) {
    from = line.from;
    to = line.to;
    if (to < doc.length) to += 1;
    else if (from > 0) from -= 1;
    // Between two blank lines, take one of them too, so the blocks around it
    // keep a single blank line between them.
    const prevBlank = line.number > 1 && !doc.line(line.number - 1).text.trim();
    const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
    if (prevBlank && next && !next.text.trim()) to = Math.min(doc.length, next.to + 1);
  }
  host.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete",
    scrollIntoView: true,
  });
  host.focus();
}

/** Enter at the very end of an embed: a new block under it in the host page,
 *  as Enter would give anywhere else, with the caret moved there. */
function continueBelow(host: EditorView, root: HTMLElement, linkedIsItem: boolean) {
  let pos: number;
  try {
    pos = host.posAtDOM(root);
  } catch {
    return; // The widget left the document.
  }
  const line = host.state.doc.lineAt(pos);
  const insert = blockAfterInsertion(line.text, linkedIsItem);
  host.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + insert.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  host.focus();
}

function nestedExtensions(
  path: string,
  id: string,
  codec: BodyCodec,
  inList: boolean,
  isDisposed: () => boolean,
  exitBelow: () => void,
  picture: boolean,
  dropReference: () => void,
): Extension[] {
  // Unfocused, the embed has no caret of its own to show: its selection
  // (parked at 0) must not unfold a picture's `![](...)` or a link's source.
  const inert = new Compartment();
  return [
    markdown({ codeLanguages: languages, extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
    inert.of(selectionInertFacet.of(true)),
    // A picture stays a picture even while focused: there is nothing in it to
    // edit here, and Backspace/Delete remove this reference, not the picture.
    picture
      ? [
          EditorState.readOnly.of(true),
          keymap.of([
            { key: "Backspace", run: () => (dropReference(), true) },
            { key: "Delete", run: () => (dropReference(), true) },
          ]),
        ]
      : EditorView.focusChangeEffect.of((_state, focusing) =>
          inert.reconfigure(selectionInertFacet.of(!focusing)),
        ),
    // The page editor hides the native caret and draws its own; the embed
    // sits inside it and inherits the hidden caret, so it draws one too.
    drawSelection(),
    inList ? hideOwnMarker : [],
    // Ahead of the list/markdown Enter handlers, which would try to split the
    // block (and be refused by the filter below).
    Prec.highest(
      keymap.of([
        {
          key: "Enter",
          run: (view) => {
            const sel = view.state.selection.main;
            if (!sel.empty || sel.head !== view.state.doc.length) return false;
            exitBelow();
            return true;
          },
        },
      ]),
    ),
    history(),
    prosemarkBasicSetup(),
    prosemarkBaseThemeSetup(),
    headingDecorations,
    imageSrcResolver(() => path),
    wikiLinkExtension(() => path, isDisposed),
    markdownFormatting,
    // ⌘⇧C inside an embed: this block already has a reference; copy it.
    keymap.of([
      {
        key: COPY_BLOCK_REFERENCE_CHORD,
        run: () => {
          copyReference(`![[${blockLinkPage(path, getWorkspaceRoot())}#^${id}]]`);
          return true;
        },
        preventDefault: true,
      },
    ]),
    // Only edits that leave one block: a blank line in a paragraph, or a
    // sibling item next to a bullet, would split it, and that part would
    // quietly drop out of this embed while staying in the page. Children
    // under a bullet are fine — they belong to it.
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || tr.annotation(linkedBlockSync)) return tr;
      // Deleting everything in the embed means "remove this reference": the
      // original block stays as it is.
      if (!tr.newDoc.toString().trim() && tr.startState.doc.toString().trim()) {
        queueMicrotask(dropReference);
        return [];
      }
      return bodyStaysOneBlock(restoreMarker(tr.newDoc.toString(), codec.marker), id) ? tr : [];
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.every((tr) => tr.annotation(linkedBlockSync))) return;
      if (!writeBlock(path, id, restoreMarker(update.state.doc.toString(), codec.marker))) {
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
    /** Pasted as a list item: render as that item, without its own marker. */
    readonly inList: boolean,
  ) {
    super();
  }

  eq(other: BlockEmbedWidget): boolean {
    return (
      this.page === other.page &&
      this.id === other.id &&
      this.hostPath === other.hostPath &&
      this.root === other.root &&
      this.inList === other.inList
    );
  }

  get estimatedHeight(): number {
    return 64;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = this.inList ? "cm-block-embed is-in-list" : "cm-block-embed";
    root.contentEditable = "false";
    const state: Mounted = { inner: null, unsubscribe: null };
    mounted.set(root, state);

    const header = document.createElement("span");
    header.className = "cm-block-embed-header";
    const source = document.createElement("button");
    source.type = "button";
    source.className = "cm-block-embed-source";
    source.setAttribute("aria-label", "Open the page this block lives in");
    source.title = this.page ? `From ${getFileStem(this.page)}` : "From this page";
    source.disabled = true;
    header.append(source);

    const body = document.createElement("span");
    body.className = "cm-block-embed-body";
    // Opt out of the page editor's width, inset and bottom padding.
    body.dataset.inlineEditor = "";
    root.append(header, body);

    void resolvePage(this.page, this.hostPath, this.root)
      .then(async (path) => {
        if (!mounted.has(root)) return;
        if (!path) return this.renderMissing(view, root, "Page not found");
        source.disabled = false;
        source.title = `From ${getFileStem(path)} — click to open`;
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
    const source = blockText(text, this.id);
    if (source === null) return this.renderMissing(view, root, "Block not found");
    const { display: initial, marker } = displayAsBullet(source);
    const codec: BodyCodec = { marker };

    const inner = new EditorView({
      parent: body,
      state: EditorState.create({
        doc: initial,
        extensions: [
          nestedExtensions(
            path,
            this.id,
            codec,
            this.inList,
            () => state.inner === null,
            () => continueBelow(view, root, /^\s*-[ \t]/.test(initial)),
            isPictureBlock(source),
            () => removeReference(view, root),
          ),
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
      const nextSource = latest === null ? null : blockText(latest, this.id);
      let next: string | null = null;
      if (nextSource !== null) {
        const shown = displayAsBullet(nextSource);
        codec.marker = shown.marker;
        next = shown.display;
      }
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

/** The embed is a list item's whole body: `  - ![[Page#^id]]`. */
function inListItem(state: EditorState, start: number): boolean {
  const line = state.doc.lineAt(start);
  return (
    HOST_MARKER_RE.test(line.text.slice(0, start - line.from)) &&
    HOST_MARKER_RE.exec(line.text)![0].length === start - line.from
  );
}

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
  // A widget can split the viewport into several visible ranges that share a
  // line; each line's id is decorated once.
  let lastIdLine = -1;

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
      // Source shows only with the caret strictly inside, or a selection over
      // it. A caret at either edge leaves the block rendered: right after a
      // paste the caret sits at its end, and that must not look like raw text.
      const revealed = ranges.some((r) =>
        r.empty ? r.from > start && r.from < end : r.from >= start && r.to <= end,
      );
      if (revealed) {
        decorations.push(embedEditingMark.range(start, end));
      } else {
        decorations.push(
          Decoration.replace({
            widget: new BlockEmbedWidget(
              target.page,
              target.id,
              hostPath,
              root,
              inListItem(state, start),
            ),
          }).range(start, end),
        );
      }
    }

    // The ` ^id` that marks a referenced block: hidden, shown faintly while
    // the caret is on its line so it can be edited or deleted.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      const id = line.number > lastIdLine ? BLOCK_ID_AT_END_RE.exec(line.text) : null;
      lastIdLine = Math.max(lastIdLine, line.number);
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
    referenceKeymap,
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
  // The grip (and the caret shortcut) narrow a paragraph to one line; the id
  // still goes after its last line, or the lines below would fall outside.
  const to =
    target.name === "Paragraph" ? paragraphEnd(view.state, target.from, target.to) : target.to;
  const end = to > target.from ? to - 1 : to;
  const line = firstLineOnly ? doc.lineAt(target.from) : doc.lineAt(Math.max(target.from, end));
  let id = blockIdOnLine(line.text);
  if (!id) {
    id = newBlockId();
    view.dispatch({
      changes: { from: line.to, insert: ` ^${id}` },
      userEvent: "input.block-id",
    });
  }
  copyReference(`![[${blockLinkPage(path, getWorkspaceRoot())}#^${id}]]`);
  return true;
}

function paragraphEnd(state: EditorState, from: number, to: number): number {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Paragraph") return Math.max(to, node.to);
  }
  return to;
}

function copyReference(link: string) {
  writeText(link).then(
    () =>
      showEditorNotice("Reference copied. Press ⌘⇧V in any page to paste it as a linked block."),
    (error) => {
      console.error("[editor] Failed to copy block reference:", error);
      showEditorNotice("Couldn't copy the block reference.");
    },
  );
}

/* ------------------------------------------------- keyboard: ⌘⇧C / ⌘⇧V */

export const COPY_BLOCK_REFERENCE_CHORD = "Mod-Shift-c";
export const PASTE_BLOCK_REFERENCE_CHORD = "Mod-Shift-v";

/** ⌘⇧C: copy a reference to the block the caret is in — the same block the
 *  gutter handle would act on. */
export function copyBlockReferenceAtCaret(view: EditorView): boolean {
  if (!view.state.facet(blockEmbedHost)?.()) return false;
  const block = gripBlockAt(view.state, view.state.selection.main.head);
  if (!block) {
    showEditorNotice("Put the cursor in a block to copy a reference to it.");
    return true;
  }
  const target: ActionTarget = { kind: "block", ...block };
  if (!canLinkToBlock(view, target)) {
    showEditorNotice("Code, tables and columns can't be referenced yet.");
    return true;
  }
  return copyBlockLink(view, target);
}

/** ⌘⇧V: put the copied reference below the caret's line as a linked block —
 *  a new item when the caret is in a list. */
export function pasteBlockReference(view: EditorView, isDisposed: () => boolean = () => false) {
  readText()
    .then((text) => {
      if (isDisposed()) return;
      const embed = text ? referenceFromClipboard(text) : null;
      if (!embed) {
        showEditorNotice("Nothing to paste as a reference. Copy a block with ⌘⇧C first.");
        return;
      }
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const { replaceLine, text: insert } = referenceInsertion(line.text, embed);
      const from = replaceLine ? line.from : line.to;
      view.dispatch({
        changes: { from, to: line.to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      view.focus();
    })
    .catch((error) => {
      console.error("[editor] Failed to paste block reference:", error);
      showEditorNotice("Couldn't read the clipboard.");
    });
  return true;
}

const referenceKeymap = Prec.high(
  keymap.of([
    { key: COPY_BLOCK_REFERENCE_CHORD, run: copyBlockReferenceAtCaret, preventDefault: true },
    {
      key: PASTE_BLOCK_REFERENCE_CHORD,
      run: (view) => (view.state.facet(blockEmbedHost) ? pasteBlockReference(view) : false),
      preventDefault: true,
    },
  ]),
);
