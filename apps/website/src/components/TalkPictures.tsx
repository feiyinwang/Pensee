import type { CSSProperties } from "react";

import type { Hue, PictureKind, Topic } from "../talk-script";

/**
 * A topic drawn as one of the board's pictures, in the app's dark look
 * (SPECs/website-homepage-spec.md, "Talk section"). A piece shows once its
 * id has been heard; it fades and settles in when it first shows.
 */
export function TalkPicture({
  topic,
  kind,
  heard,
}: {
  topic: Topic;
  kind: PictureKind;
  heard: ReadonlySet<string>;
}) {
  const on = (id: string) => (heard.has(id) ? " on" : "");
  switch (kind) {
    case "mind":
      return <MindMap topic={topic} on={on} />;
    case "matrix":
      return <Matrix topic={topic} on={on} />;
    case "steps":
      return <Steps topic={topic} on={on} />;
    case "timeline":
      return <Timeline topic={topic} on={on} />;
    case "bar":
      return <BarChart topic={topic} heard={heard} on={on} />;
  }
}

type On = (id: string) => string;
const hue = (h: Hue, extra?: CSSProperties) =>
  ({ "--tk-h": `var(--hue-${h})`, ...extra }) as CSSProperties;

function MindMap({ topic, on }: { topic: Topic; on: On }) {
  const nodes = topic.mind ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="tk-pic tk-mind">
      <svg className="tk-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {nodes.map((n) => {
          const a = n.from ? byId.get(n.from) : undefined;
          if (!a || !n.hue) return null;
          const mx = (a.x + n.x) / 2;
          return (
            <path
              key={n.id}
              className={`tk-ed${on(n.id)}`}
              style={hue(n.hue)}
              d={`M${a.x} ${a.y} C${mx} ${a.y}, ${mx} ${n.y}, ${n.x} ${n.y}`}
            />
          );
        })}
      </svg>
      {nodes.map((n) => (
        <div
          key={n.id}
          className={`tk-nd tk-${n.kind}${n.side ? ` tk-${n.side}` : ""}${on(n.id)}`}
          style={
            n.hue
              ? hue(n.hue, { left: `${n.x}%`, top: `${n.y}%` })
              : { left: `${n.x}%`, top: `${n.y}%` }
          }
        >
          {n.label}
        </div>
      ))}
    </div>
  );
}

/* The board's steps: rounded blue cards left to right, an arrow between each. */
const STEP_X = [12.5, 37.5, 62.5, 87.5];
function Steps({ topic, on }: { topic: Topic; on: On }) {
  const steps = topic.steps ?? [];
  return (
    <div className="tk-pic tk-steps">
      {steps.map((s, i) => (
        <div
          key={s.id}
          className={`tk-nd tk-card${on(s.id)}`}
          style={{ left: `${STEP_X[i]}%`, top: "50%" }}
        >
          {s.label}
        </div>
      ))}
      {steps.slice(1).map((s, i) => (
        <i
          key={s.id}
          className={`tk-arrow tk-ed${on(s.id)}`}
          style={{ left: `${STEP_X[i] + 10}%`, width: `${STEP_X[i + 1] - STEP_X[i] - 20}%` }}
        />
      ))}
    </div>
  );
}

