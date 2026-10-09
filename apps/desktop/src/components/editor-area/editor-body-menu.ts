import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { buildEditorBodyMenuItemsSpec, showNativeContextMenu } from "./editor-context-menu";
import { followLink, linkHrefAtPos } from "./link-navigation";
import { runEditorCommand } from "./markdown-formatting";
import { moveSelectionToPage } from "./wiki-pages-extension";
import { copyBlockReferenceAtCaret, pasteBlockReference } from "./block-embed";
import { tabularPasteTransaction } from "@/lib/tabular-paste";

/** Right-click menu over the editor body: clipboard, the command submenus,
 *  and link actions when the click landed on a link. */
export function editorBodyContextMenuExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      event.preventDefault();

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const linkHref = pos === null ? null : linkHrefAtPos(view, pos);
      const hasLink = linkHref !== null;
      const filePath = getFilePath();
      const hasSelection = !view.state.selection.main.empty;

      void showNativeContextMenu(
        buildEditorBodyMenuItemsSpec(
          {
            onCut: () => {
              const { from, to } = view.state.selection.main;
              if (from === to) return;
              void writeText(view.state.sliceDoc(from, to));
              view.dispatch({ changes: { from, to } });
            },
            onCopy: () => {
              const { from, to } = view.state.selection.main;
              if (from === to) return;
              void writeText(view.state.sliceDoc(from, to));
            },
            onPaste: () => {
              void readText().then((text) => {
                if (!text || isDisposed()) return;
                view.dispatch(
                  tabularPasteTransaction(view.state, text) ?? view.state.replaceSelection(text),
                );
              });
            },
            onSelectAll: () => {
              view.dispatch({
                selection: { anchor: 0, head: view.state.doc.length },
              });
            },
            onOpenLink: hasLink
              ? () => {
                  void followLink(linkHref, view, filePath);
                }
              : undefined,
            onCopyLink: hasLink
              ? () => {
                  void writeText(linkHref);
                }
              : undefined,
            onMoveToPage: hasSelection
              ? () => {
                  view.focus();
                  moveSelectionToPage(view, getFilePath, isDisposed);
                }
              : undefined,
            onCopyBlockReference: () => {
              // The block under the click, not wherever the caret was.
              if (pos !== null) view.dispatch({ selection: { anchor: pos } });
              copyBlockReferenceAtCaret(view);
            },
            onPasteBlockReference: () => {
              if (pos !== null) view.dispatch({ selection: { anchor: pos } });
              pasteBlockReference(view, isDisposed);
            },
            onRunCommand: (id) => {
              view.focus();
              runEditorCommand(view, id);
            },
          },
          hasLink,
        ),
      );

      return true;
    },
  });
}
