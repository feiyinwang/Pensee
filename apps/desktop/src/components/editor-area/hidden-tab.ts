/** Whether `el` is in a tab that isn't showing. TabColumns hides a tab by
 *  moving it out of sight (tab-columns.css), not with `visibility`, so
 *  `checkVisibility()` and computed styles can't tell. */
export function isInHiddenTab(el: Element): boolean {
  return el.closest(".tab-column[data-hidden]") !== null;
}

/** The tab column holding `el`: TabColumns sets `data-hidden` on it while
 *  the tab is hidden, so watching that attribute sees it hide and show. */
export function tabColumnOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".tab-column");
}
