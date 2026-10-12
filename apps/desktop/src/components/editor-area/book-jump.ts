import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { BLOCK_ID_AT_END_RE } from "@/lib/block-refs";
import { parseBookHighlightId } from "@/lib/book-highlights";
import { isBookOpenFor, jumpToHighlight, requestJump } from "@/lib/book-readers";

// A book page's highlight blocks lead back into the book
// (SPECs/book-reader-spec.md): the caret landing on one scrolls the open book
// there, and Cmd+click opens the book first when it is closed. The location is
// the block's hidden id, so nothing shows in the block. Cost per caret move:
// one regex on the caret's line, only when the line changes.

function bookIdOnLine(view: EditorView, pos: number): string | null {
  const id = BLOCK_ID_AT_END_RE.exec(view.state.doc.lineAt(pos).text)?.[1] ?? null;
  return id && parseBookHighlightId(id) ? id : null;
}

export function bookJump(getFilePath: () => string): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        lastLine = -1;
        update(update: ViewUpdate) {
          if (!update.selectionSet || !update.view.hasFocus) return;
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head).number;
          if (line === this.lastLine && !update.docChanged) return;
          this.lastLine = line;
          const id = bookIdOnLine(update.view, head);
          if (id) jumpToHighlight(getFilePath(), id);
        }
      },
    ),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.metaKey || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const id = pos === null ? null : bookIdOnLine(view, pos);
        if (!id) return false;
        const notePath = getFilePath();
        event.preventDefault();
        if (isBookOpenFor(notePath)) {
          jumpToHighlight(notePath, id);
          return true;
        }
        requestJump(notePath, id);
        // Lazily: the import flow pulls in stores this extension shouldn't.
        void import("@/lib/book-import").then(({ openBookOfPage }) => openBookOfPage(notePath));
        return true;
      },
    }),
  ];
}
