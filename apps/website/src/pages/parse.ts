/**
 * One markdown file in `content/<type>/` → one page (SPECs/website-pages-spec.md).
 * Pure: takes the file's text, so tests and the build read pages the same way.
 * Anything malformed throws with the file's name, so a typo stops the build
 * instead of shipping a page without a title.
 */
import { Lexer, Marked, type MarkedExtension, type Token, type Tokens } from "marked";
import { parse as parseYaml } from "yaml";

import { PAINTINGS } from "../content";
import { zoomLayout } from "../zoom";
import { isPageType, pagePath, type PageType } from "./types";

/**
 * How a page ends, matched to what its reader already knows: an essay hands
 * on to the next read, a guide offers the app, a doc the install line.
 */
export const CTAS = ["read-next", "method", "try", "switch", "install"] as const;
export type Cta = (typeof CTAS)[number];

const DEFAULT_CTA: Record<PageType, Cta> = { guides: "try", docs: "install", essays: "read-next" };
/** These two hand the reader on to another page, so they need `next`. */
const NEEDS_NEXT: readonly Cta[] = ["read-next", "method"];

export type PaintingId = keyof typeof PAINTINGS;

/** Demo GIFs a page can show as `![alt](demo:<name> "caption")`: name → URL. */
export type Media = Readonly<Record<string, string>>;

export interface Question {
  question: string;
  /** The answer as plain text, for FAQPage JSON-LD. */
  answer: string;
}

export interface Page {
  type: PageType;
  slug: string;
  path: string;
  title: string;
  description: string;
  /** YYYY-MM-DD: the last real change to what the page says. */
  updated: string;
  draft: boolean;
  /** The painting the page opens on; the type's own when the page names none. */
  painting?: PaintingId;
  cta: Cta;
  /** The page `read-next` and `method` hand on to, as a path (`/guides/x/`). */
  next?: string;
  html: string;
  /** From the `## Questions` section: each `###` heading and the text under it. */
  questions: Question[];
  /** From the first numbered list: each item as plain text. */
  steps: string[];
  /** Each `##` heading and the id it links to, for the page's On this page list. */
  outline: OutlineItem[];
}

export interface OutlineItem {
  id: string;
  text: string;
}

/** What an index lists and the sitemap and llms.txt need: a page without its body. */
export type PageSummary = Omit<
  Page,
  "html" | "questions" | "steps" | "outline" | "painting" | "cta" | "next"
>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Link previews cut longer descriptions off mid-sentence. */
const DESCRIPTION_MAX = 160;

/** `content/guides/example-page.md` (or any path ending in `<type>/<slug>.md`) → page. */
export function parsePage(file: string, raw: string, media: Media = {}): Page {
  // Annotated, so TypeScript narrows after each fail(…).
  const fail: (why: string) => never = (why) => {
    throw new Error(`${file}: ${why}`);
  };

  const [name = "", folder = ""] = file.replace(/\.md$/, "").split("/").reverse();
  if (!isPageType(folder)) fail(`"${folder}" is not a page type; see src/pages/types.ts`);
  const type: PageType = folder;

  const match = FRONTMATTER.exec(raw);
  if (!match) fail("no frontmatter (--- … --- at the top)");
  const meta: unknown = parseYaml(match[1]);
  if (!isRecord(meta)) fail("frontmatter is not a set of fields");

  const field = (key: string): string => {
    const value = meta[key];
    if (typeof value !== "string" || !value.trim()) fail(`frontmatter needs "${key}"`);
    return value.trim();
  };

  const title = field("title");
  const description = field("description");
  const slug = field("slug");
  const updated = field("updated");
  const draft = meta.draft ?? false;

  if (!SLUG.test(slug)) fail(`slug "${slug}" must be lowercase words joined by hyphens`);
  if (slug !== name) fail(`slug "${slug}" must match the file name "${name}.md"`);
  if (!DATE.test(updated)) fail(`updated "${updated}" must be YYYY-MM-DD`);
  if (description.length > DESCRIPTION_MAX) {
    fail(`description is ${description.length} characters; keep it to ${DESCRIPTION_MAX}`);
  }
  if (typeof draft !== "boolean") fail("draft must be true or false");

  const optional = (key: string): string | undefined =>
    meta[key] === undefined ? undefined : field(key);

  const painting = optional("painting");
  if (painting !== undefined && !isPaintingId(painting)) {
    fail(`painting "${painting}" is not in PAINTINGS (src/content.ts)`);
  }
  const cta = optional("cta") ?? DEFAULT_CTA[type];
  if (!isCta(cta)) fail(`cta "${cta}" must be one of ${CTAS.join(", ")}`);
  const next = optional("next");
  if (next !== undefined && !/^\/[a-z]+\/[a-z0-9-]+\/$/.test(next)) {
    fail(`next "${next}" must be a page path like /guides/example-page/`);
  }
  if (NEEDS_NEXT.includes(cta) && next === undefined) fail(`cta "${cta}" needs "next"`);

  const body = raw.slice(match[0].length);
  const tokens = Lexer.lex(body);
  const outline: OutlineItem[] = [];
  const html = renderBody(body, media, fail, outline);

  return {
    type,
    slug,
    path: pagePath(type, slug),
    title,
    description,
    updated,
    draft,
    painting,
    cta,
    next,
    html,
    questions: findQuestions(tokens),
    steps: findSteps(tokens),
    outline,
  };
}

