import { create } from "zustand";
import { EMPTY_DRAFT, type ComposerDraft } from "@/lib/composer";

// The ⌘T composer's state (SPECs/composer-spec.md). The draft outlives the box:
// Esc closes it, and the next ⌘T brings the same text back.

export interface ComposerError {
  message: string;
  /** A note the error is about, for an "Open it" action. */
  path?: string;
}

interface ComposerState {
  open: boolean;
  draft: ComposerDraft;
  /** A note or day write is running: the button waits for it. */
  busy: boolean;
  error: ComposerError | null;
  /** Bumped to put the caret in the box (opening it, or ⌘T over the inline one). */
  focusTick: number;

  setOpen: (open: boolean) => void;
  setDraft: (draft: ComposerDraft) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: ComposerError | null) => void;
  requestFocus: () => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  draft: EMPTY_DRAFT,
  busy: false,
  error: null,
  focusTick: 0,

  setOpen: (open) => set({ open }),
  setDraft: (draft) => set({ draft, error: null }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  requestFocus: () => set((state) => ({ focusTick: state.focusTick + 1 })),
}));
