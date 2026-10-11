import { useEffect, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import type { SearchResult } from "@/types/fs";
import {
  useCloseCommandPalette,
  useCommandPaletteIntent,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "@/hooks/use-command-palette";
import { useSidebar } from "@/hooks/use-sidebar";
import { syncAppleBooksNow } from "@/hooks/use-apple-books-sync";
import { openTodaysNote } from "@/hooks/use-daily-note";
import { useCloseWorkspace, useIsCompactFileMode, useWorkspace } from "@/hooks/use-workspace";
import {
  useActiveFilePath,
  useActiveTabId,
  useCloseActiveTab,
  useCloseTab,
  useOpenFile,
  useOpenSettingsTab,
  useOpenTabs,
} from "@/hooks/use-tabs";
import { useTheme } from "@/hooks/use-theme";
import { useFuzzySearch } from "./use-fuzzy-search";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { openStandaloneFile } from "@/hooks/use-open-drop";
import { settingsKind } from "@/components/editor-area/page-kinds/settings";
import { getFileExtension, getFileName, getFileStem, getParentDir } from "@/lib/paths";
import { safePageName } from "@/lib/wiki-pages";
import {
  cancelMoveToPage,
  completeMoveToPage,
  pendingMoveSource,
} from "@/components/editor-area/wiki-pages-extension";
import * as tauri from "@/lib/tauri";
import type { RecentFile } from "@/lib/tauri";

function toCreatePath(root: string, rawName: string) {
  const trimmed = rawName.trim();
  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  return `${root}/${fileName}`;
}

function matchesSearch(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase());
}

function HighlightedPath({ path, indices }: { path: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <span>
      {Array.from(path).map((char, i) => (
        <span key={i} className={set.has(i) ? "text-link font-semibold" : undefined}>
          {char}
        </span>
      ))}
    </span>
  );
}

function MovePageRow({ result }: { result: SearchResult }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate">{getFileStem(result.path)}</span>
      <span className="truncate text-[13px] text-text-muted">{result.relative_path}</span>
    </div>
  );
}

