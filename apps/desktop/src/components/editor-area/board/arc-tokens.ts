/**
 * Arc's design tokens, made safe to load inside Pensée. See `docs/arc.md`.
 *
 * `foundation.css` defines its tokens on `:root` and is meant to own the page.
 * Here it only joins the page while a board is open:
 *  - Tokens move from `:root` to `body`. Arc popovers and tooltips portal to
 *    `body`, so a narrower container would miss them.
 *  - Every Arc token name Pensée already defines (`--accent`, `--text-muted`,
 *    Tailwind's `--text-base`, …) is handed straight back to Pensée's value.
 *    The list is measured at injection time, not hard-coded, so a new Tailwind
 *    utility cannot silently start colliding.
 *  - Arc's global "no focus outlines" rule is dropped. It would strip keyboard
 *    focus from the whole app.
 *
 *  - Arc's own colour, shadow and font tokens that Pensée has no name for
 *    (`--surface`, `--border`, `--danger`, …) are pointed at Pensée's semantic
 *    tokens (`ARC_MAP`, styles/tokens.css), so a colour swapped there
 *    reaches Arc pieces too. Arc's radii and spacing stay Arc's.
 *
 * Net effect: Arc components draw in Pensée's tokens; nothing outside them
 * changes.
 */

import foundationCss from "@/components/arc/foundation.css?raw";

const STYLE_ID = "wr-arc-tokens";
const FOCUS_RULE = /:is\(\*:focus,\s*\*:focus-visible,\s*\*:focus-within\)\s*\{[^}]*\}/g;
const ROOT_SELECTOR = /:root((?:\[[^\]]*\])*)/g;

/** Arc token → the Pensée token it draws with. A container that remaps one of
 *  these (the agent panel, the projects view) still wins, being closer. */
export const ARC_MAP: Readonly<Record<string, string>> = {
  "--background": "var(--color-bg-canvas)",
  "--surface": "var(--color-bg-canvas)",
  "--surface-raised": "var(--color-bg-popover)",
  "--surface-muted": "var(--color-bg-subtle)",
  "--foreground": "var(--color-text-primary)",
  "--border": "var(--color-border-subtle)",
  "--border-subtle": "var(--color-border-subtle)",
  "--border-strong": "var(--color-border-default)",
  "--accent-foreground": "var(--color-text-inverse)",
  "--accent-strong": "var(--color-text-primary)",
  "--accent-subtle": "var(--color-bg-selected)",
  "--danger": "var(--color-status-danger)",
  "--success": "var(--color-status-success)",
  "--warning": "var(--color-status-warning)",
  "--focus-ring": "var(--color-focus)",
  "--shadow-raised": "var(--shadow-card)",
  "--shadow-floating": "var(--shadow-popover)",
  "--font-body": "var(--font-ui)",
  "--font-display": "var(--font-ui)",
};

export function arcTokenNames(css: string): string[] {
  return [...new Set(css.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) ?? [])];
}

/** `hostOwned` are the token names Pensée itself defines; they keep Pensée's
 *  values. The restore rule out-ranks Arc's `[data-theme][data-accent]` rules. */
export function scopeArcFoundation(css: string, hostOwned: string[]): string {
  const scoped = css.replace(FOCUS_RULE, "").replace(ROOT_SELECTOR, ":root$1 body");
  const host = (name: string) => `--wr-host${name.slice(1)}`;
  const capture = hostOwned.map((n) => `${host(n)}:var(${n})`).join(";");
  const restore = hostOwned.map((n) => `${n}:var(${host(n)})`).join(";");
  const mapped = Object.entries(ARC_MAP)
    .map(([arc, pensee]) => `${arc}:${pensee}`)
    .join(";");
  return [
    scoped,
    `:root{${capture}}`,
    `:root:root:root body{${restore}${restore ? ";" : ""}${mapped}}`,
    "",
  ].join("\n");
}

export function ensureArcTokens(): void {
  if (document.getElementById(STYLE_ID)) return;
  const root = getComputedStyle(document.documentElement);
  const hostOwned = arcTokenNames(foundationCss).filter(
    (name) => root.getPropertyValue(name).trim() !== "",
  );
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = scopeArcFoundation(foundationCss, hostOwned);
  document.head.append(style);
}
