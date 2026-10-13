import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import sidebarEntryKinds from "@shared/sidebar-entry-kinds.json";
import type { AppleBook } from "@/types/apple-books";
import type { XAccount, XBookmark } from "./x-bookmarks";
import type {
  DirEntry,
  FileContent,
  IndexStats,
  SearchResult,
  WriteResult,
  WorkspaceInfo,
} from "@/types/fs";

// Filesystem commands
export function readDirectory(path: string): Promise<DirEntry[]> {
  return invoke("read_directory", { path });
}

/** Stems of the `.md` files directly in `path`, without opening any of them
 *  (cheap on slow iCloud storage, unlike `readDirectory`). */
export function listMarkdownStems(path: string): Promise<string[]> {
  return invoke("list_markdown_stems", { path });
}

export function readRecentFiles(limit: number, offset: number): Promise<DirEntry[]> {
  return invoke("read_recent_files", { limit, offset });
}

export function readFileEntries(paths: string[]): Promise<DirEntry[]> {
  return invoke("read_file_entries", { paths });
}

export function readFile(path: string): Promise<FileContent> {
  return invoke("read_file", { path });
}

export function writeFile(path: string, content: string): Promise<WriteResult> {
  return invoke("write_file", { path, content });
}

export function createFile(path: string): Promise<FileContent> {
  return invoke("create_file", { path });
}

/** Create `path` from the new-file template only when it is missing, then return
 * the file either way. Backs the create-or-open daily note action. */
export function createFileIfMissing(path: string): Promise<FileContent> {
  return invoke("create_file_if_missing", { path });
}

export function createDirectory(path: string): Promise<DirEntry> {
  return invoke("create_directory", { path });
}

export type SidebarEntryKind = keyof typeof sidebarEntryKinds;

export function createSidebarEntry(parentPath: string, kind: SidebarEntryKind): Promise<DirEntry> {
  return invoke("create_sidebar_entry", { parentPath, kind });
}

export function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke("rename_entry", { oldPath, newPath });
}

export function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}

/** Copy a PDF/EPUB into `dir` as `<stem>.<ext>` (or `<stem> 2.<ext>`, …;
 *  never overwrites). Returns the new path. SPECs/book-reader-spec.md. */
export function importBook(sourcePath: string, dir: string, stem: string): Promise<string> {
  return invoke("import_book", { sourcePath, dir, stem });
}

/** The loopback origin that serves the YouTube player page. */
export function videoPlayerOrigin(): Promise<string> {
  return invoke("video_player_origin");
}

/** A YouTube video's chapters, read from its watch page; empty without. */
export function youtubeChapters(videoId: string): Promise<{ start: number; title: string }[]> {
  return invoke("youtube_chapters", { videoId });
}

/** A video's transcript from its captions; empty when it has none. */
export function youtubeTranscript(videoId: string): Promise<{ start: number; text: string }[]> {
  return invoke("youtube_transcript", { videoId });
}

export function fileExists(path: string): Promise<boolean> {
  return invoke("file_exists", { path });
}

/** Case-insensitive basename lookup across the workspace (gitignore-aware
 *  walk; shortest path wins on duplicates). Used by wiki image embeds. */
export function findFileByName(root: string, fileName: string): Promise<string | null> {
  return invoke("find_file_by_name", { root, fileName });
}

export function revealInFileManager(path: string): Promise<void> {
  return invoke("reveal_in_file_manager", { path });
}

// Workspace commands
export function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("open_workspace", { path });
}

export function closeWorkspace(root: string): Promise<void> {
  return invoke("close_workspace", { root });
}

export function openWorkspaceInFileManager(): Promise<void> {
  return invoke("open_workspace_in_file_manager");
}

export function openDirectoryInTerminal(path: string | null): Promise<void> {
  return invoke("open_workspace_in_terminal", { path });
}

