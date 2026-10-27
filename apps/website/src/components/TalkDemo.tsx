import { useEffect, useRef, useState } from "react";

import { TALK_SECTION } from "../content";
import {
  CONCLUSION,
  NOTE_LINE,
  NOTE_TITLE,
  PICTURE_LABEL,
  TALK,
  TALK_LENGTH,
  TOPICS,
  type PictureKind,
} from "../talk-script";
import { TalkPicture } from "./TalkPictures";

/** A word lights every WORD_MS; a line's pieces come PIECE_MS apart once it ends. */
const WORD_MS = 200;
const LINE_GAP_MS = 650;
const PIECE_MS = 110;
const START_MS = 300;

type Rest = keyof typeof TALK_SECTION.rest;

interface State {
  /** How many topics have a tab. */
  open: number;
  sel: number;
  /** How each topic is drawn. */
  kinds: PictureKind[];
  /** Ids of the pieces said so far. */
  heard: ReadonlySet<string>;
  playing: boolean;
  /** Seconds into the take, for the pill. */
  time: number;
  view: "talk" | "note";
  /** The line being said and its last lit word. */
  line: number | null;
  lit: number;
  asking: boolean;
  /** The tab that just opened, which pops in. */
  newTab: number | null;
  /** The stage fades the picture in when the visitor redrew it. */
  fade: boolean;
  rest: Rest;
}

/* At rest the demo shows the finished talk, so it says something before
   anyone presses Play, and nothing moves on load. */
const AT_REST: State = {
  open: TOPICS.length,
  sel: 0,
  kinds: TOPICS.map((t) => t.kinds[0]),
  heard: new Set(TALK.flatMap((l) => l.draws)),
  playing: false,
  time: TALK_LENGTH,
  view: "talk",
  line: null,
  lit: -1,
  asking: false,
  newTab: null,
  fade: false,
  rest: "start",
};

const WORDS = TALK.map((l) => l.text.split(" "));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function openTopic(s: State, topic: number): State {
  if (s.open > topic) return s;
  return { ...s, open: topic + 1, sel: topic, newTab: topic, asking: false, fade: false };
}

/**
 * The homepage's Talk section: one talk the visitor plays, in the app's look
 * (SPECs/website-homepage-spec.md, "Talk section"). Play lights the line being
 * said and draws its pieces as it ends; the topic tabs, the picture buttons
 * and Stop work at rest and while it plays.
 */
