import { create } from "zustand";

/** `search` is ⌘O (notes) and `commands` ⌘P (commands), as Obsidian splits
 *  them. `move-to-page` picks the page a selection moves to; see
 *  `moveSelectionToPage` in wiki-pages-extension.ts. `create-file` is the
 *  compact window's ⌘N (workspaces use the composer). */
export type CommandPaletteIntent = "search" | "commands" | "create-file" | "move-to-page";

interface UIState {
  isCommandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  commandPaletteSearch: string;

  openCommandPalette: (intent?: CommandPaletteIntent, initialSearch?: string) => void;
  closeCommandPalette: () => void;
  setCommandPaletteSearch: (search: string) => void;

  /** ⌘G was pressed and the next letter picks a place (the go key). */
  goKeyPending: boolean;
  setGoKeyPending: (pending: boolean) => void;

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

  goKeyPending: false,
  setGoKeyPending: (goKeyPending) => set({ goKeyPending }),

  fileTreeRenamingPath: null,
  setFileTreeRenamingPath: (path) => set({ fileTreeRenamingPath: path }),
}));
