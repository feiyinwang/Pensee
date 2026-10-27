import { useEffect, useRef, type ReactElement } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { renderStaticBoard } from "@/components/editor-area/board/board-canvas";
import { emptyScene } from "@/components/editor-area/board/board-model";
import { pictureToElements } from "@/components/editor-area/board/board-mermaid";
import { measureText } from "@/components/editor-area/board/board-render";
import { fitCharts, loadCharts } from "@/components/editor-area/board/board-chart";
import type { PictureKind } from "@/lib/talk/ask";

// What each picture button draws, shown on hover before you click it
// (SPECs/talk-notes-spec.md#which-picture): a small made-up example, drawn by
// the board renderer exactly as a topic would be, and one line on when to use
// it. Arc's tooltip timing: the first waits a moment, the next opens at once.

const EXAMPLES: Record<PictureKind, { when: string; mermaid: string }> = {
  mindmap: {
    when: "Ideas with no order, grouped into branches.",
    mermaid:
      "mindmap\n  root((Weekend trip))\n    Where\n      Lisbon\n      Porto\n    Stay\n      Small hotel\n    Do\n      Food tour\n      Surf lesson",
  },
  flowchart: {
    when: "Things done in order, left to right.",
    mermaid: "flowchart LR\n  A[Write the draft] --> B[Get feedback] --> C[Publish]",
  },
  quadrantChart: {
    when: "Options weighed on two scales.",
    mermaid:
      "quadrantChart\n  x-axis Less effort --> More effort\n  y-axis Less value --> More value\n  quadrant-1 Big bets\n  quadrant-2 Quick wins\n  Newsletter: [0.25, 0.8]\n  Podcast: [0.8, 0.7]\n  Merch: [0.7, 0.2]",
  },
  timeline: {
    when: "Plans over time, a row per workstream.",
    mermaid:
      "timeline\n  section Design\n    Mar : Sketches\n    Apr : Prototype\n  section Build\n    Apr : First version\n    May : Launch",
  },
  xychart: {
    when: "Numbers across categories or time.",
    mermaid:
      'xychart-beta\n  title "Hours a week"\n  x-axis [Writing, Reading, Email, Calls]\n  bar [14, 9, 6, 4]',
  },
};

const W = 260;
const H = 150;

function Drawing({ kind }: { kind: PictureKind }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const els = pictureToElements(EXAMPLES[kind].mermaid, measureText);
    if (!els) return;
    let live = true;
    // A chart card draws once its type has loaded.
    void loadCharts(els).then(() => {
      if (!live) return;
      fitCharts(els);
      const scene = emptyScene();
      scene.els = els;
      el.replaceChildren(renderStaticBoard(scene, W, H, (src) => src));
    });
    return () => void (live = false);
  }, [kind]);
  return <div ref={host} className="picture-preview-drawing" aria-hidden="true" />;
}

/** One shared delay window for the row of buttons. */
export function PicturePreviews({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** A picture button with its hover preview. The trigger is a wrapper, so the
 *  preview shows while the button is disabled (before the topic has a word). */
export function PicturePreview({
  kind,
  says,
  children,
}: {
  kind: PictureKind;
  says: string;
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <span className="picture-preview-trigger">{children}</span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="picture-preview"
          side="top"
          sideOffset={10}
          collisionPadding={12}
        >
          <span className="picture-preview-title">{says}</span>
          <span className="picture-preview-when">{EXAMPLES[kind].when}</span>
          <Drawing kind={kind} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