/* Four tinted sections, the ideas placed by their scores. */
const M = { left: 4, right: 96, top: 14, bottom: 84 };
const QUAD_TINT: [Hue, number][] = [
  ["orange", 20],
  ["green", 20],
  ["orange", 9],
  ["green", 9],
];
function Matrix({ topic, on }: { topic: Topic; on: On }) {
  const m = topic.matrix;
  if (!m) return null;
  const w = M.right - M.left;
  const h = M.bottom - M.top;
  return (
    <div className="tk-pic tk-matrix">
      {m.quads.map((q, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const [tint, amount] = QUAD_TINT[i];
        return (
          <div
            key={q}
            className={row ? "tk-quad tk-low" : "tk-quad"}
            style={{
              left: `calc(${M.left + (col * w) / 2}% + ${col * 2}px)`,
              top: `calc(${M.top + (row * h) / 2}% + ${row * 2}px)`,
              width: `calc(${w / 2}% - 2px)`,
              height: `calc(${h / 2}% - 2px)`,
              background: `color-mix(in oklab, var(--hue-${tint}) ${amount}%, var(--tk-surf))`,
            }}
          >
            {q}
          </div>
        );
      })}
      {m.points.map((p) => (
        <div
          key={p.id}
          className={`tk-pt${p.flip ? " tk-flip" : ""}${on(p.id)}`}
          style={hue(p.hue, { left: `${M.left + p.x * w}%`, top: `${M.bottom - p.y * h}%` })}
        >
          <i className="tk-dot" />
          <span>{p.label}</span>
        </div>
      ))}
      <div className="tk-axis" style={{ left: `${M.left}%`, top: `${M.top - 9}%` }}>
        ↑ {m.y}
      </div>
      <div className="tk-axis" style={{ left: `${M.left}%`, top: `${M.bottom + 4}%` }}>
        ← {m.x[0]}
      </div>
      <div className="tk-axis" style={{ right: `${100 - M.right}%`, top: `${M.bottom + 4}%` }}>
        {m.x[1]} →
      </div>
    </div>
  );
}

/* A roadmap: periods across the top, a bar per workstream, events as diamonds. */
const TL = { left: 20, right: 97, rows: [28, 52, 76] };
function Timeline({ topic, on }: { topic: Topic; on: On }) {
  const tl = topic.timeline;
  if (!tl) return null;
  const x = (months: number) => TL.left + (months / tl.periods.length) * (TL.right - TL.left);
  return (
    <div className="tk-pic tk-tl">
      {tl.periods.map((p, i) => (
        <div key={p}>
          <div className="tk-tick" style={{ left: `${x(i)}%` }} />
          <div className="tk-period" style={{ left: `${x(i)}%` }}>
            {p}
          </div>
        </div>
      ))}
      {tl.rows.map((r, i) => {
        const top = `${TL.rows[i]}%`;
        return (
          <div key={r.name}>
            <div className="tk-rowname" style={{ top }}>
              {r.name}
            </div>
            <div
              className={`tk-tbar tk-ed${on(r.events[0].id)}`}
              style={hue(r.hue, { left: `${x(r.from)}%`, width: `${x(r.to) - x(r.from)}%`, top })}
            />
            {r.events.map((e) => (
              <div
                key={e.id}
                className={`tk-ev${on(e.id)}`}
                style={hue(r.hue, { left: `${x(e.at)}%`, top })}
              >
                <i />
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* A chart card: its average over round-topped blue bars, redrawn as numbers come. */
const BAR_MAX = 1600;
const euro = (n: number) => `€${n.toLocaleString("en")}`;
function BarChart({ topic, heard, on }: { topic: Topic; heard: ReadonlySet<string>; on: On }) {
  const chart = topic.bar;
  if (!chart) return null;
  const shown = chart.bars.filter((b) => heard.has(b.id));
  const average = shown.length
    ? euro(Math.round(shown.reduce((a, b) => a + b.value, 0) / shown.length))
    : "–";
  return (
    <div className="tk-pic">
      <div className="tk-chart">
        <div>
          <div className="tk-ttl">{chart.title} · average</div>
          <div className="tk-avg">{average}</div>
        </div>
        <div className="tk-plot">
          {chart.bars.map((b) => (
            <div key={b.id} className={`tk-bcol${on(b.id)}`}>
              <span className="tk-bval">{euro(b.value)}</span>
              <div className="tk-bar" style={{ height: `${(b.value / BAR_MAX) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="tk-names">
          {chart.bars.map((b) => (
            <span key={b.id}>{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
