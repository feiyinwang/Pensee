import type { CSSProperties } from "react";

import type { Feature } from "../content";
import { zoomLayout, type Zoom } from "../zoom";
import { Keycaps } from "./Keycaps";
import { OnboardingScene } from "./OnboardingScene";
import { Scene } from "./Scene";

function zoomStyles(zoom: Zoom) {
  const { aspectRatio, width, height, left, top } = zoomLayout(zoom);
  const frame: CSSProperties = { aspectRatio };
  // Both sizes are set, not just width: a lazy image with no height yet never
  // counts as on screen, so it would never load.
  const img: CSSProperties = {
    width: `${width}%`,
    height: `${height}%`,
    left: `${left}%`,
    top: `${top}%`,
  };
  return { frame, img };
}

/** One feature: its demo, its shortcut, what you get, and how. */
export function FeatureCard({ feature, room }: { feature: Feature; room: string }) {
  const { demo } = feature;
  const zoom = "gif" in demo && demo.zoom ? zoomStyles(demo.zoom) : undefined;
  return (
    <article className="fcard">
      {"gif" in demo ? (
        <div className={demo.zoom ? "media zoomed" : "media"} style={zoom?.frame}>
          <img
            style={zoom?.img}
            src={demo.gif}
            alt={`${feature.title}: ${feature.description}`}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : "onboarding" in demo ? (
        <OnboardingScene id={demo.onboarding} label={feature.title} />
      ) : (
        <Scene id={demo.scene} label={feature.title} />
      )}
      <div className="words">
        <div className="eyebrow">
          {feature.keys.length > 0 ? <Keycaps keys={feature.keys} /> : room}
        </div>
        <h3>{feature.title}</h3>
        <p>{feature.description}</p>
      </div>
    </article>
  );
}
