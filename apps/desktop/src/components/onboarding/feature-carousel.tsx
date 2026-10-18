import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
  FEATURES,
  SCENE_W,
  playScene,
  sceneMarkup,
  stopScene,
  type FeatureId,
} from "./feature-scenes";
import type { SampleId } from "./onboarding-store";

const GAP = 22;
const VIEW = 1100;
const trackX = (i: number) => VIEW / 2 - (i * (SCENE_W + GAP) + SCENE_W / 2);
/** Past this a drag or swipe moves a slide; less, it springs back. */
const MOVE_PX = 60;

/** Which slide the sample the writer just tried belongs to. */
const TRIED: Partial<Record<SampleId, FeatureId>> = { video: "check", book: "connect" };

/**
 * The features carousel (SPECs/onboarding-spec.md, screen 4), laid out like
 * Arc's: the active slide centred, its neighbours smaller and dimmer, the
 * caption with its keys underneath, then dots and arrows. ← →, the arrows,
 * the dots, a click on a neighbour, a drag or a two-finger swipe move it; it
 * never advances on its own. The active slide's demo plays once; Replay
 * reruns it.
 */
export function FeatureCarousel({ tried }: { tried: SampleId | null }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const sceneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);

  const go = (to: number) => setIndex(Math.max(0, Math.min(FEATURES.length - 1, to)));

  // Every slide shows its first frame; the active one plays.
  useEffect(() => {
    FEATURES.forEach((f, j) => {
      const el = sceneRefs.current[j];
      if (el && j !== index) el.innerHTML = sceneMarkup(f.id);
    });
    const root = sceneRefs.current[index];
    if (!root) return;
    setDone(false);
    playScene(root, FEATURES[index]!.id, () => setDone(true));
    return stopScene;
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.altKey || event.ctrlKey) return;
      const to =
        event.key === "ArrowRight"
          ? index + 1
          : event.key === "ArrowLeft"
            ? index - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? FEATURES.length - 1
                : null;
      if (to === null) return;
      event.preventDefault();
      go(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  // Two fingers sideways: the track follows them, then settles once they
  // stop. The momentum that trails a swipe is swallowed, so one swipe moves
  // once.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let dx = 0;
    let settle = 0;
    let lock = 0;
    const scale = () => track.getBoundingClientRect().width / track.offsetWidth || 1;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (lock) {
        window.clearTimeout(lock);
        lock = window.setTimeout(() => (lock = 0), 180);
        return;
      }
      dx -= event.deltaX / scale();
      const edge = (index === 0 && dx > 0) || (index === FEATURES.length - 1 && dx < 0);
      setDragging(true);
      setOffset(dx * (edge ? 0.3 : 1));
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const steps =
          Math.abs(dx) < MOVE_PX ? 0 : Math.max(1, Math.round(Math.abs(dx) / (SCENE_W + GAP)));
        const moved = dx;
        dx = 0;
        setDragging(false);
        setOffset(0);
        if (steps) go(index + (moved < 0 ? steps : -steps));
        lock = window.setTimeout(() => (lock = 0), 180);
      }, 90);
    };
    const host = track.parentElement!;
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel);
      window.clearTimeout(settle);
      window.clearTimeout(lock);
    };
  }, [index]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const x0 = event.clientX;
    const track = event.currentTarget;
    const scale = track.getBoundingClientRect().width / track.offsetWidth || 1;
    let dx = 0;
    draggedRef.current = false;
    setDragging(true);
    const move = (e: PointerEvent) => {
      dx = (e.clientX - x0) / scale;
      if (Math.abs(dx) > 4) draggedRef.current = true;
      setOffset(dx);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      setOffset(0);
      go(index + (dx < -MOVE_PX ? 1 : dx > MOVE_PX ? -1 : 0));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const feature = FEATURES[index]!;
  return (
    <div className="onb-cr-wrap">
      <div
        className="onb-cr"
        role="region"
        aria-roledescription="carousel"
        aria-label="What else Pensée does"
      >
        <div
          ref={trackRef}
          className="onb-cr-track"
          data-dragging={dragging || undefined}
          style={{ transform: `translateX(${trackX(index) + offset}px)` }}
          onPointerDown={onPointerDown}
        >
          {FEATURES.map((f, j) => (
            <div
              key={f.id}
              className="onb-cr-slide"
              data-pos={j === index ? "active" : Math.abs(j - index) === 1 ? "near" : undefined}
              role="group"
              aria-roledescription="slide"
              aria-label={`${j + 1} of ${FEATURES.length}: ${f.title}`}
              inert={j !== index}
              onClick={() => {
                if (!draggedRef.current && j !== index) go(j);
              }}
            >
              <div className="onb-cr-img">
                <div
                  className="onb-scene"
                  role="img"
                  aria-label={`${f.title}: ${f.d}`}
                  ref={(el) => {
                    sceneRefs.current[j] = el;
                  }}
                />
                {j === index && done && (
                  <button
                    type="button"
                    className="onb-replay"
                    onClick={() => {
                      const root = sceneRefs.current[j];
                      if (!root) return;
                      setDone(false);
                      playScene(root, f.id, () => setDone(true));
                    }}
                  >
                    <RotateCcw size={12} aria-hidden /> Replay
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="onb-cr-cap" aria-live="polite">
        <div className="onb-cr-text">
          <b>{feature.title}</b>
          <span>{feature.d}</span>
          {tried && TRIED[tried] === feature.id && <em>✓ You just tried this</em>}
        </div>
        <div className="onb-cr-keys">
          {feature.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </div>
      </div>
      <div className="onb-cr-ctl">
        <div className="onb-cr-dots" role="tablist" aria-label="Slides">
          {FEATURES.map((f, j) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-label={f.title}
              aria-selected={j === index}
              onClick={() => go(j)}
            >
              <i />
            </button>
          ))}
        </div>
        <div className="onb-cr-arrows">
          <button
            type="button"
            className="onb-cr-arrow"
            aria-label="Previous"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="onb-cr-arrow"
            aria-label="Next"
            disabled={index === FEATURES.length - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