/** Open a new in-process window for the given workspace. Each window owns
 *  its own per-window `WorkspaceState` on the Rust side (watcher, file
 *  index, settings layer) so two windows hosting different workspaces don't
 *  share file events or search results. Pass `file` to have the new window
 *  focus a specific markdown file inside the workspace. If another window
 *  already hosts `path`, that window is focused instead. */
export function openWorkspaceInNewWindow(path: string, file?: string | null): Promise<void> {
  return invoke("open_workspace_in_new_window", { path, file: file ?? null });
}

/** Bundled startup-restore IPC. Returns workspace info, root directory
 *  entries, the recents list, the persisted session, and (when available)
 *  the active tab's file content in a single round trip. */
export interface RestoreWorkspaceResponse {
  workspace: WorkspaceInfo;
  entries: DirEntry[];
  recent_workspaces: string[];
  session: SessionData | null;
  active_file: FileContent | null;
  open_file: string | null;
}

export function restoreWorkspace(path: string): Promise<RestoreWorkspaceResponse> {
  return invoke("restore_workspace", { path });
}

export async function pickWorkspace(): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Open Folder",
  });
  return selected;
}

const MARKDOWN_PICK_FILTER = { name: "Markdown", extensions: ["md", "mdx", "markdown", "txt"] };

export async function pickFile(
  filter: { name: string; extensions: string[] } = MARKDOWN_PICK_FILTER,
): Promise<string | null> {
  const selected = await openDialog({
    directory: false,
    multiple: false,
    title: "Open File",
    filters: [filter],
  });
  return selected;
}

/** Native "Save as" for an exported file; null when cancelled. */
export function pickSavePath(
  defaultPath: string,
  filter: { name: string; extensions: string[] },
): Promise<string | null> {
  return saveDialog({ defaultPath, filters: [filter], title: "Export" });
}

export function writeExportFile(path: string, dataBase64: string): Promise<void> {
  return invoke("write_export_file", { path, dataBase64 });
}

export function getRecentWorkspaces(): Promise<string[]> {
  return invoke("get_recent_workspaces");
}

export function removeRecentWorkspace(path: string): Promise<void> {
  return invoke("remove_recent_workspace", { path });
}

/** Open a markdown file in a standalone compact window (no workspace). If a
 *  standalone window already hosts the file, it is focused instead. */
export function openFileInStandaloneWindow(path: string): Promise<void> {
  return invoke("open_file_in_standalone_window", { path });
}

/** Point this window's watcher at a single standalone file (parent-dir,
 *  non-recursive). Call whenever the standalone compact window switches
 *  files. */
export function watchStandaloneFile(path: string): Promise<void> {
  return invoke("watch_standalone_file", { path });
}

// Global recents (persisted across workspaces in the app data dir)
/** A recently-opened file with its last-opened time. `opened_at` is unix
 *  seconds; `0` marks a legacy entry whose open time is unknown. */
export interface RecentFile {
  path: string;
  name: string;
  title: string | null;
  opened_at: number;
}

export function recordRecentFile(path: string): Promise<void> {
  return invoke("record_recent_file", { path });
}

export function removeRecentFile(path: string): Promise<void> {
  return invoke("remove_recent_file", { path });
}

export function getRecentFilesGlobal(limit?: number): Promise<RecentFile[]> {
  return invoke("get_recent_files_global", { limit: limit ?? null });
}

// Session commands
export interface SessionData {
  tabs?: SessionTabData[];
  active_index?: number | null;
}

export interface SerializedLocationData {
  kind: string;
  [key: string]: unknown;
}

export interface SessionTabData {
  location: SerializedLocationData;
  back: SerializedLocationData[];
  forward: SerializedLocationData[];
}

export function saveSession(
  workspaceRoot: string,
  tabs: SessionTabData[],
  activeIndex: number | null,
): Promise<void> {
  return invoke("save_session", { workspaceRoot, tabs, activeIndex });
}

