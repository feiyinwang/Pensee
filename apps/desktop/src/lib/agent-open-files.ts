/**
 * Gathers the text of every open tab for the agent's hidden context, plus the
 * boards those pages show. A board's SVG can carry inlined pictures, so only
 * its scene (one JSON line per node, with the node's text) is sent.
 */

import type { AgentOpenFile, AgentPeriodNote } from "@/lib/agent-context";
import { resolveDailyNoteFile } from "@/lib/daily-note";
import { PERIOD_KINDS, periodNoteStem } from "@/lib/periodic-notes";
import { serializeDocument } from "@/lib/frontmatter";
import { getParentDir, resolveImagePath } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import { visibleEditorLines } from "@/lib/editor-views";

const BOARD_SUFFIX = ".board.svg";
/** `![alt](dest)` image links whose destination is a board file. */
const BOARD_IMAGE = /!\[[^\]]*\]\(\s*<?([^)>]+?\.board\.svg)>?(?:\s+"[^"]*")?\s*\)/gi;

/** Same rule as `isBoardFile` in board-file.ts, repeated here so sending a
 *  message doesn't pull the board module into the startup bundle. */
export function isBoardPath(path: string): boolean {
  return path.split(/[?#]/)[0].toLowerCase().endsWith(BOARD_SUFFIX);
}

/** Board files a page embeds, as absolute paths. */
export function embeddedBoardPaths(pagePath: string, text: string): string[] {
  const dir = getParentDir(pagePath);
  const paths = [...text.matchAll(BOARD_IMAGE)].map((match) => resolveImagePath(match[1], dir));
  return [...new Set(paths.filter((path) => path.startsWith("/")))];
}

async function boardSceneText(raw: string): Promise<string> {
  // Board code stays out of the startup bundle; it loads on the first send
  // that actually has a board open.
  const [{ readBoardSvg }, { serializeBoard }] = await Promise.all([
    import("@/components/editor-area/board/board-file"),
    import("@/components/editor-area/board/board-model"),
  ]);
  const parsed = readBoardSvg(raw);
  return parsed ? serializeBoard(parsed.scene) : "[board with no Writer scene]";
}

interface LoadedFile {
  frontmatter: string | null;
  content: string;
}

async function readText(path: string, loaded: LoadedFile | undefined): Promise<string> {
  if (loaded && !isBoardPath(path)) return serializeDocument(loaded.frontmatter, loaded.content);
  const raw = (await tauri.readFile(path)).content;
  return isBoardPath(path) ? boardSceneText(raw) : raw;
}

/** The lines of `path` on screen, in file lines: the editor shows the body,
 *  so they shift by the frontmatter's lines above it. */
function visibleFileLines(path: string, text: string, body: string): AgentOpenFile["visible"] {
  if (isBoardPath(path) || !text.endsWith(body)) return null;
  const shown = visibleEditorLines(path);
  if (!shown) return null;
  const offset = text.slice(0, text.length - body.length).split("\n").length - 1;
  return { ...shown, fromLine: shown.fromLine + offset, toLine: shown.toLine + offset };
}

/**
 * Open tabs first, in tab order, then the boards they embed. A file that
 * can't be read is listed with the reason instead of failing the send.
 */
export async function collectAgentOpenFiles(
  paths: string[],
  loaded: Map<string, LoadedFile>,
): Promise<AgentOpenFile[]> {
  const read = async (path: string): Promise<AgentOpenFile> => {
    try {
      const file = loaded.get(path);
      const text = await readText(path, file);
      return { path, text, visible: file ? visibleFileLines(path, text, file.content) : null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { path, text: `[could not read: ${reason}]` };
    }
  };

  const tabs = await Promise.all(paths.map(read));
  const seen = new Set(paths);
  const boards = tabs
    .flatMap((file) => (isBoardPath(file.path) ? [] : embeddedBoardPaths(file.path, file.text)))
    .filter((path) => !seen.has(path) && (seen.add(path), true));
  return [...tabs, ...(await Promise.all(boards.map(read)))];
}

/**
 * The notes for the current year, quarter, month, week and day that exist,
 * broadest first. One already open as a tab is listed without its text (the
 * tab carries it). A missing note is left out; nothing is created.
 */
export async function collectAgentPeriodNotes(
  root: string,
  folder: string,
  now: Date,
  openPaths: Set<string>,
  loaded: Map<string, LoadedFile>,
): Promise<AgentPeriodNote[]> {
  const notes = await Promise.all(
    PERIOD_KINDS.map(async (kind): Promise<AgentPeriodNote | null> => {
      const resolved = resolveDailyNoteFile(root, folder, `${periodNoteStem(kind, now)}.md`);
      if (!resolved.ok) return null;
      const { path } = resolved;
      if (openPaths.has(path)) return { kind, path, text: null };
      try {
        if (!(await tauri.fileExists(path))) return null;
        return { kind, path, text: await readText(path, loaded.get(path)) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { kind, path, text: `[could not read: ${reason}]` };
      }
    }),
  );
  return notes.filter((note): note is AgentPeriodNote => note !== null);
}
