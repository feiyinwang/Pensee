import { EditorView, ViewPlugin, drawSelection } from "@codemirror/view";
import { type Compartment, type Extension, Prec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { history } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import {
  prosemarkBasicSetup,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "@/lib/prosemark-core/main";
import * as editorApi from "@/hooks/editor-api";
import { dragFreezeExtensions } from "./drag-selection-gate";
import { editorBodyContextMenuExtension } from "./editor-body-menu";
import { editorClipboardExtension } from "./editor-clipboard";
import { editorSearchExtensions } from "./editor-search-extensions";
import { useEditorSearchStore } from "./editor-search-store";
import { headingDecorations } from "./heading-decorations";
import { headingLevelLabels } from "./heading-level-labels";
import { htmlBlockDecorations, htmlBlockParserExtension } from "./html-block-decorations";
import { columnsDecorations, columnsParserExtension } from "./columns-decorations";
import { boardDecorations } from "./board/board-decorations";
import { imageSrcResolver } from "./image-src-resolver";
import { linkNavigationExtension } from "./link-navigation";
import { linkChips, linkPreviews } from "./link-preview";
import { emptyHeadingKeymap, markdownFormatting } from "./markdown-formatting";
import { mathDecorations } from "./math-decorations";
import { mermaidDecorations } from "./mermaid-decorations";
import { tableDecorations } from "./table-decorations";
import { viewportParsePlugin } from "./viewport-parse";
import { wikiLinkExtension } from "./wiki-link-extension";
import { wikiPagesExtension } from "./wiki-pages-extension";
import { wikiLinkPreview } from "./wiki-link-preview";

// Focus the editor when its pane is revealed (tab switch). Panes hide via an
// `invisible` class, so watch for that flipping off.
function focusOnRevealExtension(isDisposed: () => boolean): Extension {
  return ViewPlugin.define((view) => {
    const pane = view.dom.closest<HTMLElement>("[data-pane]");
    if (!pane) return { destroy() {} };

    let wasHidden = pane.classList.contains("invisible");

    const mo = new MutationObserver(() => {
      if (isDisposed()) return;
      const isHidden = pane.classList.contains("invisible");
      if (wasHidden && !isHidden) {
        view.focus();
      }
      wasHidden = isHidden;
    });

    mo.observe(pane, { attributes: true, attributeFilter: ["class"] });

    return { destroy: () => mo.disconnect() };
  });
}

const headingWeightHighlight = Prec.highest(
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.strong, fontWeight: "600", color: "var(--editor-text-strong)" },
      { tag: tags.heading, fontWeight: "600" },
      { tag: tags.heading1, fontWeight: "600" },
      { tag: tags.heading2, fontWeight: "600" },
      { tag: tags.heading3, fontWeight: "600" },
      { tag: tags.heading4, fontWeight: "600" },
      { tag: tags.heading5, fontWeight: "600" },
      { tag: tags.heading6, fontWeight: "600" },
    ]),
  ),
);

// Mirror document and caret changes into the editor store. Swaps and reloads
// carry a "writer" userEvent and are skipped: the store already has that
// content and the caret is being restored, not moved.
function storeSyncExtension(getFilePath: () => string): Extension {
  return EditorView.updateListener.of((update) => {
    const isSwap = update.transactions.some((tr) => tr.isUserEvent("writer"));
    if (update.docChanged && !isSwap) {
      editorApi.updateContent(getFilePath(), update.state.doc.toString());
    }
    if (update.selectionSet && !isSwap) {
      editorApi.updateCursorPos(getFilePath(), update.state.selection.main.head);
    }
    if (update.docChanged || update.selectionSet) {
      useEditorSearchStore.getState().bumpDocVersion(update.view);
    }
  });
}

export function createEditorExtensions(
  getFilePath: () => string,
  isDisposed: () => boolean,
  historyCompartment: Compartment,
): Extension[] {
  return [
    markdown({
      codeLanguages: languages,
      // `columnsParserExtension` must come before the html-block parser: both
      // register `before: "HTMLBlock"`, and a `wr-row` div has to be claimed as
      // one ColumnRow node (blank lines and all) before the generic Type-6
      // HTML block parser cuts it at the first blank line.
      extensions: [
        GFM,
        prosemarkMarkdownSyntaxExtensions,
        columnsParserExtension,
        htmlBlockParserExtension,
      ],
    }),
    linkNavigationExtension(getFilePath, isDisposed),
    editorBodyContextMenuExtension(getFilePath, isDisposed),
    // Undo history lives in its own compartment so a tab swap can reset it
    // (reconfigure out and back in) without tearing down the rest of the setup.
    historyCompartment.of(history()),
    prosemarkBasicSetup(),
    editorSearchExtensions,
    // Freeze unfurl/fold decisions while a pointer drag is in flight, so the
    // text doesn't reflow under the cursor as the live selection sweeps
    // across markdown nodes. Drives prosemark's `unfurlFreezeFacet` from a
    // pointerdown selection snapshot; the unfreeze on pointerup re-asserts
    // selection so a single rebuild runs against the final live ranges.
    dragFreezeExtensions,
    drawSelection(),
    prosemarkBaseThemeSetup(),
    headingWeightHighlight,
    viewportParsePlugin,
    tableDecorations(),
    // Before htmlBlockDecorations: column rows own their own node type, but
    // keeping them adjacent documents the ordering intent. `getFilePath` is
    // needed so dropped image files land next to the note they were dropped on.
    columnsDecorations(getFilePath),
    htmlBlockDecorations(),
    mermaidDecorations(getFilePath),
    // Next to mermaid on purpose: same fenced-code fold mechanism, same
    // full-screen-overlay pattern. `getFilePath` is needed so pasted images
    // land in this note's assets folder instead of being inlined.
    boardDecorations(getFilePath),
    mathDecorations(),
    linkPreviews(),
    linkChips(),
    headingDecorations,
    headingLevelLabels,
    imageSrcResolver(getFilePath),
    wikiLinkExtension(getFilePath, isDisposed),
    wikiPagesExtension(getFilePath, isDisposed),
    wikiLinkPreview(getFilePath),
    markdownFormatting,
    emptyHeadingKeymap,
    storeSyncExtension(getFilePath),
    editorClipboardExtension(getFilePath, isDisposed),
    focusOnRevealExtension(isDisposed),
  ];
}
