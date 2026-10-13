/**
 * The board's tools, on Arc Pro's Dock: a floating bar at the bottom centre
 * whose groups (shapes, note colours, connectors, section sizes) grow a tray.
 * Items are data in `board-dock-items.ts`; this file adds icons and mounts it.
 *
 * Lazy-loaded with the selection toolbar. The canvas owns tool state; this
 * only shows it (`setValue`) and reports picks (`onPick`).
 */

import { type ReactNode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  Circle,
  CornerDownRight,
  Diamond,
  Frame,
  Hand,
  Hexagon,
  Image as ImageIcon,
  MessageSquare,
  Minus,
  MousePointer2,
  MoveUpRight,
  Network,
  Pencil,
  Spline,
  Square,
  Squircle,
  Star,
  Triangle,
  Type,
  WandSparkles,
} from "lucide-react";
import { Dock, type DockItem } from "@/components/arc/dock/dock";
import type { ShapeKind } from "./board-model";
import { DOCK_SPEC, type DockSpec } from "./board-dock-items";
import { ensureArcTokens } from "./arc-tokens";

export interface ToolDockHandle {
  setValue: (id: string) => void;
  destroy: () => void;
}

const SHAPE_ICONS: Partial<Record<ShapeKind, ReactNode>> = {
  roundRect: <Squircle />,
  rect: <Square />,
  ellipse: <Circle />,
  diamond: <Diamond />,
  triangle: <Triangle />,
  hexagon: <Hexagon />,
  star: <Star />,
  bubble: <MessageSquare />,
};

function swatch(colour: string): ReactNode {
  return (
    <span
      style={{
        display: "block",
        width: 18,
        height: 18,
        borderRadius: "var(--radius-button)",
        background: `var(--wr-board-sticky-${colour})`,
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--fg-base) 12%, transparent)",
      }}
    />
  );
}

const LINKER_ICONS: Record<string, ReactNode> = {
  "linker:arrow:straight": <MoveUpRight />,
  "linker:line:straight": <Minus />,
  "linker:arrow:elbow": <CornerDownRight />,
  "linker:arrow:curved": <Spline />,
};

const TOP_ICONS: Record<string, ReactNode> = {
  select: <MousePointer2 />,
  hand: <Hand />,
  shapes: <Squircle />,
  text: <Type />,
  stickies: swatch("yellow"),
  linkers: <MoveUpRight />,
  pen: <Pencil />,
  mind: <Network />,
  frames: <Frame />,
  image: <ImageIcon />,
  tidy: <WandSparkles />,
};

function iconFor(id: string): ReactNode {
  const [kind, rest] = id.split(":");
  if (kind === "shape") return SHAPE_ICONS[rest as ShapeKind];
  if (kind === "sticky") return swatch(rest);
  if (kind === "linker") return LINKER_ICONS[id];
  if (kind === "frame") return <Frame />;
  return TOP_ICONS[id];
}

const withIcons = (spec: DockSpec): DockItem => ({
  id: spec.id,
  label: spec.label,
  shortcut: spec.shortcut,
  icon: iconFor(spec.id),
  items: spec.items?.map(withIcons),
});

const DOCK_ITEMS: DockItem[] = DOCK_SPEC.map(withIcons);

function Root({
  subscribe,
  getValue,
  onPick,
}: {
  subscribe: (fn: () => void) => () => void;
  getValue: () => string;
  onPick: (id: string) => void;
}) {
  const value = useSyncExternalStore(subscribe, getValue);
  return <Dock items={DOCK_ITEMS} value={value} onValueChange={onPick} label="Board tools" />;
}

export function mountToolDock(
  host: HTMLElement,
  initial: string,
  onPick: (id: string) => void,
): ToolDockHandle {
  ensureArcTokens();
  const root = createRoot(host);
  let value = initial;
  const listeners = new Set<() => void>();
  root.render(
    <Root
      subscribe={(fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }}
      getValue={() => value}
      onPick={onPick}
    />,
  );
  return {
    setValue(id) {
      if (id === value) return;
      value = id;
      for (const fn of listeners) fn();
    },
    destroy() {
      listeners.clear();
      root.unmount();
    },
  };
}
