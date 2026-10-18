import { create } from "zustand";
import type { StatusColumn } from "@/lib/projects";

// The "Already a project?" popup of Add to Projects
// (SPECs/add-to-projects-spec.md#repeats): when a project Claude found may be
// one the writer has, they say whether it is the same or a new one.

export interface RepeatQuestion {
  /** The writer's words behind the project, as written. */
  line: string;
  /** The writer's project it may be, drawn as its card. */
  existing: { name: string; status: string; columns: StatusColumn[]; excerpt: string | null };
}

/** "same": nothing new is made. "new": a project of its own. */
export type RepeatAnswer = "same" | "new";

interface RepeatState {
  questions: readonly RepeatQuestion[];
  answers: RepeatAnswer[];
  resolve: ((answers: RepeatAnswer[]) => void) | null;
}

export const useRepeatStore = create<RepeatState>(() => ({
  questions: [],
  answers: [],
  resolve: null,
}));

/** Ask about each of `questions` in turn, in one popup; resolves with an
 *  answer per question. A popup already open is answered "same" for the rest
 *  of its questions first, so a second request never strands the first. */
export function askRepeats(questions: readonly RepeatQuestion[]): Promise<RepeatAnswer[]> {
  if (questions.length === 0) return Promise.resolve([]);
  closeRepeats();
  return new Promise((resolve) => useRepeatStore.setState({ questions, answers: [], resolve }));
}

/** Answer the question showing; the popup closes after the last one. */
export function answerRepeat(answer: RepeatAnswer): void {
  const { questions, answers, resolve } = useRepeatStore.getState();
  if (!resolve) return;
  const next = [...answers, answer];
  if (next.length < questions.length) {
    useRepeatStore.setState({ answers: next });
    return;
  }
  useRepeatStore.setState({ questions: [], answers: [], resolve: null });
  resolve(next);
}

/** Close the popup: every question not answered yet is "same", so nothing
 *  the writer didn't ask for is made. */
export function closeRepeats(): void {
  const { questions, answers, resolve } = useRepeatStore.getState();
  if (!resolve) return;
  useRepeatStore.setState({ questions: [], answers: [], resolve: null });
  resolve([...answers, ...questions.slice(answers.length).map(() => "same" as const)]);
}
