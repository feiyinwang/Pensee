import { parse } from "yaml";

import { isDailyNoteName } from "@/lib/daily-note";

const FRONTMATTER_RE = /^---\n([\s\S]*?\n)?---(?:\n|$)/;

export type TitleSource = "frontmatter" | "h1" | "none";

export interface ParsedFile {
  frontmatter: string | null;
  body: string;
}

export interface ParsedDocument extends ParsedFile {
  title: string;
  titleSource: TitleSource;
}

export function parseFrontmatter(raw: string): ParsedFile {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: raw };
  // Group captures content including trailing \n; strip it. Undefined = empty frontmatter.
  const fm = match[1] ? match[1].replace(/\n$/, "") : "";
  return { frontmatter: fm, body: raw.slice(match[0].length) };
}

export function serializeFile(frontmatter: string | null, body: string): string {
  if (frontmatter === null) return body;
  return `---\n${frontmatter}\n---\n${body}`;
}

export function parseDocument(raw: string, path?: string): ParsedDocument {
  const parsed = parseFrontmatter(raw);
  const { title, titleSource } = inferTitle(parsed.body, parsed.frontmatter, path);

  return {
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    title,
    titleSource,
  };
}

/**
 * The document's display title. `path`, when given, lets a daily note keep its
 * date as the title (an empty title falls back to the file stem everywhere it
 * is shown) instead of taking the first heading the writer adds to the day.
 */
export function inferTitle(
  body: string,
  frontmatter: string | null,
  path?: string,
): { title: string; titleSource: TitleSource } {
  if (path !== undefined && isDailyNoteName(path)) {
    return { title: "", titleSource: "none" };
  }

  const frontmatterTitle = getFrontmatterTitle(frontmatter);
  if (frontmatterTitle !== null) {
    return { title: frontmatterTitle, titleSource: "frontmatter" };
  }

  const leadingHeading = getLeadingHeadingTitle(body);
  if (leadingHeading !== null) {
    return { title: leadingHeading, titleSource: "h1" };
  }

  return { title: "", titleSource: "none" };
}

export function serializeDocument(frontmatter: string | null, body: string): string {
  return serializeFile(frontmatter, body);
}

const displayDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function getFrontmatterDisplayDate(frontmatter: string | null): string | null {
  const parsed = parseFrontmatterObject(frontmatter);
  if (parsed === null) return null;

  for (const key of ["date", "updated"]) {
    const formatted = formatFrontmatterDateValue(parsed[key]);
    if (formatted !== null) return formatted;
  }

  return null;
}

function parseFrontmatterObject(frontmatter: string | null): Record<string, unknown> | null {
  if (frontmatter === null || frontmatter.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = parse(frontmatter);
  } catch {
    return null;
  }

  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function getFrontmatterTitle(frontmatter: string | null): string | null {
  const parsed = parseFrontmatterObject(frontmatter);
  if (parsed === null) return null;

  const title = parsed.title;
  if (typeof title !== "string") return null;

  const normalized = title.trim();
  return normalized === "" ? null : normalized;
}

function getLeadingHeadingTitle(body: string): string | null {
  const afterBlankLines = body.replace(/^(?:[ \t]*\n)*/, "");
  const newlineIndex = afterBlankLines.indexOf("\n");
  const firstLine = newlineIndex === -1 ? afterBlankLines : afterBlankLines.slice(0, newlineIndex);

  const match = firstLine.match(/^#\s+(.*)$/);
  if (!match) return null;

  const title = (match[1] ?? "").replace(/\s+#+\s*$/, "").trim();
  return title === "" ? null : title;
}

function formatFrontmatterDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : displayDateFormatter.format(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    const timestamp = Date.parse(trimmed);
    if (Number.isNaN(timestamp)) return trimmed;
    return displayDateFormatter.format(new Date(timestamp));
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1_000_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.valueOf()) ? null : displayDateFormatter.format(date);
  }

  return null;
}
