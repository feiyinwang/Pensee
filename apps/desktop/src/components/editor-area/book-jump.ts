import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { BLOCK_ID_AT_END_RE } from "@/lib/block-refs";
import { type BookLocation, parseBookHighlightId } from "@/lib/book-highlights";
import { bookPlaceName, isBookOpenFor, jumpToHighlight, requestJump } from "@/lib/book-readers";
import { pinIcon } from "./video-pin";
import { IS_MAC } from "@/lib/platform";

// A book page's highlight blocks lead back into the book
// (SPECs/book-reader-spec.md): the caret landing on one scrolls the open book
// there, and Cmd+click, or a click on the block's pin, opens the book first
// when it is closed. The location is the block's id, drawn as a pin
// (`BookPinWidget`, placed by block-embed.ts). Cost per caret move: one regex
// on the caret's line, only when the line changes.

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
        if (!(IS_MAC ? event.metaKey : event.ctrlKey) || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const id = pos === null ? null : bookIdOnLine(view, pos);
        if (!id) return false;
        event.preventDefault();
        goToHighlight(getFilePath(), id);
        return true;
      },
    }),
  ];
}

/** Scroll the book of page `notePath` to highlight `id`, opening the book
 *  first when it is closed. */
function goToHighlight(notePath: string, id: string): void {
  if (isBookOpenFor(notePath)) {
    jumpToHighlight(notePath, id);
    return;
  }
  requestJump(notePath, id);
  // Lazily: the import flow pulls in stores this extension shouldn't.
  void import("@/lib/book-import").then(({ openBookOfPage }) => openBookOfPage(notePath));
}

/** The pin drawn in place of a book highlight's `^bk-…` id: the line came
 *  from the book, and pressing the pin goes to the passage. Atomic, like a
 *  video pin (block-embed.ts puts it in the editor's atomic ranges). */
export class BookPinWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly location: BookLocation,
    readonly getFilePath: () => string,
  ) {
    super();
  }

  eq(other: BookPinWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const pin = document.createElement("span");
    pin.className = "cm-book-pin";
    pin.setAttribute("role", "button");
    const label = () => `Go to ${bookPlaceName(this.getFilePath(), this.location)}`;
    pin.title = label();
    pin.setAttribute("aria-label", pin.title);
    pin.append(pinIcon());
    // A chapter's name is known only while its book is open: name the place
    // again when the pointer arrives.
    pin.addEventListener("mouseenter", () => {
      pin.title = label();
      pin.setAttribute("aria-label", pin.title);
    });
    // The caret stays where it was: a pin is pressed, not clicked into.
    pin.addEventListener("mousedown", (event) => event.preventDefault());
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goToHighlight(this.getFilePath(), this.id);
    });
    return pin;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
