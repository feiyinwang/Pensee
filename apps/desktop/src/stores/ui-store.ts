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
}));
