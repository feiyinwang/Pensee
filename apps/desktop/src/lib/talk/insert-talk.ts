import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { talkHeadingTime } from "./clock";

/**
 * Where a finished take goes in the note and what is written there
 * (SPECs/talk-notes-spec.md#the-note-after-a-stop): a `## Talk · 09:14`
 * heading and the audio embed, as a block of its own after the line the caret
 * is on, so the talk lands in the section you were in.
 */
export function talkInsertion(
  state: EditorState,
  recording: string,
  startedAt: Date,
): { from: number; insert: string } {
  const line = state.doc.lineAt(state.selection.main.head);
  const prevFilled = line.number > 1 && state.doc.line(line.number - 1).text.trim() !== "";
  const before = line.text.trim() ? "\n\n" : prevFilled ? "\n" : "";
  return {
    from: line.to,
    insert: `${before}## Talk · ${talkHeadingTime(startedAt)}\n\n![[${recording}]]\n`,
  };
}

/** Writes the take into the note; one undo takes it back out (the audio file stays in Recordings/). */
export function insertTalk(view: EditorView, recording: string, startedAt: Date): void {
  const { from, insert } = talkInsertion(view.state, recording, startedAt);
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.talk",
    scrollIntoView: true,
  });
}
