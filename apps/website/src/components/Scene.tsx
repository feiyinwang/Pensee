import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import atomic from "../../../desktop/src/components/onboarding/assets/atomic.jpg";
import bird from "../../../desktop/src/components/onboarding/assets/bird.jpg";
import creativeAct from "../../../desktop/src/components/onboarding/assets/creative-act.jpg";
import secondBrain from "../../../desktop/src/components/onboarding/assets/second-brain.jpg";
import smartNotes from "../../../desktop/src/components/onboarding/assets/smart-notes.jpg";
import strunk from "../../../desktop/src/components/onboarding/assets/strunk.jpg";
import type { SceneId } from "../content";

/** Every scene's motion ends by about 2.4s; the rest of the cycle holds the end state. */
const CYCLE_MS = 5000;

/**
 * Small demos, drawn in the app's dark look, for features without a README
 * GIF. Like the GIFs they repeat: each plays when most of it is on screen and
 * replays every CYCLE_MS while it stays there. The CSS holds the end state as
 * the base style, so reduced motion (and no JS) just shows it, still.
 */
export function Scene({ id, label }: { id: SceneId; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [played, setPlayed] = useState(false);
  const [inView, setInView] = useState(false);
  // Bumping the key remounts the scene's nodes, which restarts their animations.
  const [run, setRun] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        setInView(visible);
        if (visible) setPlayed(true);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setRun((r) => r + 1), CYCLE_MS);
    return () => clearInterval(t);
  }, [inView]);

  const Body = SCENES[id];
  return (
    <div ref={ref} className={played ? "sc play" : "sc"} role="img" aria-label={label}>
      <Body key={run} />
    </div>
  );
}

const at = (s: number): CSSProperties => ({ animationDelay: `${s}s` });
const Chip = ({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) => (
  <span className={`chip ${className}`} style={style}>
    {children}
  </span>
);

function Library() {
  const books: [string, string, string][] = [
    [bird, "Bird by Bird", "Anne Lamott"],
    [smartNotes, "How to Take Smart Notes", "Sönke Ahrens"],
    [atomic, "Atomic Habits", "James Clear"],
    [creativeAct, "The Creative Act", "Rick Rubin"],
    [secondBrain, "Building a Second Brain", "Tiago Forte"],
    [strunk, "The Elements of Style", "Strunk & White"],
  ];
  return (
    <div className="sc-in lib">
      <div className="lib-top">
        <span className="h1">Library</span>
        <span className="lib-tabs m">
          <span className="on">Books 6</span>
          <span>Videos 1</span>
          <span>Podcasts 1</span>
          <span>Papers 1</span>
        </span>
      </div>
      <div className="lib-grid">
        {books.map(([src, title, author], j) => (
          <figure key={title} style={at(0.15 + j * 0.05)}>
            <img src={src} alt="" loading="lazy" />
            <figcaption>
              {title}
              <span>{author}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <Chip className="sync">Apple Books · 212 highlights synced</Chip>
    </div>
  );
}

/**
 * The Projects board as the app draws it (components/spaces/project-views.tsx):
 * a lane per status, each headed by its status tag in the status's colour
 * (To-do gray, Ongoing blue, Done green; No status untagged) and a count.
 * A card moves from Ongoing to Done.
 */
function Projects() {
  const card = (title: string, due?: string, className = "") => (
    <div className={`card ${className}`}>
      <div className="title">{title}</div>
      {due && <span className="tag due">{due}</span>}
    </div>
  );
  const head = (label: string, tone: string | null, before: number, after = before) => (
    <div className="head">
      {tone ? (
        <span className={`tag ${tone}`}>{label}</span>
      ) : (
        <span className="none">{label}</span>
      )}
      <span className="count">
        {before === after ? (
          before
        ) : (
          <>
            <span className="was">{before}</span>
            <span className="now">{after}</span>
          </>
        )}
      </span>
    </div>
  );
  return (
    <div className="sc-in prj">
      <div className="top">
        <span className="h1">Projects</span>
        <span className="views">
          <span>List</span>
          <span className="on">Kanban</span>
          <span>Timeline</span>
        </span>
      </div>
      <div className="lanes">
        <div className="lane">
          {head("No status", null, 1)}
          <div className="well">{card("Podcast with Ana")}</div>
        </div>
        <div className="lane">
          {head("To-do", "gray", 2)}
          <div className="well">
            {card("Essay on note-taking", "Due Fri")}
            {card("Read 12 books on attention")}
          </div>
        </div>
        <div className="lane">
          {head("Ongoing", "blue", 2, 1)}
          <div className="well">
            <div className="slot" />
            {card("Move notes out of Notion")}
          </div>
        </div>
        <div className="lane">
          {head("Done", "green", 1, 2)}
          <div className="well">
            <div className="slot" />
            {card("Set up the vault")}
          </div>
        </div>
        {card("Newsletter #4", undefined, "mover")}
      </div>
    </div>
  );
}

function Calendar() {
  const dots = new Set([2, 3, 6, 8, 9, 13, 14, 15, 16]);
  return (
    <div className="sc-in cal">
      <div className="note">
        <div className="h1">2026-10-19</div>
        <ul>
          <li>Finished the Strunk chapter on omitting needless words.</li>
          <li>Pinned 3 moments in the Huberman episode on dopamine.</li>
          <li>Board for the note-taking essay: 6 cards, 2 arrows.</li>
          <li>Tomorrow: reread Bird by Bird highlights.</li>
        </ul>
      </div>
      <div className="side">
        <div className="mo">
          <span>October 2026</span>
          <span className="m">‹ ›</span>
        </div>
        <div className="days">
          {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => (
            <span className="dow" key={`d${i}`}>
              {x}
            </span>
          ))}
          <span />
          <span />
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
            <span key={n} className={n === 19 ? "sel" : dots.has(n) ? "dot" : undefined}>
              {n}
            </span>
          ))}
        </div>
        <div className="per">
          <Chip>2026-W43</Chip>
          <Chip>2026-10</Chip>
          <Chip>2026-Q4</Chip>
        </div>
      </div>
    </div>
  );
}