export function loadSession(workspaceRoot: string): Promise<SessionData | null> {
  return invoke("load_session", { workspaceRoot });
}

// Search commands
export function indexWorkspace(): Promise<IndexStats> {
  return invoke("index_workspace");
}

export function fuzzySearch(query: string, limit?: number): Promise<SearchResult[]> {
  return invoke("fuzzy_search", { query, limit });
}

// Font commands
export interface BlockReference {
  id: string;
  path: string;
  /** 1-based. */
  line: number;
  text: string;
}

/** Every `[[Page#^id]]` / `![[Page#^id]]` naming one of `ids`, from the files
 *  on disk (open pages may hold newer, unsaved text). */
export function findBlockReferences(ids: string[]): Promise<BlockReference[]> {
  return invoke("find_block_references", { ids });
}

/** A note that declares `Type:` (SPECs/spaces-spec.md). `properties` holds the
 *  top-level scalar frontmatter keys, lower-cased; lists are joined with ", ". */
export interface TypedNote {
  path: string;
  relative_path: string;
  /** File stem. */
  name: string;
  /** Frontmatter `title:`; the file stem names the note otherwise. */
  title: string | null;
  /** The first `Type` value, as written. */
  note_type: string;
  modified_at: number;
  properties: Record<string, string>;
  /** First paragraph of body text, line breaks kept, up to 400 characters. */
  excerpt: string | null;
}

/** Notes whose `Type` is one of `types` (case-insensitive), newest edit first.
 *  `cachedOnly` answers at once from the notes read so far, opening none. */
export function listTypedNotes(types: string[], cachedOnly = false): Promise<TypedNote[]> {
  return invoke("list_typed_notes", { types, cachedOnly });
}

/** Sent every 2 s while a vault scan runs, so `cachedOnly` has more to show. */
export const NOTES_READ_EVENT = "spaces:notes-read";

export function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts");
}

// Settings commands
export function getSettings(): Promise<Record<string, unknown>> {
  return invoke("get_settings");
}

export function getSetting(key: string): Promise<unknown> {
  return invoke("get_setting", { key });
}

export function setSetting(
  key: string,
  value: unknown,
  scope: "global" | "workspace" = "global",
): Promise<unknown> {
  return invoke("set_setting", { key, value, scope });
}

export function resetSetting(key: string, scope: "global" | "workspace" = "global"): Promise<void> {
  return invoke("reset_setting", { key, scope });
}

// Pending open queue (drag-drop / CLI arg / dock open). A folder open
// carries `workspace`; a markdown-file open carries only `file` and opens
// standalone (compact window, no workspace).
export interface PendingOpenPayload {
  workspace: string | null;
  file: string | null;
}

export function takePendingOpen(): Promise<PendingOpenPayload | null> {
  return invoke("take_pending_open");
}

// Startup state (single IPC call for all initialization data). The settings
// schema is NOT included — it's a build-time constant that the frontend
// imports statically from `@/lib/settings-schema` rather than fetching over
// IPC. Rust still uses the JSON internally (config.rs::settings_schema) for
// defaults; the IPC just doesn't expose it to TS.
export interface StartupState {
  settings: Record<string, unknown>;
  recent_workspaces: string[];
  restore_bundle: RestoreWorkspaceResponse | null;
  /** Standalone compact-mode open (CLI arg / drag-drop of a markdown file).
   *  Mutually exclusive with `restore_bundle`; the single-file watcher is
   *  already running by the time this returns. */
  standalone_file: FileContent | null;
}

export function getStartupState(): Promise<StartupState> {
  return invoke("get_startup_state");
}

// Window commands
export function showMainWindow(): Promise<void> {
  return getCurrentWindow().show();
}

// Image commands
/** Copy a file that was dragged in (Finder, sidebar, anywhere) into the note's
 *  assets folder. Reading the bytes in Rust sidesteps the CSP — `connect-src`
 *  falls back to `default-src 'self'`, which blocks `fetch()` of an `asset://`
 *  URL — and keeps multi-megabyte files out of the IPC payload. */
