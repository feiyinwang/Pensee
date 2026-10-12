/**
 * Gathers the text of every open tab for the agent's hidden context, plus the
 * boards those pages show. A board's SVG can carry inlined pictures, so only
 * its scene (one JSON line per node, with the node's text) is sent.
 */

import type { AgentOpenFile } from "@/lib/agent-context";
import { serializeDocument } from "@/lib/frontmatter";
import { getParentDir, resolveImagePath } from "@/lib/paths";
import * as tauri from "@/lib/tauri";

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
      return { path, text: await readText(path, loaded.get(path)) };
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
