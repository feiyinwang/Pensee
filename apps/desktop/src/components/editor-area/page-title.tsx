import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { useRef, useState } from "react";

import { renameFileStem } from "@/lib/file-actions";
import { getFileStem } from "@/lib/paths";
import "./page-title.css";

/**
 * The page's title, above its properties and body: the file name, edited in
 * place. It is the one title a page has — a `# ` heading in the body is just a
 * heading. Enter, ↓ at the end, or clicking away renames the file through the
 * same write path as the sidebar; Escape keeps the name. Enter and ↓ continue
 * into the body; ↑ at the top of the body comes back (`pageTitleArrowUp`).
 *
 * Mount with `key={path}`: a rename changes the path, and the field starts
 * over from the new name.
 */
export function PageTitle({ path, view }: { path: string; view: EditorView | null }) {
  const stem = getFileStem(path);
  const [draft, setDraft] = useState(stem);
  // Set when a key already committed or cancelled, so the blur that follows
  // (focus moving to the body, or `blur()`) does not act a second time.
  const settled = useRef(false);

  const commit = () => {
    const next = draft.trim();
    if (next === "" || next === stem) {
      setDraft(stem);
      return;
    }
    // A refused rename (name taken, invalid) keeps the old path and this
    // component; show the name the file still has. A rename that lands
    // remounts it under the new path.
    void renameFileStem(path, next).then(() => setDraft(stem));
  };

  const enterBody = (field: HTMLTextAreaElement) => {
    if (!view) {
      field.blur();
      return;
    }
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  };

  return (
    <div className="page-title" data-value={draft || "Untitled"}>
      <textarea
        data-page-title
        className="page-title-input"
        value={draft}
        rows={1}
        placeholder="Untitled"
        aria-label="Page title"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value.replace(/\r?\n/g, " "))}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const field = event.currentTarget;
          const atEnd =
            field.selectionStart === field.value.length &&
            field.selectionEnd === field.value.length;
          if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
            event.preventDefault();
            settled.current = true;
            commit();
            enterBody(field);
          } else if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            setDraft(stem);
            field.blur();
          }
        }}
        onFocus={() => {
          settled.current = false;
        }}
        onBlur={() => {
          if (settled.current) {
            settled.current = false;
            return;
          }
          commit();
        }}
      />
    </div>
  );
}

/** ↑ on the body's top visual line moves into the page title — the reverse of
 *  ↓ / Enter leaving it. Checked by position, not by "the caret can't move":
 *  a note that starts with a heading clamps the caret past its hidden `#`, so
 *  plain ↑ there always "moves". High, not highest: open menus keep the key. */
export const pageTitleArrowUp = Prec.high(
  keymap.of([
    {
      key: "ArrowUp",
      run: (view) => {
        const { main } = view.state.selection;
        if (!main.empty || view.state.doc.lineAt(main.head).number !== 1) return false;
        // A wrapped first line still has a visual line above the caret.
        const here = view.coordsAtPos(main.head);
        const above = view.coordsAtPos(view.moveVertically(main, false).head);
        if (here && above && above.bottom <= here.top + 1) return false;
        const title = view.dom
          .closest("[data-pane]")
          ?.querySelector<HTMLTextAreaElement>("[data-page-title]");
        if (!title) return false;
        title.focus();
        title.setSelectionRange(title.value.length, title.value.length);
        return true;
      },
    },
  ]),
);
