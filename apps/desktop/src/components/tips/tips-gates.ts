import { useOnboardingStore } from "@/components/onboarding/onboarding-store";
import { useUIStore } from "@/stores/ui-store";
import type { TipGates } from "./tips-store";

/** What counts as "a menu, popover or the pen's box is open": the app's
 *  menus and popovers (Radix, the block menu, autocomplete), the pen's box,
 *  and modal dialogs. Native context menus leave no trace in the DOM; a key
 *  or click right after one still holds the tip back. The board's own
 *  full-window overlay is a dialog too, but it is the board tip's page, so
 *  only modal ones count. */
const BUSY_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="menu"]',
  '[role="listbox"]',
  ".wr-bmenu-on",
  ".cm-tooltip-autocomplete",
  ".cm-pen-pop",
  ".composer-dialog",
  '[role="dialog"][aria-modal="true"]:not(.wr-board-fullscreen)',
].join(", ");

/** Whether `el` is on screen: some menus stay in the page while closed (the
 *  block menu is `hidden`), so being there is not being open. */
const shown = (el: Element) => !el.closest("[hidden]") && el.getClientRects().length > 0;

/** The app's gates: read only while a tip waits, never per keystroke. */
export const APP_TIP_GATES: TipGates = {
  busy: () =>
    useOnboardingStore.getState().open ||
    useUIStore.getState().isCommandPaletteOpen ||
    [...document.querySelectorAll(BUSY_SELECTOR)].some(shown),
};
