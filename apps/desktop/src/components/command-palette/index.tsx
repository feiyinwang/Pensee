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
import { toggleCalendarPanel } from "@/hooks/use-calendar-panel";
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
import { LibraryGroups, libraryGroups } from "./library-add-rows";
import { useTypedNotes } from "@/hooks/use-spaces";
import { openComposer } from "@/hooks/use-composer";
import { addLinkToLibrary, openLibraryAdd } from "@/hooks/use-library-add";
import { LIBRARY_NOTE_TYPES, parseLibraryLink } from "@/lib/library-add";
import { useBookLibrary } from "./use-book-library";
import { BookOpen } from "lucide-react";
import type { LibraryBook } from "@/lib/book-library";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { openStandaloneFile } from "@/hooks/use-open-drop";
import { BUILT_IN_SPACES } from "@/lib/spaces";
import { openSpace, spaceLocationOf } from "@/hooks/use-spaces";
import { getFileExtension, getFileName, getFileStem, getParentDir } from "@/lib/paths";
import { safePageName } from "@/lib/wiki-pages";
import {
  cancelMoveToPage,
  completeMoveToPage,
  pendingMoveSource,
} from "@/components/editor-area/wiki-pages-extension";
import * as tauri from "@/lib/tauri";
import type { RecentFile } from "@/lib/tauri";

