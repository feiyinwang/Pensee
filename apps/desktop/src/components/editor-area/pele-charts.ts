// Which Mermaid diagrams an Arc chart draws, and the chart's props built from
// Pele's parsed model (SPECs/talk-notes-spec.md#diagrams-pele-drawn-with-arc).
// Pure data: the React side (`pele-chart-view.tsx`) loads only when a note
// holds one of these. A model an adapter can't use returns null and Pele
// draws the diagram instead.

/* eslint-disable @typescript-eslint/no-explicit-any -- Pele's parsed models are untyped per diagram type */

export type ChartSpec =
  | {
      chart: "donut";
      props: { label: string; data: { key: string; label: string; value: number }[] };
    }
  | {
      chart: "bar";
      props: {
        label: string;
        period: string;
        categoryLabel: string;
        averageLabel: string;
        data: { key: string; label: string; axisLabel: string; value: number }[];
      };
    }
  | {
      chart: "line";
      props: {
        label: string;
        series: { key: string; label: string; area: boolean }[];
        data: { key: string; label: string; axisLabel: string; values: Record<string, number> }[];
      };
    }
  | {
      chart: "sankey";
      props: {
        nodes: { id: string; label: string }[];
        links: { source: string; target: string; value: number }[];
      };
    }
  | {
      chart: "radar";
      props: {
        label: string;
        max: number;
        rings: number;
        axes: { key: string; label: string }[];
        series: { key: string; label: string; values: Record<string, number> }[];
      };
    }
  | { chart: "treemap"; props: { label: string; data: TreemapNode } }
  | { chart: "tree"; props: { nodes: TreeNode[]; expanded: string[] } }
  | {
      chart: "kanban";
      props: {
        columns: { id: string; name: string }[];
        people: { id: string; name: string }[];
        cards: { id: string; title: string; column: string; assignee: string; label?: string }[];
      };
    };

export interface TreemapNode {
  id: string;
  label: string;
  value?: number;
  children?: TreemapNode[];
}
export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

/** Arc's radar compares up to three profiles; more than that, Pele draws it. */
const RADAR_MAX_SERIES = 3;

const idOf = (n: any): string => (typeof n === "string" ? n : String(n?.id ?? ""));

function pie(m: any): ChartSpec | null {
  const entries: [string, number][] =
    m.sections instanceof Map ? [...m.sections.entries()] : Object.entries(m.sections ?? {});
  if (!entries.length) return null;
  return {
    chart: "donut",
    props: {
      label: m.title || "Share",
      data: entries.map(([k, v]) => ({ key: k, label: k, value: Number(v) })),
    },
  };
}

function xy(m: any): ChartSpec | null {
  const cats: string[] = m.xAxis?.categories ?? [];
  const plots: { type: string; title: string; data: [string, number][] }[] = m.plots ?? [];
  if (!plots.length || !cats.length) return null;
  const at = (p: (typeof plots)[number], c: string, i: number) =>
    Number((p.data.find((d) => d[0] === c) ?? p.data[i] ?? [c, 0])[1]);
  if (plots.length === 1 && plots[0].type === "bar") {
    return {
      chart: "bar",
      props: {
        label: m.yAxis?.title || m.title || "Values",
        period: m.title || "",
        categoryLabel: m.xAxis?.title || "Category",
        // Bars across categories, not days: the headline is their average.
        averageLabel: "Average",
        data: cats.map((c, i) => ({ key: c, label: c, axisLabel: c, value: at(plots[0], c, i) })),
      },
    };
  }
  return {
    chart: "line",
    props: {
      label: m.title || "Values",
      series: plots.map((p, i) => ({
        key: `s${i}`,
        label: p.title || (p.type === "bar" ? "Bars" : "Line"),
        area: i === 0,
      })),
      data: cats.map((c, i) => ({
        key: c,
        label: c,
        axisLabel: c,
        values: Object.fromEntries(plots.map((p, j) => [`s${j}`, at(p, c, i)])),
      })),
    },
  };
}

