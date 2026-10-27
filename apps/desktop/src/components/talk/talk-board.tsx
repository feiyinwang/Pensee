import { useEffect, useRef } from "react";
import { renderStaticBoard } from "@/components/editor-area/board/board-canvas";
import { playAudioClipLink } from "@/components/editor-area/board/board-audio-links";
import { editTopicBoard, useTopicBoards } from "@/lib/talk/topic-boards";
import "@/components/editor-area/board/board.css";

// A topic drawn as a board in the talk box (SPECs/talk-notes-spec.md#topic-boards):
// the board's own renderer, the one a board card in a note uses, so it looks
// exactly like your boards. A click opens it in the board editor; what you
// say meanwhile waits and is merged when you close it, your edits kept.

export function TalkBoard({
  topicKey,
  label,
  notePath,
}: {
  topicKey: string;
  label: string;
  notePath: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const board = useTopicBoards((s) => s.boards[topicKey]);
  const editing = useTopicBoards((s) => s.editing === topicKey);

  useEffect(() => {
    const el = host.current;
    if (!el || !board) return;
    // Drawn again when the box changes size: the static board is laid out in pixels.
    const draw = () =>
      el.replaceChildren(
        renderStaticBoard(board.scene, el.clientWidth || 640, el.clientHeight || 320, (src) => src),
      );
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [board]);

  if (!board) return <p className="talk-diagram-note">Drawing…</p>;
  return (
    <button
      type="button"
      className="talk-board"
      data-talk-board={topicKey}
      aria-label={`${label}: open the board to change it`}
      onClick={(e) => {
        // A node's play badge plays its part of the take; anywhere else opens the board.
        const pin = (e.target as Element).closest?.(".wr-board-pin[data-wiki]");
        if (pin && playAudioClipLink(pin.getAttribute("data-wiki") ?? "")) return;
        void editTopicBoard(topicKey, notePath).catch((error: unknown) =>
          console.error("[talk] topic board didn't open:", error),
        );
      }}
    >
      <div ref={host} className="talk-board-surface" role="img" aria-label={label} />
      <span className="talk-board-hint">
        {editing
          ? "Open in the board editor. What you say waits until you close it."
          : board.frozen
            ? "Changed by hand, so it stays as you left it. Click to edit."
            : "Click to move, rename or add. What you change stays."}
      </span>
    </button>
  );
}
