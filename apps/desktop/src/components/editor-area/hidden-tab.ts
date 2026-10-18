/** Whether `el` is in a tab that isn't showing. TabColumns hides a tab by
 *  moving it out of sight (tab-columns.css), not with `visibility`, so
 *  `checkVisibility()` and computed styles can't tell. */
export function isInHiddenTab(el: Element): boolean {
  return el.closest(".tab-column[data-hidden]") !== null;
}