export function summarize({
  html: _html,
  questions: _q,
  steps: _s,
  outline: _o,
  painting: _p,
  cta: _c,
  next: _n,
  ...summary
}: Page): PageSummary {
  return summary;
}

function isPaintingId(value: string): value is PaintingId {
  return Object.prototype.hasOwnProperty.call(PAINTINGS, value);
}

function isCta(value: string): value is Cta {
  return (CTAS as readonly string[]).includes(value);
}

const DEMO = /^demo:([a-z0-9-]+)(?:\?crop=(\d+),(\d+),(\d+),(\d+)&of=(\d+),(\d+))?$/;
const SOURCES = /<h2 id="sources">Sources<\/h2>\s*<ol>([\s\S]*?)<\/ol>/;

/**
 * Markdown → HTML, with three additions a page needs beyond plain markdown:
 *
 * - `![alt](demo:youtube "caption")` is one of the app's demo GIFs as a
 *   figure; `demo:youtube?crop=l,t,r,b&of=w,h` shows only that box of it.
 * - A code block whose info string is `md title="Note.md"` is a note file,
 *   shown with its name.
 * - `[^2]` cites the second item of the page's `## Sources` list.
 */
function renderBody(
  body: string,
  media: Media,
  fail: (why: string) => never,
  outline: OutlineItem[],
): string {
  const cited = new Set<number>();
  const extension: MarkedExtension = {
    renderer: {
      heading({ tokens, depth }) {
        // Every ## gets an id, so the On this page list and a shared link can reach it.
        if (depth !== 2) return false;
        const text = plainText(tokens);
        const base =
          text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "section";
        let id = base;
        for (let n = 2; outline.some((item) => item.id === id); n++) id = `${base}-${n}`;
        outline.push({ id, text });
        return `<h2 id="${id}">${this.parser.parseInline(tokens)}</h2>\n`;
      },
      paragraph({ tokens }) {
        // A demo alone in its paragraph is a figure, and a figure can't sit in a <p>.
        const [only] = tokens;
        if (tokens.length === 1 && only.type === "image" && only.href.startsWith("demo:")) {
          return `${this.parser.parseInline(tokens)}\n`;
        }
        return false;
      },
      image({ href, title, text }) {
        if (!href.startsWith("demo:")) return false;
        const m = DEMO.exec(href);
        if (!m) fail(`"${href}" must be demo:<name> or demo:<name>?crop=l,t,r,b&of=w,h`);
        const [, name, ...numbers] = m;
        const src = media[name];
        if (!src) fail(`no demo called "${name}"; demos are ${Object.keys(media).join(", ")}`);
        if (!text.trim()) fail(`demo "${name}" needs alt text: ![what it shows](demo:${name})`);
        const caption = title ? `<figcaption>${title}</figcaption>` : "";
        if (numbers[0] === undefined) {
          return `<figure class="demo"><div class="media"><img src="${src}" alt="${escapeAttr(text)}" loading="lazy" decoding="async"></div>${caption}</figure>`;
        }
        const [l, t, r, b, w, h] = numbers.map(Number);
        if (!(l < r && t < b && r <= w && b <= h)) fail(`crop in "${href}" is outside the GIF`);
        const z = zoomLayout({ box: [l, t, r, b], size: [w, h] });
        const img = `width:${z.width}%;height:${z.height}%;left:${z.left}%;top:${z.top}%`;
        // A crop shows at most 1.5× its real size: past that the GIF's text blurs.
        const most = Math.round((r - l) * 1.5);
        return `<figure class="demo" style="max-width:${most}px"><div class="media zoomed" style="aspect-ratio:${z.aspectRatio}"><img style="${img}" src="${src}" alt="${escapeAttr(text)}" loading="lazy" decoding="async"></div>${caption}</figure>`;
      },
      code({ text, lang }) {
        const name = /^md\s+title="([^"]+)"$/.exec(lang ?? "")?.[1];
        if (!name) return false;
        return `<figure class="file"><figcaption>${escapeHtml(name)}</figcaption><pre><code>${escapeHtml(text)}</code></pre></figure>\n`;
      },
    },
    extensions: [
      {
        name: "cite",
        level: "inline",
        start: (src) => src.indexOf("[^"),
        tokenizer(src) {
          const m = /^\[\^(\d+)\]/.exec(src);
          return m ? { type: "cite", raw: m[0], n: Number(m[1]) } : undefined;
        },
        renderer(token) {
          const n = token.n as number;
          cited.add(n);
          return `<sup class="cite"><a href="#source-${n}" aria-label="Source ${n}">${n}</a></sup>`;
        },
      },
    ],
  };

  const html = new Marked(extension).parse(body, { async: false });
  if (cited.size === 0) return html;

  const sources = SOURCES.exec(html);
  if (!sources) fail("the page cites sources ([^1]) but has no ## Sources numbered list");
  let count = 0;
  const numbered = sources[1].replace(/<li>/g, () => `<li id="source-${++count}">`);
  const missing = [...cited].filter((n) => n < 1 || n > count);
  if (missing.length) fail(`cites [^${missing.join("], [^")}] but ## Sources has ${count} items`);
  return html.replace(sources[1], numbered);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSteps(tokens: Token[]): string[] {
  const list = tokens.find((t): t is Tokens.List => t.type === "list" && t.ordered);
  return list ? list.items.map((item) => plainText(item.tokens)) : [];
}