export function CommandPalette() {
  const isOpen = useIsCommandPaletteOpen();
  const close = useCloseCommandPalette();
  const openCommandPalette = useOpenCommandPalette();
  const intent = useCommandPaletteIntent();
  const search = useCommandPaletteSearch();
  const setSearch = useSetCommandPaletteSearch();
  const { toggleSidebar } = useSidebar();
  const { root, isIndexing, openWorkspace } = useWorkspace();
  const closeWorkspace = useCloseWorkspace();
  const openFile = useOpenFile();
  const closeActiveTab = useCloseActiveTab();
  const closeTab = useCloseTab();
  const activeTabId = useActiveTabId();
  const activeFilePath = useActiveFilePath();
  const tabs = useOpenTabs();
  const { toggleTheme } = useTheme();
  const openSettingsTab = useOpenSettingsTab();
  const isCompactFileMode = useIsCompactFileMode();

  const isCreateIntent = intent === "create-file";
  const isMoveIntent = intent === "move-to-page";
  const trimmedSearch = search.trim();
  const fileQuery = isCreateIntent ? "" : search;
  // Standalone compact windows have no workspace index — search filters the
  // global recents list client-side instead of hitting fuzzy_search.
  const results = useFuzzySearch(isCompactFileMode ? "" : fileQuery);
  const { files: globalRecents } = useGlobalRecentFiles(30, isOpen && isCompactFileMode);
  // In standalone mode new files are created next to the active file.
  const createBaseDir = root ?? (activeFilePath ? getParentDir(activeFilePath) : null);
  const createPath =
    createBaseDir && trimmedSearch ? toCreatePath(createBaseDir, trimmedSearch) : null;

  function handleSelect(path: string) {
    void (isCompactFileMode ? openStandaloneFile(path) : openFile(path));
    close();
  }

  function handleCreate() {
    if (!createPath) return;

    close();
    void (async () => {
      await tauri.createFile(createPath);
      if (isCompactFileMode) {
        await openStandaloneFile(createPath);
      } else {
        await openFile(createPath);
      }
    })();
  }

  async function handleOpenWorkspace() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      // Standalone compact windows stay pure — workspaces open elsewhere.
      if (isCompactFileMode) {
        await tauri.openWorkspaceInNewWindow(picked);
      } else {
        await openWorkspace(picked);
      }
    }
    close();
  }

  type Command = { id: string; label: string; description: string; run: () => void };

  const commands: Command[] = [
    root &&
      !isCompactFileMode && {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        description: "Command",
        run: () => {
          toggleSidebar();
          close();
        },
      },
    (root || (isCompactFileMode && activeFilePath)) && {
      id: "new-file",
      label: "Create New File",
      description: "Command",
      run: () => openCommandPalette("create-file"),
    },
    root && {
      id: "daily-note",
      label: "Open Today's Note",
      description: "Command",
      run: () => {
        void openTodaysNote();
        close();
      },
    },
    root && {
      id: "sync-apple-books",
      label: "Import Apple Books Highlights",
      description: "Command",
      run: () => {
        void syncAppleBooksNow();
        close();
      },
    },
    root &&
      activeFilePath && {
        id: "open-in-compact-window",
        label: "Open File in Compact Window",
        description: "Command",
        run: () => {
          void tauri.openFileInStandaloneWindow(activeFilePath);
          close();
        },
      },
    activeTabId &&
      !isCompactFileMode && {
        id: "close-tab",
        label: "Close Current Tab",
        description: "Command",
        run: () => {
          closeActiveTab();
          close();
        },
      },
    tabs.length > 0 &&
      !isCompactFileMode && {
        id: "close-all",
        label: "Close All Tabs",
        description: "Command",
        run: () => {
          for (const tab of tabs) closeTab(tab.id);
          close();
        },
      },
    {
      id: "open-workspace",
      label: "Open Workspace",
      description: "Command",
      run: () => void handleOpenWorkspace(),
    },
    root && {
      id: "close-workspace",
      label: "Close Workspace",
      description: "Command",
      run: () => {
        closeWorkspace();
        close();
      },
    },
    {
      id: "toggle-theme",
      label: "Toggle Dark Mode",
      description: "Command",
      run: () => {
        toggleTheme();
        close();
      },
    },
    !isCompactFileMode && {
      id: "open-settings",
      label: "Settings",
      description: settingsKind.description,
      run: () => {
        openSettingsTab();
        close();
      },
    },
  ].filter((c): c is Command => Boolean(c));

  // Move mode: markdown pages only, never the page the text is being moved
  // off. An exact name match goes first and is preselected, so typing a page's
  // name and pressing Enter picks that page; otherwise "New page" is first.
  const moveSource = isMoveIntent ? pendingMoveSource() : null;
  const newPageName = isMoveIntent ? safePageName(search) : "";
  const movePages = isMoveIntent
    ? results.filter(
        (r) =>
          r.path !== moveSource &&
          ["md", "markdown"].includes(getFileExtension(r.path).toLowerCase()),
      )
    : [];
  const exactPage = movePages.find(
    (r) => getFileStem(r.path).toLowerCase() === newPageName.toLowerCase(),
  );
  const otherMovePages = movePages.filter((r) => r !== exactPage);
  const newPageValue = "move:new";

  function handleMove(target: Parameters<typeof completeMoveToPage>[0]) {
    completeMoveToPage(target);
    close();
  }

  const visibleFiles: SearchResult[] =
    !isCreateIntent && !isMoveIntent && trimmedSearch && !isCompactFileMode ? results : [];
  const visibleRecents: RecentFile[] =
    !isCreateIntent && isCompactFileMode && trimmedSearch
      ? globalRecents.filter(
          (entry) =>
            matchesSearch(entry.title ?? "", trimmedSearch) ||
            matchesSearch(entry.name, trimmedSearch) ||
            matchesSearch(entry.path, trimmedSearch),
        )
      : [];
  const visibleCommands =
    isCreateIntent || isMoveIntent
      ? []
      : trimmedSearch
        ? commands.filter((c) => matchesSearch(c.label, trimmedSearch))
        : commands;
  const firstValue = isMoveIntent
    ? (exactPage?.path ?? (newPageName ? newPageValue : (otherMovePages[0]?.path ?? "")))
    : (visibleCommands[0]?.id ?? visibleFiles[0]?.path ?? visibleRecents[0]?.path ?? "");

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState(firstValue);

  // Snap selection + scroll to the first item whenever the search/intent
  // changes, or when async file results arrive and the first item shifts.
  // firstValue is a primitive, so this is stable across renders.
  // selectedValue is also set by cmdk onValueChange (keyboard nav) and this effect also scrolls the list — not pure derived state.
  /* eslint-disable react-doctor/no-derived-state */
  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [search, intent, firstValue]);
  /* eslint-enable react-doctor/no-derived-state */

  const placeholder = isCreateIntent
    ? "Create a new note..."
    : isMoveIntent
      ? "Move selection to page…"
      : "这是我的版本...";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (isMoveIntent) cancelMoveToPage();
          close();
        }
      }}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      <CommandList ref={listRef}>
        {isMoveIntent ? (
          <>
            {!newPageName && movePages.length === 0 && (
              <CommandEmpty>Type a page name to move the selection there.</CommandEmpty>
            )}
            {exactPage && (
              <CommandGroup heading="Add to page">
                <CommandItem
                  value={exactPage.path}
                  onSelect={() => handleMove({ kind: "existing", path: exactPage.path })}
                >
                  <MovePageRow result={exactPage} />
                </CommandItem>
              </CommandGroup>
            )}
            {newPageName && !exactPage && (
              <CommandGroup heading="New page">
                <CommandItem
                  value={newPageValue}
                  onSelect={() => handleMove({ kind: "new", name: newPageName })}
                >
                  New page: {newPageName}
                </CommandItem>
              </CommandGroup>
            )}
            {otherMovePages.length > 0 && (
              <CommandGroup heading={exactPage ? "Other pages" : "Add to page"}>
                {otherMovePages.map((r) => (
                  <CommandItem
                    key={r.path}
                    value={r.path}
                    onSelect={() => handleMove({ kind: "existing", path: r.path })}
                  >
                    <MovePageRow result={r} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : isCreateIntent ? (
          <>
            {!trimmedSearch && <CommandEmpty>Type a note name to create it.</CommandEmpty>}
            {createPath && (
              <CommandGroup heading="Create note">
                <CommandItem value={createPath} onSelect={handleCreate}>
                  Create: {getFileName(createPath)}
                </CommandItem>
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {visibleFiles.length === 0 &&
              visibleRecents.length === 0 &&
              visibleCommands.length === 0 && (
                <CommandEmpty>
                  {isIndexing && trimmedSearch && !isCompactFileMode
                    ? "Indexing workspace..."
                    : "No results found."}
                </CommandEmpty>
              )}

            {(visibleFiles.length > 0 ||
              visibleRecents.length > 0 ||
              visibleCommands.length > 0) && (
              <CommandGroup
                heading={
                  trimmedSearch ? (isIndexing ? "Results (indexing...)" : "Results") : "Suggested"
                }
              >
                {visibleCommands.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={c.run}>
                    <div className="flex flex-col">
                      <span>{c.label}</span>
                      <span className="text-[13px] text-text-muted">{c.description}</span>
                    </div>
                  </CommandItem>
                ))}

                {visibleFiles.map((r) => (
                  <CommandItem key={r.path} value={r.path} onSelect={() => handleSelect(r.path)}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{getFileName(r.path)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        <HighlightedPath path={r.relative_path} indices={r.match_indices} />
                      </span>
                    </div>
                  </CommandItem>
                ))}

                {visibleRecents.map((entry) => (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => handleSelect(entry.path)}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.title || getFileStem(entry.name)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        {getParentDir(entry.path)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
