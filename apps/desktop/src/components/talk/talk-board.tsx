import { useEffect, useRef, useState } from "react";
import { renderStaticBoard } from "@/components/editor-area/board/board-canvas";
import { playAudioClipLink } from "@/components/editor-area/board/board-audio-links";
import { type MovePlace, editTopicBoard, moveTopic, useTopicBoards } from "@/lib/talk/topic-boards";
import "@/components/editor-area/board/board.css";

// A topic drawn as a board in the talk box (SPECs/talk-notes-spec.md#topic-boards):
// the board's own renderer, the one a board card in a note uses, so it looks
// exactly like your boards. Arrange a mind map right here: drag a topic onto
// another to put it under it, or onto a sibling's top or bottom edge to put
// it before or after. A click opens the board editor for everything else;
// what you say meanwhile waits and is merged when you close it, your edits kept.

/** Pointer travel before a press on a topic becomes a drag. */
const DRAG_PX = 4;
/** The top and bottom of a sibling, as a share of its height, drop before and after it. */
const EDGE = 0.3;

interface Drag {
  id: string;
  x: number;
  y: number;
  moved: boolean;
}

const topicAt = (x: number, y: number) =>
  document
    .elementFromPoint(x, y)
    ?.closest<SVGGElement>('.talk-board-surface [data-el][data-type="mind"]') ?? null;

function dropOf(
  drag: Drag & { parent?: string },
  x: number,
  y: number,
): { target: string; place: MovePlace } | null {
  const g = topicAt(x, y);
  const target = g?.getAttribute("data-el");
  if (!g || !target || target === drag.id) return null;
  const r = g.getBoundingClientRect();
  const at = (y - r.top) / r.height;
  const sibling = g.dataset.parent && g.dataset.parent === drag.parent;
  return {
    target,
    place: sibling && at < EDGE ? "before" : sibling && at > 1 - EDGE ? "after" : "child",
  };
}

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
  const drag = useRef<(Drag & { parent?: string }) | null>(null);
  const [dragging, setDragging] = useState(false);
  const board = useTopicBoards((s) => s.boards[topicKey]);
  const editing = useTopicBoards((s) => s.editing === topicKey);

  useEffect(() => {
    const el = host.current;
    if (!el || !board) return;
    // Drawn again when the box changes size: the static board is laid out in pixels.
    const draw = () => {
      el.replaceChildren(
        renderStaticBoard(board.scene, el.clientWidth || 640, el.clientHeight || 320, (src) => src),
      );
      // Each topic knows its parent, so a drop can tell a sibling from another branch.
      for (const node of board.scene.els) {
        if (node.t !== "mind" || !node.pa) continue;
        el.querySelector<SVGGElement>(`[data-el="${node.id}"]`)?.setAttribute(
          "data-parent",
          node.pa,
        );
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [board]);

  const mark = (id: string | null, cls: string) => {
    host.current?.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls));
    if (id) host.current?.querySelector(`[data-el="${id}"]`)?.classList.add(cls);
  };
  const markDrop = (to: { target: string; place: MovePlace } | null) => {
    host.current?.querySelectorAll("[data-drop]").forEach((n) => n.removeAttribute("data-drop"));
    if (to)
      host.current?.querySelector(`[data-el="${to.target}"]`)?.setAttribute("data-drop", to.place);
  };

  if (!board) return <p className="talk-diagram-note">Drawing…</p>;
  const isMap = board.scene.els.some((el) => el.t === "mind");
  return (
    <button
      type="button"
      className="talk-board"
      data-talk-board={topicKey}
      data-dragging={dragging || undefined}
      aria-label={`${label}: open the board to change it`}
      onPointerDown={(e) => {
        const g = (e.target as Element).closest?.<SVGGElement>('[data-el][data-type="mind"]');
        // The central topic stays put; a play badge is a click.
        if (!g?.dataset.parent || (e.target as Element).closest(".wr-board-pin")) return;
        drag.current = {
          id: g.getAttribute("data-el")!,
          parent: g.dataset.parent,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the system doesn't know (a synthetic one) can't be captured; the drag still works.
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
        if (!d.moved) {
          d.moved = true;
          setDragging(true);
          mark(d.id, "is-dragged");
        }
        markDrop(dropOf(d, e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d?.moved) return;
        const to = dropOf(d, e.clientX, e.clientY);
        markDrop(null);
        mark(null, "is-dragged");
        setDragging(false);
        if (to) void moveTopic(topicKey, d.id, to.target, to.place);
      }}
      onPointerCancel={() => {
        drag.current = null;
        markDrop(null);
        mark(null, "is-dragged");
        setDragging(false);
      }}
      onClick={(e) => {
        // A drag ends here too: it moved a topic, it doesn't open the board.
        const d = drag.current;
        drag.current = null;
        if (d?.moved) return;
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
            : isMap
              ? "Drag a topic onto another to move it there. What you move stays."
              : "Click to move, rename or add. What you change stays."}
      </span>
    </button>
  );
}
