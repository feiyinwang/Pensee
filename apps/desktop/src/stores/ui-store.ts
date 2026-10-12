import { create } from "zustand";
import type { LibraryKind } from "@/lib/library-add";

/** `move-to-page` picks the page a selection moves to; see
 *  `moveSelectionToPage` in wiki-pages-extension.ts. `add-to-library` takes a
 *  link, a title or a file for Library (SPECs/add-to-library-spec.md). */
export type CommandPaletteIntent = "search" | "create-file" | "move-to-page" | "add-to-library";

interface UIState {
  isCommandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  commandPaletteSearch: string;
  /** In `add-to-library`, the kind the Library tab it was opened from adds,
   *  listed first; null puts the link's guess (or Book) first. */
  libraryAddKind: LibraryKind | null;

  openCommandPalette: (intent?: CommandPaletteIntent, initialSearch?: string) => void;
  openLibraryAdd: (kind?: LibraryKind | null) => void;
  closeCommandPalette: () => void;
  setCommandPaletteSearch: (search: string) => void;

  /** The Files space's tree entry being renamed inline (a new file or folder
   *  made from the sidebar lands here). */
  fileTreeRenamingPath: string | null;
  setFileTreeRenamingPath: (path: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isCommandPaletteOpen: false,
  commandPaletteIntent: "search",
  commandPaletteSearch: "",
  libraryAddKind: null,

  openCommandPalette: (intent = "search", initialSearch = "") =>
    set({
      isCommandPaletteOpen: true,
      commandPaletteIntent: intent,
      commandPaletteSearch: initialSearch,
      libraryAddKind: null,
    }),
  openLibraryAdd: (kind = null) =>
    set({
      isCommandPaletteOpen: true,
      commandPaletteIntent: "add-to-library",
      commandPaletteSearch: "",
      libraryAddKind: kind,
    }),
  closeCommandPalette: () =>
    set({
      isCommandPaletteOpen: false,
      commandPaletteIntent: "search",
      commandPaletteSearch: "",
      libraryAddKind: null,
    }),
  setCommandPaletteSearch: (search: string) => set({ commandPaletteSearch: search }),

  fileTreeRenamingPath: null,
  setFileTreeRenamingPath: (path) => set({ fileTreeRenamingPath: path }),
}));
