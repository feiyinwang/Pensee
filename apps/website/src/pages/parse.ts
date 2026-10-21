/**
 * One markdown file in `content/<type>/` → one page (SPECs/website-pages-spec.md).
 * Pure: takes the file's text, so tests and the build read pages the same way.
 * Anything malformed throws with the file's name, so a typo stops the build
 * instead of shipping a page without a title.
 */
import { Lexer, marked, type Token, type Tokens } from "marked";
import { parse as parseYaml } from "yaml";

import { isPageType, pagePath, type PageType } from "./types";

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
  html: string;
  /** From the `## Questions` section: each `###` heading and the text under it. */
  questions: Question[];
  /** From the first numbered list: each item as plain text. */
  steps: string[];
}

/** What an index lists and the sitemap and llms.txt need: a page without its body. */
export type PageSummary = Omit<Page, "html" | "questions" | "steps">;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Link previews cut longer descriptions off mid-sentence. */
const DESCRIPTION_MAX = 160;

/** `content/guides/example-page.md` (or any path ending in `<type>/<slug>.md`) → page. */
export function parsePage(file: string, raw: string): Page {
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

  const tokens = Lexer.lex(raw.slice(match[0].length));

  return {
    type,
    slug,
    path: pagePath(type, slug),
    title,
    description,
    updated,
    draft,
    html: marked.parser(tokens),
    questions: findQuestions(tokens),
    steps: findSteps(tokens),
  };
}

export function summarize({
  html: _html,
  questions: _q,
  steps: _s,
  ...summary
}: Page): PageSummary {
  return summary;
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
