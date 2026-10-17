import { create } from "zustand";

const DISMISS_AFTER_MS = 4000;
// A notice with an action stays long enough to reach for it.
const DISMISS_ACTION_AFTER_MS = 8000;

/** One follow-up the notice offers ("Change to paper"). */
export interface EditorNoticeAction {
  label: string;
  run: () => void;
}

interface EditorNoticeState {
  message: string | null;
  action: EditorNoticeAction | null;
  /** `stay`: shown until the next notice replaces it (work in progress). */
  showNotice: (message: string, action?: EditorNoticeAction, stay?: boolean) => void;
  dismissNotice: () => void;
}

let dismissTimer: number | null = null;

/** Transient, self-dismissing notices shown over the editor: unresolved anchor
 *  links, rejected pastes, and similar "that didn't happen, here's why" cases. */
export const useEditorNoticeStore = create<EditorNoticeState>((set, get) => ({
  message: null,
  action: null,
  showNotice: (message, action, stay = false) => {
    if (dismissTimer !== null) window.clearTimeout(dismissTimer);
    dismissTimer = null;
    set({ message, action: action ?? null });
    if (stay) return;
    dismissTimer = window.setTimeout(
      () => {
        dismissTimer = null;
        get().dismissNotice();
      },
      action ? DISMISS_ACTION_AFTER_MS : DISMISS_AFTER_MS,
    );
  },
  dismissNotice: () => {
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ message: null, action: null });
  },
}));

export function showEditorNotice(message: string, action?: EditorNoticeAction, stay?: boolean) {
  useEditorNoticeStore.getState().showNotice(message, action, stay);
}

export function dismissEditorNotice() {
  useEditorNoticeStore.getState().dismissNotice();
}
