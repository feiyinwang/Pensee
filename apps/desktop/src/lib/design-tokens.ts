/**
 * Literal values of the design tokens, for code that cannot use `var()`: a
 * `.board.svg` opened outside Pensée, a canvas fill, a colour input's
 * fallback. Read from `styles/tokens.css` itself (docs/design-tokens.md), so
 * there is one source and a value changed there reaches these too.
 *
 * Only plain blocks are understood — `:root`, `[data-theme="light"]` and
 * `:root[data-theme="dark"]` — which is all tokens.css holds.
 */

import tokensCss from "@/styles/tokens.css?raw";

export type TokenMode = "light" | "dark";

type Table = Map<string, string>;

function parse(css: string): { root: Table; light: Table; dark: Table } {
  const root: Table = new Map();
  const light: Table = new Map();
  const dark: Table = new Map();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = selector.trim();
    const table =
      sel === ":root"
        ? root
        : sel === '[data-theme="light"]'
          ? light
          : sel === ':root[data-theme="dark"]'
            ? dark
            : null;
    if (!table) throw new Error(`design-tokens: unexpected selector in tokens.css: ${sel}`);
    for (const decl of body.split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const name = decl.slice(0, at).trim();
      if (name.startsWith("--"))
        table.set(
          name,
          decl
            .slice(at + 1)
            .trim()
            .replace(/\s+/g, " "),
        );
    }
  }
  return { root, light, dark };
}

const TABLES = parse(tokensCss);

/** The token's value in `mode`, with every `var()` it uses resolved. Throws on
 *  a name tokens.css does not define, so a renamed token fails loudly. */
export function tokenValue(name: string, mode: TokenMode): string {
  const lookup = (n: string): string | undefined =>
    (mode === "light" ? TABLES.light : TABLES.dark).get(n) ?? TABLES.root.get(n);
  const resolve = (n: string, depth: number): string => {
    const raw = lookup(n);
    if (raw === undefined) throw new Error(`design-tokens: ${n} is not defined in tokens.css`);
    if (depth > 20) throw new Error(`design-tokens: ${n} refers to itself`);
    return raw.replace(/var\((--[\w-]+)\)/g, (_, inner: string) => resolve(inner, depth + 1));
  };
  return resolve(name, 0);
}
