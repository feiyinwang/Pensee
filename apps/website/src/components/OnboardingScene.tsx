import { useEffect, useRef, useState } from "react";

import {
  type FeatureId,
  SCENE_W,
  playScene,
  sceneMarkup,
  stopScene,
} from "../../../desktop/src/components/onboarding/feature-scenes";

const SCENE_H = 360;
/** How long the last frame holds before the scene plays again. */
const HOLD_MS = 1600;

// The scenes' engine plays one scene at a time (it is the onboarding
// carousel's). Rooms sit far apart, so at most one is on screen; this tracks
// which card owns the engine so a card leaving view only stops its own scene.
let owner: symbol | null = null;

/**
 * One of the app's onboarding scenes (apps/desktop/.../feature-scenes.ts),
 * played in a card: the real keys in its key bar, the real pen box and
 * columns. Drawn at 600 × 360 and scaled to the card; it plays while most of
 * it is on screen and repeats, like the GIFs. Reduced motion shows its end.
 */
export function OnboardingScene({ id, label }: { id: FeatureId; label: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, top: 0 });
  const [markup] = useState(() => sceneMarkup(id));

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scale = width / SCENE_W;
      // The card is 16:10, the scene 5:3: centre it on the scene's own ground.
      setFit({ scale, top: (height - SCENE_H * scale) / 2 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = frame.current;
    const stage = root.current;
    if (!el || !stage) return;
    const me = Symbol(id);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let again = 0;
    const play = () => {
      owner = me;
      playScene(stage, id, () => {
        if (!reduce) again = window.setTimeout(play, HOLD_MS);
      });
    };
    const stop = () => {
      window.clearTimeout(again);
      if (owner !== me) return;
      stopScene();
      owner = null;
      stage.innerHTML = sceneMarkup(id);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (owner !== me) play();
        } else stop();
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [id]);

  return (
    <div ref={frame} className="onb-frame" role="img" aria-label={label}>
      <div
        ref={root}
        className="onb-scene"
        style={{ width: SCENE_W, height: SCENE_H, top: fit.top, transform: `scale(${fit.scale})` }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  );
}