export function importImageFile(
  markdownFilePath: string,
  sourcePath: string,
): Promise<{ relative_path: string; absolute_path: string }> {
  return invoke("import_image_file", { markdownFilePath, sourcePath });
}

/** A local file as a `data:` URL — how a `.board.svg` inlines its pictures. */
export function readFileDataUrl(path: string): Promise<string> {
  return invoke("read_file_data_url", { path });
}

/** Title, description, image and icon of a web page, read in Rust from its
 *  Open Graph / HTML head tags, and whether its headers allow framing.
 *  Absent fields are null. */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  image: string | null;
  icon: string | null;
  /** False when the site forbids being shown in a frame. */
  embeddable: boolean;
}

export function fetchLinkPreview(url: string): Promise<LinkPreview> {
  return invoke("fetch_link_preview", { url });
}

/** A research paper from the second pen's search (commands/papers.rs). */
export interface Paper {
  title: string;
  authors: string[];
  year: number | null;
  date: string | null;
  venue: string | null;
  citedBy: number;
  url: string;
  abstractText: string | null;
}

/** Papers on `query`, best first: the most cited of the last three years,
 *  then the newest of the rest. */
export function searchPapers(query: string): Promise<Paper[]> {
  return invoke("search_papers", { query });
}

/** Download the cover at `url` (an image, or a page with an Open Graph image)
 *  into the note's `<stem>-assets` folder; returns its path relative to the
 *  note's folder, e.g. `My video-assets/cover.jpg`. */
export function saveWebCover(url: string, markdownFilePath: string): Promise<string> {
  return invoke("save_web_cover", { url, markdownFilePath });
}

export function saveClipboardImage(
  markdownFilePath: string,
  imageData: number[],
  format: string,
): Promise<{ relative_path: string; absolute_path: string }> {
  return invoke("save_clipboard_image", { markdownFilePath, imageData, format });
}

/** Every Apple Books highlight, grouped by book (macOS only). Read from a temp
 *  copy of Books' databases; never writes to them. */
export function readAppleBooksHighlights(): Promise<AppleBook[]> {
  return invoke("read_apple_books_highlights");
}

/** Save the cover Apple Books shows for a book to `dest` as a JPEG. False when
 *  Books has no cover cached for it; a file already at `dest` is kept. */
export function saveAppleBooksCover(assetId: string, dest: string): Promise<boolean> {
  return invoke("save_apple_books_cover", { assetId, dest });
}

// X bookmarks (SPECs/x-bookmarks-spec.md) ------------------------------------

/** The signed-in X account, or null when X isn't connected. */
export function xAccount(): Promise<XAccount | null> {
  return invoke("x_account");
}

/** Sign in with the user's X app in the browser; resolves once X redirects back. */
export function xConnect(clientId: string): Promise<XAccount> {
  return invoke("x_connect", { clientId });
}

export function xDisconnect(): Promise<void> {
  return invoke("x_disconnect");
}

/** Bookmarks newer than any in `knownIds` or already saved for `root`, newest first. */
export function xListNewBookmarks(root: string, knownIds: string[]): Promise<XBookmark[]> {
  return invoke("x_list_new_bookmarks", { root, knownIds });
}

/** The bookmark with the rest of its author's thread. */
export function xExpandThread(bookmark: XBookmark): Promise<XBookmark> {
  return invoke("x_expand_thread", { bookmark });
}

export function xMarkSaved(root: string, ids: string[]): Promise<void> {
  return invoke("x_mark_saved", { root, ids });
}

/** Download a photo or video into the note's `<stem>-assets` folder as
 *  `<name>.<ext>`; returns its path relative to the note's folder. */
export function xSaveMedia(url: string, markdownFilePath: string, name: string): Promise<string> {
  return invoke("x_save_media", { url, markdownFilePath, name });
}
