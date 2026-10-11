/**
 * `[[` page suggestions while typing a card's text.
 *
 * The board edits text in a plain textarea, not CodeMirror, so the editor's
 * wiki-link completion cannot run here. This is the same search
 * (`tauri.fuzzySearch`) and the same inserted target (`canonicalWikiTarget`)
 * in a small list under the field. The text math is pure and exported for
 * tests; the DOM part only wires keys and clicks to it.
 */

import * as tauri from "@/lib/tauri";
import { getFileStem } from "@/lib/paths";
import { canonicalWikiTarget } from "@/lib/wiki-links";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import type { SearchResult } from "@/types/fs";

const MAX_RESULTS = 8;

/** An open `[[query` ending at the caret: where its `[[` starts, and the
 *  query. Null once the query is empty, closed, or names a heading/alias. */
export function linkQueryAt(value: string, caret: number): { from: number; query: string } | null {
  const m = /\[\[([^[\]\n#^|]*)$/.exec(value.slice(0, caret));
  if (!m || !m[1].trim()) return null;
  return { from: m.index, query: m[1] };
}

/** Replaces `[[query` (and a `]]` already right after the caret) with the
 *  finished link; the caret lands after it. */
export function applyLinkCompletion(
  value: string,
  from: number,
  caret: number,
  target: string,
): { value: string; caret: number } {
  const end = value.startsWith("]]", caret) ? caret + 2 : caret;
  const link = `[[${target}]]`;
  return { value: value.slice(0, from) + link + value.slice(end), caret: from + link.length };
}

/** Wires suggestions to `area`; `onChange` runs after a completion rewrites
 *  the text (so the field can refit). Returns a dispose. */
export function attachLinkCompletion(
  area: HTMLTextAreaElement,
  layer: HTMLElement,
  onChange: () => void,
): () => void {
  const list = document.createElement("div");
  list.className = "wr-board-link-menu surface-card";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  layer.append(list);

  let results: SearchResult[] = [];
  let active = 0;
  let query: { from: number; query: string } | null = null;
  /** Bumped per search, so a slow reply never overwrites a newer one. */
  let seq = 0;

  const close = (): void => {
    seq += 1;
    results = [];
    query = null;
    list.hidden = true;
  };

  const render = (): void => {
    list.replaceChildren();
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "wr-board-link-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === active));
      const name = document.createElement("span");
      name.textContent = getFileStem(r.filename);
      row.append(name);
      const dir = r.relative_path.slice(0, r.relative_path.length - r.filename.length);
      if (dir) {
        const detail = document.createElement("span");
        detail.className = "wr-board-link-detail";
        detail.textContent = dir.replace(/\/$/, "");
        row.append(detail);
      }
      // pointerdown, not click: the field must keep focus (its blur commits).
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        accept(i);
      });
      list.append(row);
    });
    list.style.left = area.style.left;
    list.style.top = `${area.offsetTop + area.offsetHeight + 6}px`;
    list.hidden = results.length === 0;
  };

  const accept = (i: number): void => {
    const r = results[i];
    if (!r || !query) return;
    const next = applyLinkCompletion(
      area.value,
      query.from,
      area.selectionStart,
      canonicalWikiTarget(r, results),
    );
    area.value = next.value;
    area.setSelectionRange(next.caret, next.caret);
    close();
    onChange();
  };

  const onInput = (): void => {
    const q =
      area.selectionStart === area.selectionEnd
        ? linkQueryAt(area.value, area.selectionStart)
        : null;
    if (!q || !getWorkspaceRoot()) {
      close();
      return;
    }
    query = q;
    const mine = ++seq;
    tauri
      .fuzzySearch(q.query, MAX_RESULTS)
      .then((found) => {
        if (mine !== seq) return;
        results = found;
        active = 0;
        render();
      })
      .catch((error) => console.error("[board] Page search failed:", error));
  };

  /** Capture phase on the field, so the board's own keys (Escape commits,
   *  Tab steps to the next card) never see a key the list used. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (list.hidden) return;
    const used = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      used();
      const n = results.length;
      active = (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      render();
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
      used();
      accept(active);
    } else if (e.key === "Escape") {
      used();
      close();
    }
  };

  area.addEventListener("input", onInput);
  area.addEventListener("keydown", onKeyDown, true);
  return () => {
    close();
    area.removeEventListener("input", onInput);
    area.removeEventListener("keydown", onKeyDown, true);
    list.remove();
  };
}
