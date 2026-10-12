import type { Tab } from "@/stores/editor-store";

/**
 * The book tab and its page's tab, in tab order, when the active tab is one of
 * them and both are open — shown together as one block when a pinch zooms
 * into either (SPECs/book-reader-spec.md). `pages` maps an open book to its
 * page; a book tab's own `note` hint covers a reader that hasn't said yet.
 */
export function bookPair(
  tabs: readonly Tab[],
  activeTabId: string | null,
  pages: Readonly<Record<string, string>>,
): [string, string] | null {
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (!active) return null;
  let other: Tab | undefined;
  if (active.location.kind === "book") {
    const note = pages[active.location.path] ?? active.location.note;
    other = tabs.find((tab) => tab.location.kind === "file" && tab.location.path === note);
  } else if (active.location.kind === "file") {
    const path = active.location.path;
    other = tabs.find(
      (tab) =>
        tab.location.kind === "book" && (pages[tab.location.path] ?? tab.location.note) === path,
    );
  }
  if (!other) return null;
  return tabs.indexOf(active) < tabs.indexOf(other) ? [active.id, other.id] : [other.id, active.id];
}