function findQuestions(tokens: Token[]): Question[] {
  const start = tokens.findIndex(
    (t) => t.type === "heading" && t.depth === 2 && t.text.trim().toLowerCase() === "questions",
  );
  if (start === -1) return [];

  const questions: Question[] = [];
  let current: { question: string; answer: Token[] } | null = null;
  const close = () => {
    if (current) questions.push({ question: current.question, answer: plainText(current.answer) });
  };
  for (const token of tokens.slice(start + 1)) {
    if (token.type === "heading" && token.depth <= 2) break;
    if (token.type === "heading" && token.depth === 3) {
      close();
      current = { question: plainText(token.tokens ?? []), answer: [] };
    } else if (current && token.type !== "space") {
      current.answer.push(token);
    }
  }
  close();
  return questions.filter((q) => q.answer);
}

/** The words a reader sees, without markdown or HTML, for JSON-LD. */
function plainText(tokens: Token[]): string {
  const words: string[] = [];
  const walk = (list: Token[]) => {
    for (const token of list) {
      if (token.type === "html" || token.type === "space") continue;
      const children = "tokens" in token ? token.tokens : undefined;
      if (token.type === "list") walk((token as Tokens.List).items);
      else if (children?.length) walk(children);
      else if ("text" in token && typeof token.text === "string") words.push(token.text);
      if (token.type === "paragraph" || token.type === "list_item") words.push(" ");
    }
  };
  walk(tokens);
  return words.join("").replace(/\s+/g, " ").trim();
}
