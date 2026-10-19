import type { Feature } from "../content";
import { Keycaps } from "./Keycaps";
import { Scene } from "./Scene";

/** One feature: its demo, its shortcut, what you get, and how. */
export function FeatureCard({ feature, room }: { feature: Feature; room: string }) {
  const { demo } = feature;
  return (
    <article className="fcard">
      {"gif" in demo ? (
        <div className="media">
          <img
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