// Read no notes when nothing in the palette needs Library's.
const NO_TYPES: readonly string[] = [];

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
        <span key={i} className={set.has(i) ? "text-[var(--color-link)] font-semibold" : undefined}>
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
      <span className="truncate text-caption text-[var(--color-text-muted)]">
        {result.relative_path}
      </span>
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
  // ⌘P: commands only, as Obsidian's command palette. ⌘O (`search`): notes
  // only, as its quick switcher (SPECs/obsidian-shortcuts-spec.md#the-system).
  const isCommandsIntent = intent === "commands";
  const isSearchIntent = intent === "search";
  const trimmedSearch = search.trim();
  const fileQuery = isSearchIntent || isMoveIntent ? search : "";
  // Standalone compact windows have no workspace index — search filters the
  // global recents list client-side instead of hitting fuzzy_search.
  const results = useFuzzySearch(isCompactFileMode ? "" : fileQuery);
  const { files: globalRecents } = useGlobalRecentFiles(
    30,
    isOpen && (isCompactFileMode || isSearchIntent),
  );
  const library = useBookLibrary(isOpen && isSearchIntent && !isCompactFileMode ? root : null);
  // In standalone mode new files are created next to the active file.
  const createBaseDir = root ?? (activeFilePath ? getParentDir(activeFilePath) : null);
  const createPath =
    createBaseDir && trimmedSearch ? toCreatePath(createBaseDir, trimmedSearch) : null;

  // "Add to Library" for a link pasted in ⌘O (SPECs/add-to-library-spec.md);
  // everything else is added from the composer.
  const wantsLibrary =
    Boolean(root) && !isCompactFileMode && intent === "search" && parseLibraryLink(search) !== null;
  const libraryNotes = useTypedNotes(wantsLibrary ? LIBRARY_NOTE_TYPES : NO_TYPES);
  const visibleLibraryGroups = wantsLibrary
    ? libraryGroups({
        query: search,
        notes: libraryNotes,
        actions: {
          addLink: (link, kind) => {
            close();
            void addLinkToLibrary(link, kind);
          },
          openNote: (path) => handleSelect(path),
        },
      })
    : [];
  const firstLibraryValue = visibleLibraryGroups[0]?.rows[0]?.value;

  function handleSelect(path: string) {
    void (isCompactFileMode ? openStandaloneFile(path) : openFile(path));
    close();
  }

  function handleOpenBook(entry: LibraryBook) {
    close();
    void import("@/lib/book-import").then(({ openLibraryBook }) => openLibraryBook(entry));
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

  /** `keys`: its shortcut, one keycap each, shown on the right. */
  type Command = { id: string; label: string; keys?: string[]; run: () => void };

  // ⌘G P Projects, ⌘G L Library, ⌘G F Files: the go key.
  const spaceCommands = BUILT_IN_SPACES.map(
    (space) =>
      Boolean(root) &&
      !isCompactFileMode && {
        id: `go-to-${space.key}`,
        label: `Go to ${space.name}`,
        keys: space.goKey ? ["⌘", "G", space.goKey.toUpperCase()] : undefined,
        run: () => {
          openSpace(spaceLocationOf(space));
          close();
        },
      },
  );

  const commands: Command[] = [
    ...spaceCommands,
    root &&
      !isCompactFileMode && {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        keys: ["⌘", "\\"],
        run: () => {
          toggleSidebar();
          close();
        },
      },
    root &&
      !isCompactFileMode && {
        id: "toggle-calendar",
        label: "Toggle Calendar",
        keys: ["⌘", "]"],
        run: () => {
          toggleCalendarPanel();
          close();
        },
      },
    (root || (isCompactFileMode && activeFilePath)) && {
      id: "new-file",
      label: "Create New File",
      keys: ["⌘", "N"],
      run: () => {
        if (isCompactFileMode) {
          openCommandPalette("create-file");
        } else {
          close();
          openComposer();
        }
      },
    },
    root && {
      id: "daily-note",
      label: "Open Today's Note",
      keys: ["⌘", "T"],
      run: () => {
        void openTodaysNote();
        close();
      },
    },
    root &&
      !isCompactFileMode && {
        id: "new-today-note",
        label: "New Note for Today",
        run: () => {
          close();
          openComposer({ today: true });
        },
      },
    root && {
      id: "import-book",
      label: "Import Book…",
      run: () => {
        close();
        void import("@/lib/book-import").then(({ pickAndImportBook }) => pickAndImportBook());
      },
    },
    root &&
      !isCompactFileMode && {
        id: "add-to-library",
        label: "Add to Library…",
        run: () => {
          close();
          openLibraryAdd();
        },
      },
    root &&
      activeFilePath && {
        id: "open-book",
        label: "Open Book",
        run: () => {
          close();
          void import("@/lib/book-import").then(({ openBookOfPage }) =>
            openBookOfPage(activeFilePath),
          );
        },
      },
    root && {
      id: "sync-apple-books",
      label: "Import Apple Books Highlights",
      run: () => {
        void syncAppleBooksNow();
        close();
      },
    },
    root &&
      activeFilePath && {
        id: "open-in-compact-window",
        label: "Open File in Compact Window",
        run: () => {
          void tauri.openFileInStandaloneWindow(activeFilePath);
          close();
        },
      },
    activeTabId &&
      !isCompactFileMode && {
        id: "close-tab",
        label: "Close Current Tab",
        keys: ["⌘", "W"],
        run: () => {
          closeActiveTab();
          close();
        },
      },
    tabs.length > 0 &&
      !isCompactFileMode && {
        id: "close-all",
        label: "Close All Tabs",
        run: () => {
          for (const tab of tabs) closeTab(tab.id);
          close();
        },
      },
    {
      id: "show-whats-new",
      label: "Show What's New",
      run: () => {
        close();
        void import("@/components/whats-new/whats-new-store")
          .then(({ showWhatsNew }) => showWhatsNew())
          .catch((error: unknown) => console.error("[whats-new] Couldn't show it:", error));
      },
    },
    root && {
      id: "show-onboarding",
      label: "Show Onboarding",
      run: () => {
        close();
        void import("@/components/onboarding/onboarding-store").then(({ showOnboarding }) =>
          showOnboarding("ai"),
        );
      },
    },
    {
      id: "open-workspace",
      label: "Open Workspace",
      run: () => void handleOpenWorkspace(),
    },
    root && {
      id: "close-workspace",
      label: "Close Workspace",
      run: () => {
        closeWorkspace();
        close();
      },
    },
    {
      id: "toggle-theme",
      label: "Toggle Dark Mode",
      run: () => {
        toggleTheme();
        close();
      },
    },
    !isCompactFileMode && {
      id: "open-settings",
      label: "Settings",
      keys: ["⌘", ","],
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
    isSearchIntent && trimmedSearch && !isCompactFileMode ? results : [];
  // Books added to the workspace (the file index is markdown-only).
  const visibleBooks: LibraryBook[] =
    isSearchIntent && trimmedSearch
      ? library.filter(
          (b) =>
            matchesSearch(b.title, trimmedSearch) ||
            matchesSearch(getFileName(b.book), trimmedSearch),
        )
      : [];
  // A compact window searches its recents; a workspace's ⌘O shows its own
  // recent notes until you type, as Obsidian's quick switcher does.
  const visibleRecents: RecentFile[] = !isSearchIntent
    ? []
    : isCompactFileMode
      ? trimmedSearch
        ? globalRecents.filter(
            (entry) =>
              matchesSearch(entry.title ?? "", trimmedSearch) ||
              matchesSearch(entry.name, trimmedSearch) ||
              matchesSearch(entry.path, trimmedSearch),
          )
        : []
      : trimmedSearch || !root
        ? []
        : globalRecents.filter((entry) => entry.path.startsWith(`${root}/`)).slice(0, 8);
  const visibleCommands = !isCommandsIntent
    ? []
    : trimmedSearch
      ? commands.filter((c) => matchesSearch(c.label, trimmedSearch))
      : commands;
  const firstValue = isMoveIntent
    ? (exactPage?.path ?? (newPageName ? newPageValue : (otherMovePages[0]?.path ?? "")))
    : (firstLibraryValue ??
      visibleCommands[0]?.id ??
      visibleBooks[0]?.book ??
      visibleFiles[0]?.path ??
      visibleRecents[0]?.path ??
      "");

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
      : isCommandsIntent
        ? "Select a command…"
        : "Find a note…";

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
            <LibraryGroups groups={visibleLibraryGroups} />
            {visibleLibraryGroups.length === 0 &&
              visibleFiles.length === 0 &&
              visibleBooks.length === 0 &&
              visibleRecents.length === 0 &&
              visibleCommands.length === 0 && (
                <CommandEmpty>
                  {isIndexing && trimmedSearch && !isCompactFileMode
                    ? "Indexing workspace..."
                    : "No results found."}
                </CommandEmpty>
              )}

            {(visibleFiles.length > 0 ||
              visibleBooks.length > 0 ||
              visibleRecents.length > 0 ||
              visibleCommands.length > 0) && (
              <CommandGroup
                heading={
                  isCommandsIntent
                    ? "Commands"
                    : trimmedSearch
                      ? isIndexing
                        ? "Results (indexing...)"
                        : "Results"
                      : "Recent"
                }
              >
                {visibleCommands.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={c.run}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.keys && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          {c.keys.map((key) => (
                            <kbd
                              key={key}
                              className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-button)] bg-[var(--color-bg-kbd)] px-1 font-[inherit] text-caption text-[var(--color-text-muted)]"
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}

                {visibleBooks.map((b) => (
                  <CommandItem key={b.book} value={b.book} onSelect={() => handleOpenBook(b)}>
                    <div className="flex min-w-0 items-center gap-2">
                      <BookOpen
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{b.title}</span>
                        <span className="truncate text-caption text-[var(--color-text-muted)]">
                          Book · {getFileName(b.book)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}

                {visibleFiles.map((r) => (
                  <CommandItem key={r.path} value={r.path} onSelect={() => handleSelect(r.path)}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{getFileName(r.path)}</span>
                      <span className="truncate text-caption text-[var(--color-text-muted)]">
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
                      <span className="truncate text-caption text-[var(--color-text-muted)]">
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
