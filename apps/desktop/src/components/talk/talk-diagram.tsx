import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { renderMermaid } from "@/components/editor-area/mermaid-renderer";
import { tintPeleSvg } from "@/components/editor-area/mermaid-canvas";

// One topic's diagram in the talk box: the same renderer as a mermaid block in
// the note (Pele drawn in Arc's style, or an Arc chart), fitted to the box.

export function TalkDiagram({ source, label }: { source: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const result = renderMermaid(source);

  useEffect(() => {
    if (!result.pending) return;
    let live = true;
    result.pending.then(
      () => live && redraw((n) => n + 1),
      () => live && redraw((n) => n + 1),
    );
    return () => void (live = false);
  }, [result.pending]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (result.svg) {
      el.innerHTML = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      const svg = el.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", label);
        tintPeleSvg(svg);
      }
      return;
    }
    if (!result.chart) return;
    el.replaceChildren();
    let unmount: (() => void) | null = null;
    let live = true;
    void import("@/components/editor-area/pele-chart-view").then(({ mountChart }) => {
      if (live) unmount = mountChart(el, result.chart);
    });
    return () => {
      live = false;
      unmount?.();
    };
  }, [result.svg, result.chart, label]);

  if (result.error)
    return <p className="talk-diagram-note">This topic's diagram has a mistake: {result.error}</p>;
  if (result.pending) return <p className="talk-diagram-note">Drawing…</p>;
  return <div ref={host} className={`talk-diagram pele-frame${result.chart ? " is-chart" : ""}`} />;
}
