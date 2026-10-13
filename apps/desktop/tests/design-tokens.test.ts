/**
 * Guards the single token source (docs/design-tokens.md): outside
 * `src/styles/tokens.css` and Arc's vendored files, nothing in src/ may write
 * a raw colour, a font stack, a px font size, a px radius or a px shadow. Use
 * a token. A value that cannot be one (an SVG data URL, an alpha mask) carries
 * a `token-exception: <reason>` comment on its line or just before it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { tokenValue } from "../src/lib/design-tokens";
import { SETTINGS_SCHEMA } from "../src/lib/settings-schema";

const SRC = resolve(__dirname, "../src");
const SKIP = [
  /^styles\/tokens\.css$/,
  /^components\/arc\//,
  // Held by a parallel change to the sidebar header; its one literal (the
  // wordmark's text-[16px]) moves to --font-size-heading-sm when that lands.
  /^components\/sidebar\/index\.tsx$/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Comments blanked out (newlines kept, so offsets still map to lines). A `//`
 *  only starts a comment after whitespace or at a line start, so URLs stay. */
function stripComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[ \t])\/\/[^\n]*/gm, blank);
}

const RAW_COLOUR =
  /(?<![\w&$-])#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?!\s*from )|(?<![\w-])(?:white|black)(?![\w-])/g;
const GENERIC_FONT = /["']|\b(?:serif|sans-serif|monospace|system-ui|ui-monospace|ui-sans-serif)\b/;

interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function isRing(item: string): boolean {
  return /^(inset\s+)?0 0 0 [\d.]+px\s+(var|color-mix)\(/.test(item);
}

/** Top-level comma split (commas inside parentheses stay). */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((s) => s.trim().replace(/\s+/g, " "));
}

function shadowOk(value: string): boolean {
  const v = value.trim().replace(/\s*!important$/, "");
  if (v === "none" || v === "") return true;
  return splitTop(v).every((item) => /^var\(--[\w-]+\)$/.test(item) || isRing(item));
}

function scan(file: string, original: string): Finding[] {
  const text = stripComments(original);
  const lines = original.split("\n");
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  // A `token-exception:` comment covers its own line and the statement or
  // declaration after it: through the next `;`, at most four lines on.
  const exceptedLines = new Set<number>();
  lines.forEach((line, i) => {
    if (!/token-exception:/.test(line)) return;
    exceptedLines.add(i + 1);
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      exceptedLines.add(j + 1);
      if (lines[j].includes(";")) break;
    }
  });
  const excepted = (line: number) => exceptedLines.has(line);
  const findings: Finding[] = [];
  const add = (index: number, rule: string, snippet: string) => {
    const line = lineOf(index);
    if (!excepted(line)) findings.push({ file, line, rule, text: snippet.trim().slice(0, 100) });
  };

  for (const m of text.matchAll(RAW_COLOUR)) add(m.index, "raw colour", m[0]);

  // CSS declarations (possibly spanning lines) and their camelCase twins in
  // TS style objects, which end at a comma, a brace or the line's end.
  const decls = [
    ...text.matchAll(
      /(?<![\w-])(font-family|font-size|border(?:-[a-z]+)*-radius|box-shadow)\s*:\s*([^;{}]+)/g,
    ),
    ...text.matchAll(/(?<![\w-])(fontFamily|fontSize|borderRadius|boxShadow)\s*:\s*([^,}\n]+)/g),
  ];
  for (const m of decls) {
    const prop = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["'`]|["'`]$/g, "");
    if (prop.includes("family")) {
      // Fold var(--a) and var(--a, <token>) into a token marker; a fallback
      // that is itself a token is fine, a literal stack is not.
      let rest = value;
      for (let prev = ""; prev !== rest; ) {
        prev = rest;
        rest = rest.replace(/var\(--[\w-]+(?:,\s*@)?\)/g, "@");
      }
      if (GENERIC_FONT.test(rest)) add(m.index, "font stack", m[0]);
    } else if (prop.includes("size")) {
      if (/^[\d.]+(px)?$/.test(value) && value !== "0") add(m.index, "px font size", m[0]);
    } else if (/radius/i.test(prop)) {
      const offsetsOnly = value.replace(/calc\(var\(--[\w-]+\)\s*[-+]\s*[\d.]+px\)/g, "");
      if (/\d(px|rem)\b|^[1-9]\d*$/.test(offsetsOnly)) add(m.index, "px radius", m[0]);
    } else if (!shadowOk(value)) {
      add(m.index, "px shadow", m[0]);
    }
  }

  // Tailwind arbitrary values.
  const tw =
    /(?<![\w-])(?:text-\[[\d.]+px\]|rounded(?:-[a-z]{1,2})?-\[[\d.]+(?:px|rem)\]|font-\[(?!inherit\]|family-name:var)[^\]]+\]|shadow-\[(?![^\]]*var\(--shadow)[^\]]+\])/g;
  for (const m of text.matchAll(tw)) add(m.index, "tailwind literal", m[0]);
  return findings;
}

describe("design tokens", () => {
  test("nothing outside tokens.css writes a raw colour, font, size, radius or shadow", () => {
    const findings = sourceFiles(SRC).flatMap((path) => {
      const rel = relative(SRC, path);
      if (SKIP.some((re) => re.test(rel))) return [];
      return scan(rel, readFileSync(path, "utf8"));
    });
    expect(findings.map((f) => `${f.file}:${f.line} ${f.rule}: ${f.text}`)).toEqual([]);
  });

  test("the theme defaults in settings.schema.json are the token values", () => {
    const defaultOf = (key: string) =>
      String(SETTINGS_SCHEMA.find((def) => def.key === key)?.default).toLowerCase();
    expect(defaultOf("theme.light.background")).toBe(tokenValue("--bg-base", "light"));
    expect(defaultOf("theme.light.foreground")).toBe(tokenValue("--fg-base", "light"));
    expect(defaultOf("theme.dark.background")).toBe(tokenValue("--bg-base", "dark"));
    expect(defaultOf("theme.dark.foreground")).toBe(tokenValue("--fg-base", "dark"));
  });

  test("resolves a semantic token through its primitive", () => {
    expect(tokenValue("--color-text-muted", "light")).toBe("#706d66");
    expect(tokenValue("--color-text-muted", "dark")).toBe("#8f8b85");
    expect(() => tokenValue("--no-such-token", "light")).toThrow();
  });
});
