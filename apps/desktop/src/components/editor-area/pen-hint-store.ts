import { create } from "zustand";

// What the second pen says in a note's bottom bar (SPECs/second-pen-spec.md#the-bottom-bar).
// The editor extension writes it; the footer of every pane showing the note
// reads it.

export type PenHintPart = { key: string } | { text: string } | { strong: string } | { gap: true };

export interface PenHint {
  parts: PenHintPart[];
  /** The pen is writing: the bar shows it as working. */
  busy?: boolean;
  /** The resting line, shown fainter. */
  resting?: boolean;
}

export const usePenHints = create<{ hints: Record<string, PenHint> }>(() => ({ hints: {} }));

function same(a: PenHint | undefined, b: PenHint | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b);
}

export function setPenHint(path: string, hint: PenHint | null): void {
  const { hints } = usePenHints.getState();
  if (same(hints[path], hint)) return;
  const next = { ...hints };
  if (hint) next[path] = hint;
  else delete next[path];
  usePenHints.setState({ hints: next });
}

export function usePenHint(path: string): PenHint | null {
  return usePenHints((state) => state.hints[path] ?? null);
}
