// The Arc chart inside a mermaid block (SPECs/talk-notes-spec.md#diagrams-pele-drawn-with-arc).
// Loaded with a dynamic import, so a note with no chart never pays for motion
// or Arc. `ensureArcTokens()` gives the charts Arc's tokens without touching
// the rest of the app (docs/arc.md).
import { createRoot } from "react-dom/client";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { LineChart } from "@/components/arc/line-chart/line-chart";
import { SankeyFlow } from "@/components/arc/sankey-flow/sankey-flow";
import { RadarChart } from "@/components/arc/radar-chart/radar-chart";
import { Treemap } from "@/components/arc/treemap/treemap";
import { TreeView } from "@/components/arc/tree-view/tree-view";
import { KanbanBoard } from "@/components/arc/blocks/kanban-board/kanban-board";
import { ensureArcTokens } from "./board/arc-tokens";
import type { ChartSpec } from "./pele-charts";

function Chart({ spec }: { spec: ChartSpec }) {
  switch (spec.chart) {
    case "donut":
      return <DonutChart {...spec.props} totalLabel="Total" size={220} thickness={22} />;
    case "bar":
      return <BarChart {...spec.props} showAverage={false} />;
    case "line":
      return <LineChart {...spec.props} />;
    case "sankey":
      return <SankeyFlow {...spec.props} label="Flow" height={280} particleToggle={false} />;
    case "radar":
      return <RadarChart {...spec.props} size={300} />;
    case "treemap":
      return <Treemap {...spec.props} height={260} />;
    case "tree":
      return (
        <TreeView
          nodes={spec.props.nodes}
          defaultExpandedIds={spec.props.expanded}
          aria-label="Files"
        />
      );
    case "kanban":
      return (
        <KanbanBoard
          toolbar={false}
          showIds={false}
          noun="card"
          columns={spec.props.columns}
          people={spec.props.people}
          currentUser={spec.props.people[0]?.id}
          defaultCards={spec.props.cards}
        />
      );
  }
}

/** Mounts the chart into `host`; returns the unmount. */
export function mountChart(host: HTMLElement, spec: ChartSpec): () => void {
  ensureArcTokens();
  const root = createRoot(host);
  root.render(<Chart spec={spec} />);
  return () => root.unmount();
}
