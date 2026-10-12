import { create } from "zustand";

/** `move-to-page` picks the page a selection moves to; see
 *  `moveSelectionToPage` in wiki-pages-extension.ts. */
export type CommandPaletteIntent = "search" | "create-file" | "move-to-page";

interface UIState {
  isCommandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  commandPaletteSearch: string;

  openCommandPalette: (intent?: CommandPaletteIntent, initialSearch?: string) => void;
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

  openCommandPalette: (intent = "search", initialSearch = "") =>
    set({
      isCommandPaletteOpen: true,
      commandPaletteIntent: intent,
      commandPaletteSearch: initialSearch,
    }),
  closeCommandPalette: () =>
    set({
      isCommandPaletteOpen: false,
      commandPaletteIntent: "search",
      commandPaletteSearch: "",
    }),
  setCommandPaletteSearch: (search: string) => set({ commandPaletteSearch: search }),

  fileTreeRenamingPath: null,
  setFileTreeRenamingPath: (path) => set({ fileTreeRenamingPath: path }),
}));
