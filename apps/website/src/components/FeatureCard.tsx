import type { CSSProperties } from "react";

import type { Feature, Zoom } from "../content";
import { Keycaps } from "./Keycaps";
import { Scene } from "./Scene";

/** Enlarges the GIF so only the zoom window fills the frame. */
const zoomStyle = ({ x, y, w }: Zoom): CSSProperties => ({
  // Both sizes are set, not just width: a lazy image with no height yet never
  // counts as on screen, so it would never load.
  width: `${100 / w}%`,
  height: `${100 / w}%`,
  left: `${(-x / w) * 100}%`,
  top: `${(-y / w) * 100}%`,
});

/** One feature: its demo, its shortcut, what you get, and how. */
export function FeatureCard({ feature, room }: { feature: Feature; room: string }) {
  const { demo } = feature;
  return (
    <article className="fcard">
      {"gif" in demo ? (
        <div className={demo.zoom ? "media zoomed" : "media"}>
          <img
            style={demo.zoom && zoomStyle(demo.zoom)}
            src={demo.gif}
            alt={`${feature.title}: ${feature.description}`}
            loading="lazy"
            decoding="async"
          />
        </div>
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
