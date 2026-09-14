import { useMemo } from "react";
import { useFileContent } from "@/hooks/use-tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createHeadingSlugger } from "@/lib/heading-slug";

export interface DocumentHeading {
  /** Raw `#` count, 1–6. Slugs and anchor resolution depend on this. */
  level: number;
  /**
   * Nesting depth relative to the document, 0-based. Skipped levels collapse
   * to one step (H1 -> H3 is depth 1, not 2) and a doc that starts at H2 sits
   * at depth 0, so indentation never leaves a permanent empty gutter.
   */
  depth: number;
  text: string;
  line: number;
  pos: number;
  slug: string;
}

export interface DocumentHeadingsOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 6;
const FULL_DEPTH = 6;

export interface ParseDocumentHeadingsOptions {
  maxDepth?: number;
  slugDepth?: number;
}

// When `slugDepth > maxDepth` the slugger still walks the skipped levels so
// duplicate counts stay accurate against the doc as a whole (the rail can
// render H1–H3 while anchor resolution against the full doc still works).
export function parseDocumentHeadings(
  content: string,
  options: ParseDocumentHeadingsOptions = {},
): DocumentHeading[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const slugDepth = Math.max(maxDepth, options.slugDepth ?? maxDepth);
  const slugger = createHeadingSlugger();
  const headings: DocumentHeading[] = [];
  // Open ancestor levels. Depth is derived from the *rendered* set only, so a
  // caller that renders H1–H2 gets depths 0–1 rather than gaps where the
  // filtered-out levels used to be.
  const openLevels: number[] = [];
  let inFence = false;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let pos = 0;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/^\s+/, "");
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceLen = marker.length;
      } else if (ch === fenceChar && marker.length >= fenceLen) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
    } else if (!inFence) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        if (text && level <= slugDepth) {
          const slug = slugger(text);
          if (level <= maxDepth) {
            while (openLevels.length > 0 && openLevels[openLevels.length - 1] >= level) {
              openLevels.pop();
            }
            const depth = openLevels.length;
            openLevels.push(level);
            headings.push({ level, depth, text, line: i, pos, slug });
          }
        }
      }
    }
    pos += line.length + 1;
  }
  return headings;
}

export function buildSlugIndex(headings: DocumentHeading[]): Map<string, DocumentHeading> {
  const index = new Map<string, DocumentHeading>();
  for (const heading of headings) {
    if (!index.has(heading.slug)) index.set(heading.slug, heading);
  }
  return index;
}

// Headings feed the section rail, which doesn't need keystroke-accurate
// positions; debouncing keeps the full-document line scan off the typing path.
const HEADINGS_DEBOUNCE_MS = 150;

export function useDocumentHeadings(
  filePath: string | null,
  options: DocumentHeadingsOptions = {},
): DocumentHeading[] {
  const content = useDebouncedValue(useFileContent(filePath), HEADINGS_DEBOUNCE_MS);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  return useMemo(
    () => parseDocumentHeadings(content, { maxDepth, slugDepth: FULL_DEPTH }),
    [content, maxDepth],
  );
}
