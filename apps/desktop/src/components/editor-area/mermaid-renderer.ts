import { detectType, load, parse, render, supports } from "pele/lazy";
import { LruCache } from "@/lib/lru";
import { chartFor, type ChartSpec } from "./pele-charts";

// Mermaid text → what the canvas shows (SPECs/talk-notes-spec.md#diagrams-pele-drawn-with-arc):
// an Arc chart for the types one draws, otherwise Pele's SVG, which
// `mermaid-canvas.css` draws in Arc's style through Pele's classes and CSS
// variables. Pele loads each diagram type on first use (`pele/lazy`), so a
// note without diagrams never parses the renderers; until a type has loaded
// the result is `pending` and the widget renders again when it resolves.

export type MermaidResult =
  | { svg: string; chart?: undefined; error?: undefined; pending?: undefined }
  | { chart: ChartSpec; svg?: undefined; error?: undefined; pending?: undefined }
  | { error: string; svg?: undefined; chart?: undefined; pending?: undefined }
  | { pending: Promise<void>; svg?: undefined; chart?: undefined; error?: undefined };

type Rendered = { svg: string } | { chart: ChartSpec };
const cache = new LruCache<Rendered>(50);

// Defense-in-depth: strip <script> blocks and on*= event-handler attributes
// before the SVG reaches innerHTML. Pele escapes label text, but documents
// come from external sources (Obsidian vaults, repos); the canvas also runs
// DOMPurify at the innerHTML sink.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
}

// Ids inside one SVG (markers, gradients) must not collide with another
// diagram's on the same page: prefix them with a hash of the source.
function idPrefix(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0;
  return `m${(h >>> 0).toString(36)}`;
}

// Pele measures labels to size its shapes, so it needs the font they are
// drawn in: the UI font, read from the document.
function uiFont(): string {
  if (typeof document === "undefined" || !document.body) return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

const loading = new Map<string, Promise<void>>();

/**
 * Synchronous once the diagram's type has loaded (the cache makes repeats a
 * map lookup), so `toDOM` paints the final picture in the frame the widget
 * enters the DOM. The first diagram of a type returns `pending`.
 */
export function renderMermaid(source: string): MermaidResult {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;

  const type = detectType(source);
  if (!type)
    return { error: "Unknown diagram type. The first line names it, such as flowchart or pie." };
  if (!supports(source)) {
    let pending = loading.get(type);
    if (!pending) {
      pending = load(type).then(
        () => void loading.delete(type),
        (err: unknown) => {
          loading.delete(type);
          throw err;
        },
      );
      loading.set(type, pending);
    }
    return { pending };
  }

  try {
    const model = parse(source);
    const chart = chartFor(model);
    const result: Rendered = chart
      ? { chart }
      : {
          svg: sanitizeSvg(
            render(model, { fontFamily: uiFont(), idPrefix: idPrefix(source), responsive: false })
              .svg,
          ),
        };
    cache.set(source, result);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function clearMermaidCache() {
  cache.clear();
}