function Agent() {
  return (
    <div className="sc-in agt">
      <div className="doc">
        <div className="h1">Reading list</div>
        <p>Books I want to finish this autumn, from my notes this week.</p>
      </div>
      <div className="chat">
        <div className="head">
          <span>Agent</span>
          <span>⌘J</span>
        </div>
        <div className="me">Add the books I mentioned this week to my reading list</div>
        <div className="ai">
          Found three in your daily notes: <i>Deep Work</i>, <i>The Creative Act</i>,{" "}
          <i>Bird by Bird</i>.
        </div>
        <div className="edit">
          <Chip>Edited Reading list.md · +3 lines</Chip>
        </div>
      </div>
    </div>
  );
}

function Markdown() {
  const raw: [string, ReactNode][] = [
    ["fmk", "---"],
    [
      "",
      <>
        <span className="key">type:</span> Book
      </>,
    ],
    [
      "",
      <>
        <span className="key">author:</span> Anne Lamott
      </>,
    ],
    ["fmk", "---"],
    ["", "# Bird by Bird"],
    ["", "- Short assignments."],
    [
      "",
      <>
        - See <span className="lnk">[[How I learn]]</span>
      </>,
    ],
  ];
  return (
    <div className="sc-in md">
      <div className="raw">
        {raw.map(([className, line], j) => (
          <div className={className || undefined} key={j} style={at(0.2 + j * 0.12)}>
            {line}
          </div>
        ))}
      </div>
      <div className="ren">
        <div className="h1">Bird by Bird</div>
        <div className="props">
          <Chip>Book</Chip>
          <Chip>Anne Lamott</Chip>
        </div>
        <p>· Short assignments.</p>
        <p>
          · See <u>How I learn</u>
        </p>
      </div>
      <Chip className="path">~/Obsidian/Vault/Bird by Bird.md</Chip>
    </div>
  );
}

function Rich() {
  return (
    <div className="sc-in rich">
      <div className="flow">
        <div className="node" style={at(0.2)}>
          Collect
        </div>
        <div className="arrow" style={at(0.35)} />
        <div className="node" style={at(0.45)}>
          Write about it
        </div>
        <div className="arrow" style={at(0.6)} />
        <div className="rich-row">
          <div className="node" style={at(0.7)}>
            Understand
          </div>
          <div className="node" style={at(0.75)}>
            Link up
          </div>
        </div>
      </div>
      <div>
        <div className="math">
          e<sup>iπ</sup> + 1 = 0
        </div>
        <table>
          <thead>
            <tr>
              <th>Book</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Deep Work</td>
              <td className="n">14</td>
            </tr>
            <tr>
              <td>Bird by Bird</td>
              <td className="n">9</td>
            </tr>
            <tr>
              <td>Atomic Habits</td>
              <td className="n">21</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SCENES: Record<SceneId, () => ReactNode> = {
  library: Library,
  projects: Projects,
  calendar: Calendar,
  agent: Agent,
  markdown: Markdown,
  rich: Rich,
};
