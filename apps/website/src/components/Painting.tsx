import type { CSSProperties, ReactNode } from "react";

import type { Painting as PaintingData } from "../content";

/** "Rembrandt, Philosopher in Meditation, 1632" with the title in italics. */
export function Credit({ painting }: { painting: PaintingData }) {
  return (
    <>
      {painting.by}, <i>{painting.title}</i>
      {painting.year && `, ${painting.year}`}
    </>
  );
}

/** A painting cropped to its frame, keeping its subject in view. */
export function Painting({
  painting,
  eager = false,
  children,
}: {
  painting: PaintingData;
  eager?: boolean;
  children?: ReactNode;
}) {
  return (
    <figure className="art" style={{ "--focus": painting.focus } as CSSProperties}>
      <img
        src={painting.src}
        alt=""
        decoding="async"
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
      />
      {children}
    </figure>
  );
}