function sankey(m: any): ChartSpec | null {
  if (!m.nodes?.length || !m.links?.length) return null;
  return {
    chart: "sankey",
    props: {
      nodes: m.nodes.map((n: any) => ({ id: idOf(n), label: idOf(n) })),
      links: m.links.map((l: any) => ({
        source: idOf(l.source),
        target: idOf(l.target),
        value: Number(l.value),
      })),
    },
  };
}

function radar(m: any): ChartSpec | null {
  if (!m.curves?.length || m.curves.length > RADAR_MAX_SERIES || !m.axes?.length) return null;
  const axes = m.axes.map((a: any) => ({ key: String(a.name), label: String(a.label || a.name) }));
  return {
    chart: "radar",
    props: {
      label: m.title || "Comparison",
      max: Number(m.options?.max ?? 5),
      rings: Math.min(Number(m.options?.ticks ?? 4), 6),
      axes,
      series: m.curves.map((c: any) => ({
        key: String(c.name),
        label: String(c.label || c.name),
        values: Object.fromEntries(
          axes.map((a: { key: string }, i: number) => [a.key, Number(c.entries?.[i] ?? 0)]),
        ),
      })),
    },
  };
}

function treemap(m: any): ChartSpec | null {
  let n = 0;
  const conv = (x: any): TreemapNode => ({
    id: `${x.name}-${n++}`,
    label: String(x.name),
    value: x.value === undefined ? undefined : Number(x.value),
    children: x.children?.length ? x.children.map(conv) : undefined,
  });
  const roots: TreemapNode[] = (m.roots ?? []).map(conv);
  if (!roots.length) return null;
  const data = roots.length === 1 ? roots[0] : { id: "all", label: "All", children: roots };
  return { chart: "treemap", props: { label: data.label, data } };
}

function treeView(m: any): ChartSpec | null {
  const conv = (x: any): TreeNode => ({
    id: String(x.id),
    label: x.description ? `${x.name} · ${x.description}` : String(x.name),
    children: x.children?.length ? x.children.map(conv) : undefined,
  });
  const nodes: TreeNode[] = (m.root?.children ?? []).map(conv);
  if (!nodes.length) return null;
  const expanded: string[] = [];
  const walk = (ns: TreeNode[]) =>
    ns.forEach((x) => x.children && (expanded.push(x.id), walk(x.children)));
  walk(nodes);
  return { chart: "tree", props: { nodes, expanded } };
}

function kanban(m: any): ChartSpec | null {
  const sections: any[] = m.sections ?? [];
  if (!sections.length) return null;
  const names = [
    ...new Set(
      sections.flatMap((s) => (s.items ?? []).map((i: any) => i.assigned).filter(Boolean)),
    ),
  ] as string[];
  const people = names.length ? names.map((p) => ({ id: p, name: p })) : [{ id: "me", name: "Me" }];
  return {
    chart: "kanban",
    props: {
      columns: sections.map((s) => ({ id: String(s.id), name: String(s.label) })),
      people,
      cards: sections.flatMap((s) =>
        (s.items ?? []).map((i: any) => ({
          id: String(i.id),
          title: String(i.label),
          column: String(s.id),
          assignee: i.assigned || people[0].id,
          label: i.ticket || undefined,
        })),
      ),
    },
  };
}

const ADAPTERS: Record<string, (model: any) => ChartSpec | null> = {
  pie,
  xychart: xy,
  sankey,
  radar,
  treemap,
  treeView,
  kanban,
};

/** The Arc chart for a parsed Pele model, or null when Pele draws it. */
export function chartFor(model: { type?: string } | null | undefined): ChartSpec | null {
  const adapter = model?.type ? ADAPTERS[model.type] : undefined;
  return adapter ? adapter(model) : null;
}
