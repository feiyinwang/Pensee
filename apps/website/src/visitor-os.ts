import { useSyncExternalStore } from "react";

export type VisitorOs = "mac" | "windows";

const noSubscribe = () => () => {};
const detect = (): VisitorOs => (/Windows/i.test(navigator.userAgent) ? "windows" : "mac");

/**
 * The visitor's computer, so Download offers its build. Pages are prerendered,
 * so the server (and the first paint) say Mac; a Windows visitor's button
 * switches as the page hydrates.
 */
export function useVisitorOs(): VisitorOs {
  return useSyncExternalStore(noSubscribe, detect, () => "mac");
}