export function TalkDemo() {
  const [s, setS] = useState(AT_REST);
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  function play() {
    clear();
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    setS({ ...AT_REST, open: 1, heard: new Set(), playing: true, time: 0 });
    let at = START_MS;
    TALK.forEach((line, li) => {
      const n = WORDS[li].length;
      later(at, () =>
        setS((p) => ({
          ...p,
          line: li,
          lit: -1,
          time: line.t,
          // The box follows the talk to the topic it's on, as the app does.
          ...(line.topic < p.open && line.topic !== p.sel ? { sel: line.topic, fade: false } : {}),
        })),
      );
      for (let w = 0; w < n; w++) {
        later(at + WORD_MS * w, () =>
          setS((p) => {
            const next = { ...p, lit: w, asking: p.asking || line.ask === w };
            return line.open === w ? openTopic(next, line.topic) : next;
          }),
        );
      }
      const end = at + WORD_MS * n;
      later(end, () =>
        setS((p) => ({ ...openTopic(p, line.topic), time: line.t + Math.min(4, n * 0.4) })),
      );
      line.draws.forEach((id, i) =>
        later(end + i * PIECE_MS, () => setS((p) => ({ ...p, heard: new Set(p.heard).add(id) }))),
      );
      at = end + LINE_GAP_MS;
    });
    later(at, () =>
      setS((p) => ({ ...p, playing: false, line: null, time: TALK_LENGTH, rest: "ended" })),
    );
  }

  function stop() {
    clear();
    setS((p) => ({
      ...p,
      playing: false,
      view: "note",
      line: null,
      asking: false,
      rest: "stopped",
    }));
  }

  const topic = TOPICS[s.sel];
  const kind = s.kinds[s.sel];
  const talking = s.playing && s.line !== null && s.lit < WORDS[s.line].length - 1;

  return (
    <section className="room talk" id="talk">
      <div className="room-head">
        <div>
          <div className="eyebrow tk-eyebrow">
            <span className="tk-tag">{TALK_SECTION.tag}</span>
            {TALK_SECTION.eyebrow}
          </div>
          <h2>{TALK_SECTION.title}</h2>
        </div>
        <p>{TALK_SECTION.intro}</p>
      </div>

      <div className="tk-card">
        <div className="tk-frame" data-view={s.view}>
          {s.view === "talk" ? (
            <div className="tk-talk">
              <div className="tk-bgnote" aria-hidden="true">
                <div className="tk-title">{NOTE_TITLE}</div>
                <p>{NOTE_LINE}</p>
              </div>
              <div className="tk-box">
                <div className="tk-head">
                  <div className="tk-tabs" role="group" aria-label="Topics">
                    {TOPICS.slice(0, s.open).map((t, i) => (
                      <button
                        key={t.name}
                        type="button"
                        className={i === s.newTab ? "tk-tab tk-new" : "tk-tab"}
                        aria-pressed={i === s.sel}
                        onClick={() => setS((p) => ({ ...p, sel: i, fade: false }))}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <div className="tk-status">
                    {s.asking && <span className="tk-chip">New topic?</span>}
                  </div>
                </div>
                <div className={s.fade ? "tk-stage tk-fade" : "tk-stage"}>
                  <TalkPicture key={`${s.sel}-${kind}`} topic={topic} kind={kind} heard={s.heard} />
                </div>
                <div className="tk-pics">
                  {topic.kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="tk-pic-btn"
                      aria-pressed={k === kind}
                      onClick={() =>
                        setS((p) => ({
                          ...p,
                          kinds: p.kinds.map((was, i) => (i === p.sel ? k : was)),
                          fade: true,
                        }))
                      }
                    >
                      {PICTURE_LABEL[k]}
                    </button>
                  ))}
                  {s.playing && s.open < TOPICS.length && (
                    <button
                      type="button"
                      className="tk-pic-btn tk-next"
                      onClick={() => setS((p) => ({ ...p, open: p.open + 1, newTab: p.open }))}
                    >
                      next topic
                    </button>
                  )}
                </div>
              </div>
              <div className="tk-pill">
                <span className="tk-rdot" aria-hidden="true" />
                <Trace talking={talking} />
                <span className="tk-time">{clock(s.time)}</span>
                <button type="button" className="tk-stop" onClick={stop}>
                  Stop
                </button>
              </div>
            </div>
          ) : (
            <TalkNote state={s} />
          )}
        </div>

        <div className="tk-foot">
          {s.line === null ? (
            <p className="tk-cap tk-rest">{TALK_SECTION.rest[s.rest]}</p>
          ) : (
            <p className="tk-cap">
              {WORDS[s.line].map((w, i) => (
                <span key={i} className={i <= s.lit ? "tk-w on" : "tk-w"}>
                  {w}{" "}
                </span>
              ))}
            </p>
          )}
          <button type="button" className="btn" onClick={play}>
            <span className="tk-tri" aria-hidden="true" />
            {s.playing
              ? "Play from the start"
              : s.view === "note"
                ? "Play the talk again"
                : "Play the talk"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** The note the app writes after Stop: the player, the conclusion, each topic as a board. */
function TalkNote({ state }: { state: State }) {
  return (
    <div className="tk-note">
      <div className="tk-title">{NOTE_TITLE}</div>
      <p className="tk-dim">{NOTE_LINE}</p>
      <div className="tk-h">
        Talk <small>{clock(state.time)} · in Recordings</small>
      </div>
      <div className="tk-player" aria-hidden="true">
        <span className="tk-tri" />
        <span className="tk-track" />
        <span>0:00 / {clock(state.time)}</span>
      </div>
      <p className="tk-p">
        {state.heard.has("l5")
          ? CONCLUSION
          : state.heard.size
            ? "Not sure yet about Lisbon."
            : "Nothing said yet, so nothing to draw."}
      </p>
      {TOPICS.slice(0, state.open).map((t, i) => (
        <div key={t.name}>
          <div className="tk-h3">{t.name}</div>
          <div className={state.kinds[i] === "steps" ? "tk-board tk-short" : "tk-board"}>
            <TalkPicture topic={t} kind={state.kinds[i]} heard={state.heard} />
          </div>
        </div>
      ))}
      <div className="tk-dim">
        ▸ Transcript · {TALK.filter((l) => l.t <= state.time).length} lines
      </div>
    </div>
  );
}

/**
 * The pill's trace of your voice: it rises while words come and goes flat
 * between them. It only runs while there's something to draw, and stays a
 * flat line under reduced motion.
 */
function Trace({ talking }: { talking: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(talking: boolean) => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const color = getComputedStyle(canvas).getPropertyValue("--hue-red").trim();
    const dpr = devicePixelRatio || 1;
    const hist: number[] = Array.from({ length: 44 }, () => 0);
    let on = false;
    let level = 0;
    let raf = 0;
    let last = 0;

    const draw = () => {
      const { width: w, height: h } = canvas;
      const mid = h / 2;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = "round";
      ctx.beginPath();
      hist.forEach((a, i) => {
        const x = (i / (hist.length - 1)) * w;
        const y = mid + (i % 2 ? 1 : -1) * a * (mid - 2 * dpr);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    const size = () => {
      canvas.width = Math.max(1, canvas.clientWidth * dpr);
      canvas.height = Math.max(1, canvas.clientHeight * dpr);
      draw();
    };
    const tick = (now: number) => {
      if (now - last > 55) {
        last = now;
        level += ((on ? 0.25 + Math.random() * 0.75 : 0) - level) * 0.6;
        hist.shift();
        hist.push(on ? level * (0.6 + Math.random() * 0.4) : level);
        draw();
      }
      // Once it's flat and quiet, the loop stops until the next word.
      raf = on || hist.some((a) => a > 0.01) ? requestAnimationFrame(tick) : 0;
    };
    wake.current = (t) => {
      on = t;
      if (!still && !raf) raf = requestAnimationFrame(tick);
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => wake.current(talking), [talking]);

  return <canvas ref={ref} className="tk-trace" aria-hidden="true" />;
}
