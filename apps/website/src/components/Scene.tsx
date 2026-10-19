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

function Organize() {
  const messy = [
    "website needs a pricing page",
    "make a discord?? or slack",
    "answer the 4 support emails",
    "landing page copy, hero first",
    "invite the beta people to discord",
    "set up support@ inbox",
  ];
  const outline: [string, string[]][] = [
    ["Website", ["Landing page copy, hero first", "Pricing page"]],
    ["Community", ["Make a Discord", "Invite the beta people"]],
    ["Support", ["Set up the support@ inbox", "Answer the 4 emails"]],
  ];
  let i = 0;
  return (
    <div className="sc-in org">
      <div className="h1">Launch plan</div>
      <div className="pen">
        <Chip>Answer</Chip>
        <Chip>Check</Chip>
        <Chip>Connect</Chip>
        <Chip className="pill-on">Organize</Chip>
      </div>
      <div className="stack">
        <div className="lines">
          {messy.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </div>
        <div className="outline">
          {outline.flatMap(([h, items]) => [
            <div className="hd" key={h} style={at(1.75 + 0.04 * i++)}>
              {h}
            </div>,
            ...items.map((t) => (
              <div className="li" key={t} style={at(1.75 + 0.04 * i++)}>
                {t}
              </div>
            )),
          ])}
        </div>
      </div>
    </div>
  );
}

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

function Projects() {
  const card = (title: string, tag: string, className = "") => (
    <div className={`card ${className}`}>
      {title}
      <span className="m">{tag}</span>
    </div>
  );
  return (
    <div className="sc-in prj">
      <span className="h1">Projects</span>
      <div className="cols">
        <div className="col">
          <h4>
            Idea <span>2</span>
          </h4>
          {card("Essay on note-taking", "Writing")}
          {card("Podcast with Ana", "Side project")}
        </div>
        <div className="col">
          <h4>
            Doing <span>1</span>
          </h4>
          {card("Read 12 books on attention", "Reading")}
        </div>
        <div className="col">
          <h4>
            Done <span>2</span>
          </h4>
          <div className="slot" />
          {card("Move notes out of Notion", "Setup")}
        </div>
        {card("Newsletter issue #4", "Writing", "mover")}
      </div>
      <div className="fm">
        Status: <b>Done</b>
      </div>
    </div>
  );
}

function Tabs() {
  // Each tab is a note already well under way: a title and a run of bullets.
  const panes: [string, string[]][] = [
    [
      "Deep Work",
      [
        "Focus is a skill, so it can be trained.",
        "Schedule every minute; shallow work goes in blocks.",
        "Boredom is part of the training. Don’t fill every gap.",
        "Quit social media for 30 days, then see what you missed.",
        "End the day with a shutdown ritual.",
      ],
    ],
    [
      "How I learn",
      [
        "Rereading my notes is the best way to remember them.",
        "I only understand a book once I’ve written about it.",
        "Writing it in my own words shows me the gaps.",
        "Linking a note to an old one is when it sticks.",
        "Short sessions beat one long cram.",
      ],
    ],
    [
      "Bird by Bird",
      [
        "Short assignments: write what fits in a one-inch frame.",
        "Shitty first drafts are how good ones start.",
        "Perfectionism is the voice of the oppressor.",
        "Index cards in every pocket.",
        "Take it bird by bird.",
      ],
    ],
  ];
  const [, reading] = panes;
  // Starts on one tab read alone at its normal size, then pinches in to all
  // three. The two layouts cross-fade with a uniform scale, so no text stretches.
  return (
    <div className="sc-in tbs">
      <div className="one">
        <div className="h1">{reading[0]}</div>
        <ul>
          {reading[1].map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <div className="all">
        {panes.map(([title, items]) => (
          <div className="pane" key={title}>
            <div className="h1">{title}</div>
            <ul>
              {items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Chip className="tbs-hint">Pinch in: all tabs</Chip>
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
  organize: Organize,
  library: Library,
  projects: Projects,
  tabs: Tabs,
  calendar: Calendar,
  agent: Agent,
  markdown: Markdown,
  rich: Rich,
};
