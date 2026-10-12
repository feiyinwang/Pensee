import type { EditorView } from "@codemirror/view";

// The mounted note editors, so the agent can ask which lines of a long note
// are on screen at send time. A plain registry, not a store: nothing renders
// from it, and scrolling never does work for it. One view can show different
// files over its life (tab switch swaps the document), so the path is a getter.

interface Entry {
  path: () => string;
  scroller: () => HTMLElement | null;
}

const views = new Map<EditorView, Entry>();

export function registerEditorView(
  view: EditorView,
  path: () => string,
  scroller: () => HTMLElement | null,
): () => void {
  views.set(view, { path, scroller });
  return () => views.delete(view);
}

/** The part of a note's body on screen: whole lines, 0-based, end exclusive. */
export interface VisibleLines {
  fromLine: number;
  toLine: number;
  text: string;
}

/** The lines of `path` visible in any mounted editor, merged; null when no
 *  editor shows it (a background tab, or a pane scrolled past the note). */
export function visibleEditorLines(path: string): VisibleLines | null {
  let from = Infinity;
  let to = -Infinity;
  let shown: EditorView | null = null;
  for (const [view, entry] of views) {
    if (entry.path() !== path) continue;
    const range = visibleRange(view, entry.scroller());
    if (!range) continue;
    from = Math.min(from, range.from);
    to = Math.max(to, range.to);
    shown = view;
  }
  if (!shown) return null;
  const doc = shown.state.doc;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  return {
    fromLine: first.number - 1,
    toLine: last.number,
    text: doc.sliceString(first.from, last.to),
  };
}

/** Document positions at the top and bottom of what the user can see: the
 *  editor clipped by its scroll container and the window. */
function visibleRange(
  view: EditorView,
  scroller: HTMLElement | null,
): { from: number; to: number } | null {
  if (!view.dom.isConnected) return null;
  const content = view.contentDOM.getBoundingClientRect();
  const clip = scroller?.getBoundingClientRect();
  const top = Math.max(content.top, clip?.top ?? 0, 0);
  const bottom = Math.min(content.bottom, clip?.bottom ?? Infinity, window.innerHeight);
  if (bottom <= top || content.width === 0) return null;
  return {
    from: view.lineBlockAtHeight(top - view.documentTop).from,
    to: view.lineBlockAtHeight(bottom - view.documentTop).to,
  };
}
