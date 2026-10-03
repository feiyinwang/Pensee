/**
 * Floating toolbar for the board selection (Lark's "selection toolbar").
 *
 * Lazy-loaded by `board-canvas.ts` the first time a board opens, so notes never
 * pay for React-on-the-canvas, `motion` or Arc. The canvas stays plain DOM/SVG
 * and owns all state: it positions the host element and calls `update` with a
 * `SelectionSummary`; this file only renders it and reports picks back.
 */

import { type ReactNode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BringToFront,
  ChevronDown,
  Circle,
  Copy,
  Diamond,
  Ellipsis,
  Hexagon,
  MessageSquare,
  MoveRight,
  Pentagon,
  Plus,
  SendToBack,
  Spline,
  Square,
  Squircle,
  Star,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Triangle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import {
  type ArrowHead,
  type ColorToken,
  type LinkerShape,
  SHAPE_KINDS,
  STICKY_COLORS,
  type ShapeKind,
  type StickyColor,
  type StrokeDash,
} from "./board-model";
import type { Align, SelectionSummary } from "./board-selection";
import { ensureArcTokens } from "./arc-tokens";
import styles from "./board-selection-toolbar.module.css";

export interface SelectionToolbarActions {
  setShapeKind: (kind: ShapeKind) => void;
  setFill: (c: ColorToken) => void;
  setSticky: (c: StickyColor) => void;
  setStroke: (c: ColorToken) => void;
  setWidth: (w: number) => void;
  setDash: (d: StrokeDash) => void;
  setTextColor: (c: ColorToken) => void;
  setFontSize: (s: number) => void;
  setAlign: (a: Align) => void;
  setRoute: (r: LinkerShape) => void;
  setBranch: (c: ColorToken) => void;
  setHeads: (h: { s: ArrowHead; e: ArrowHead }) => void;
  setOpacity: (o: number) => void;
  bringForward: () => void;
  sendBackward: () => void;
  duplicate: () => void;
  remove: () => void;
}

export interface SelectionToolbarHandle {
  update: (summary: SelectionSummary | null) => void;
  /** The toolbar's size, for the canvas to place it. Zero while hidden. */
  size: () => { w: number; h: number };
  /** True while one of its popovers is open — the canvas keeps it shown. */
  isBusy: () => boolean;
  destroy: () => void;
}

/* ------------------------------------------------------------ catalog */

const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  roundRect: <Squircle />,
  rect: <Square />,
  ellipse: <Circle />,
  diamond: <Diamond />,
  triangle: <Triangle />,
  pentagon: <Pentagon />,
  hexagon: <Hexagon />,
  star: <Star />,
  bubble: <MessageSquare />,
  cross: <Plus />,
};

const SHAPE_NAMES: Record<ShapeKind, string> = {
  roundRect: "Rounded rectangle",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  star: "Star",
  bubble: "Speech bubble",
  cross: "Cross",
};

const INK_TOKENS: ColorToken[] = [
  "ink",
  "muted",
  "accent",
  "red",
  "orange",
  "green",
  "blue",
  "purple",
];
const FILL_TOKENS: ColorToken[] = ["none", ...INK_TOKENS];
const FONT_SIZES = [12, 14, 16, 20, 24, 32, 48];

const swatchColor = (token: string) =>
  token === "none" ? "transparent" : `var(--wr-board-${token})`;
const stickyColor = (token: string) => `var(--wr-board-sticky-${token})`;

/* ------------------------------------------------------------ pieces */

function Swatches<T extends string>({
  label,
  tokens,
  value,
  color,
  onPick,
}: {
  label: string;
  tokens: readonly T[];
  value: T | undefined;
  color: (t: T) => string;
  onPick: (t: T) => void;
}) {
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label}>
      {tokens.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === value}
          aria-label={`${label}: ${t}`}
          title={t}
          className={styles.swatch}
          data-none={t === "none" || undefined}
          style={{ background: color(t) }}
          onClick={() => onPick(t)}
        />
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

/** A toolbar button that opens a popover. The tooltip names it; the popover
 *  holds the choices. Popovers portal to `body`, which is why Arc's tokens
 *  live there (see `arc-tokens.ts`). */
function Menu({
  label,
  icon,
  onOpenChange,
  children,
  width,
}: {
  label: string;
  /** A number renders as a text readout (the size menu). */
  icon: ReactNode | number;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button type="button" className={styles.button} aria-label={label}>
            {typeof icon === "number" ? (
              <span className={styles.readout}>{icon}</span>
            ) : (
              <span className={styles.icon}>{icon}</span>
            )}
            <ChevronDown className={styles.chevron} aria-hidden />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        className={styles.panel}
        style={width ? { width } : undefined}
        // Keep the canvas from seeing these as clicks on the board.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Action({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.action}
      data-danger={danger || undefined}
      onClick={onClick}
    >
      <span className={styles.icon}>{icon}</span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------ toolbar */

function Toolbar({
  summary,
  actions,
  onBusy,
}: {
  summary: SelectionSummary;
  actions: SelectionToolbarActions;
  onBusy: (open: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const s = summary;
  const groups: ReactNode[] = [];

  if (s.shapeKind) {
    groups.push(
      <Menu
        key="shape"
        label="Shape"
        icon={SHAPE_ICONS[s.shapeKind]}
        onOpenChange={onBusy}
        width={212}
      >
        <div className={styles.shapeGrid} role="radiogroup" aria-label="Shape">
          {SHAPE_KINDS.map((k) => (
            <Tooltip key={k} content={SHAPE_NAMES[k]}>
              <button
                type="button"
                role="radio"
                aria-checked={k === s.shapeKind}
                aria-label={SHAPE_NAMES[k]}
                className={styles.shapeOption}
                onClick={() => actions.setShapeKind(k)}
              >
                {SHAPE_ICONS[k]}
              </button>
            </Tooltip>
          ))}
        </div>
      </Menu>,
    );
  }

  if (s.fill !== undefined || s.sticky) {
    const dot = s.sticky ? stickyColor(s.sticky) : swatchColor(s.fill ?? "none");
    groups.push(
      <Menu
        key="fill"
        label={s.sticky && s.fill === undefined ? "Note colour" : "Fill"}
        icon={
          <span
            className={styles.fillDot}
            data-none={(!s.sticky && s.fill === "none") || undefined}
            style={{ background: dot }}
          />
        }
        onOpenChange={onBusy}
        width={236}
      >
        {s.fill !== undefined && (
          <Section title="Fill">
            <Swatches
              label="Fill"
              tokens={FILL_TOKENS}
              value={s.fill}
              color={swatchColor}
              onPick={actions.setFill}
            />
          </Section>
        )}
        {s.sticky && (
          <Section title="Note colour">
            <Swatches
              label="Note colour"
              tokens={STICKY_COLORS}
              value={s.sticky}
              color={stickyColor}
              onPick={actions.setSticky}
            />
          </Section>
        )}
      </Menu>,
    );
  }

  if (s.stroke !== undefined) {
    groups.push(
      <Menu
        key="border"
        label={s.route ? "Line" : "Border"}
        icon={<span className={styles.ringDot} style={{ borderColor: swatchColor(s.stroke) }} />}
        onOpenChange={onBusy}
        width={260}
      >
        <Section title="Colour">
          <Swatches
            label="Border colour"
            tokens={INK_TOKENS}
            value={s.stroke}
            color={swatchColor}
            onPick={actions.setStroke}
          />
        </Section>
        <Section title="Width">
          <SegmentedControl
            label="Border width"
            value={String(s.width)}
            options={[
              { value: "1", label: "Thin" },
              { value: "2", label: "Medium" },
              { value: "4", label: "Thick" },
            ]}
            onValueChange={(v) => actions.setWidth(Number(v))}
          />
        </Section>
        <Section title="Style">
          <SegmentedControl
            label="Border style"
            value={s.dash ?? "solid"}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
              { value: "dotted", label: "Dotted" },
            ]}
            onValueChange={(v) => actions.setDash(v as StrokeDash)}
          />
        </Section>
      </Menu>,
    );
  }

  if (s.branch) {
    groups.push(
      <Menu
        key="branch"
        label="Branch colour"
        icon={<span className={styles.ringDot} style={{ borderColor: swatchColor(s.branch) }} />}
        onOpenChange={onBusy}
        width={236}
      >
        <Swatches
          label="Branch colour"
          tokens={INK_TOKENS}
          value={s.branch}
          color={swatchColor}
          onPick={actions.setBranch}
        />
      </Menu>,
    );
  }

  if (s.route && s.heads) {
    const heads = s.heads;
    groups.push(
      <Menu
        key="route"
        label="Connector"
        icon={s.route === "curved" ? <Spline /> : <MoveRight />}
        onOpenChange={onBusy}
        width={260}
      >
        <Section title="Route">
          <SegmentedControl
            label="Route"
            value={s.route}
            options={[
              { value: "straight", label: "Straight" },
              { value: "elbow", label: "Elbow" },
              { value: "curved", label: "Curved" },
            ]}
            onValueChange={(v) => actions.setRoute(v as LinkerShape)}
          />
        </Section>
        <Section title="Start">
          <SegmentedControl
            label="Start arrowhead"
            value={heads.s}
            options={HEAD_OPTIONS}
            onValueChange={(v) => actions.setHeads({ ...heads, s: v as ArrowHead })}
          />
        </Section>
        <Section title="End">
          <SegmentedControl
            label="End arrowhead"
            value={heads.e}
            options={HEAD_OPTIONS}
            onValueChange={(v) => actions.setHeads({ ...heads, e: v as ArrowHead })}
          />
        </Section>
      </Menu>,
    );
  }

  if (s.textColor !== undefined) {
    groups.push(
      <Menu
        key="text"
        label="Text colour"
        icon={
          <span className={styles.textGlyph}>
            A<span style={{ background: swatchColor(s.textColor) }} />
          </span>
        }
        onOpenChange={onBusy}
        width={236}
      >
        <Swatches
          label="Text colour"
          tokens={INK_TOKENS}
          value={s.textColor}
          color={swatchColor}
          onPick={actions.setTextColor}
        />
      </Menu>,
    );
  }

  if (s.fontSize !== undefined) {
    groups.push(
      <Menu key="size" label="Text size" icon={s.fontSize} onOpenChange={onBusy} width={132}>
        <div className={styles.sizes} role="radiogroup" aria-label="Text size">
          {FONT_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              role="radio"
              aria-checked={sz === s.fontSize}
              className={styles.sizeOption}
              onClick={() => actions.setFontSize(sz)}
            >
              {sz}
            </button>
          ))}
        </div>
      </Menu>,
    );
  }

  if (s.align !== undefined) {
    const alignIcon =
      s.align === "l" ? (
        <TextAlignStart />
      ) : s.align === "r" ? (
        <TextAlignEnd />
      ) : (
        <TextAlignCenter />
      );
    groups.push(
      <Menu key="align" label="Align" icon={alignIcon} onOpenChange={onBusy}>
        <SegmentedControl
          label="Text alignment"
          value={s.align}
          options={[
            { value: "l", label: "Left" },
            { value: "c", label: "Centre" },
            { value: "r", label: "Right" },
          ]}
          onValueChange={(v) => actions.setAlign(v as Align)}
        />
      </Menu>,
    );
  }

  groups.push(
    <Menu key="more" label="More" icon={<Ellipsis />} onOpenChange={onBusy} width={220}>
      <Section title="Opacity">
        <SegmentedControl
          label="Opacity"
          value={String(s.opacity >= 0.95 ? 1 : s.opacity >= 0.45 ? 0.6 : 0.3)}
          options={[
            { value: "0.3", label: "30%" },
            { value: "0.6", label: "60%" },
            { value: "1", label: "100%" },
          ]}
          onValueChange={(v) => actions.setOpacity(Number(v))}
        />
      </Section>
      <div className={styles.actions}>
        <Action label="Bring forward" icon={<BringToFront />} onClick={actions.bringForward} />
        <Action label="Send backward" icon={<SendToBack />} onClick={actions.sendBackward} />
        <Action label="Duplicate" icon={<Copy />} onClick={actions.duplicate} />
        <Action label="Delete" icon={<Trash2 />} onClick={actions.remove} danger />
      </div>
    </Menu>,
  );

  return (
    <motion.div
      role="toolbar"
      aria-label={s.count > 1 ? `${s.count} items selected` : "Selection"}
      className={styles.tray}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: -2,
              scale: 0.98,
              transition: { duration: motionTokens.duration.instant },
            }
      }
      transition={reduce ? { duration: motionTokens.duration.instant } : motionTokens.spring.snappy}
    >
      {groups.map((g, i) => (
        <span key={i} className={styles.slot}>
          {i > 0 && <span className={styles.separator} aria-hidden />}
          {g}
        </span>
      ))}
    </motion.div>
  );
}

const HEAD_OPTIONS = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Arrow" },
  { value: "line", label: "Open" },
  { value: "dot", label: "Dot" },
];

/* ------------------------------------------------------------- mount */

function Root({
  getSummary,
  subscribe,
  actions,
  onBusy,
}: {
  getSummary: () => SelectionSummary | null;
  subscribe: (fn: () => void) => () => void;
  actions: SelectionToolbarActions;
  onBusy: (open: boolean) => void;
}) {
  const summary = useSyncExternalStore(subscribe, getSummary);
  return (
    <AnimatePresence>
      {summary && <Toolbar key="tb" summary={summary} actions={actions} onBusy={onBusy} />}
    </AnimatePresence>
  );
}

export function mountSelectionToolbar(
  host: HTMLElement,
  actions: SelectionToolbarActions,
): SelectionToolbarHandle {
  ensureArcTokens();
  const root = createRoot(host);
  let summary: SelectionSummary | null = null;
  let openMenus = 0;
  const listeners = new Set<() => void>();

  root.render(
    <Root
      getSummary={() => summary}
      subscribe={(fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }}
      actions={actions}
      onBusy={(open) => {
        openMenus = Math.max(0, openMenus + (open ? 1 : -1));
      }}
    />,
  );

  return {
    update(next) {
      summary = next;
      for (const fn of listeners) fn();
    },
    size() {
      const tray = host.firstElementChild as HTMLElement | null;
      return tray ? { w: tray.offsetWidth, h: tray.offsetHeight } : { w: 0, h: 0 };
    },
    isBusy: () => openMenus > 0,
    destroy() {
      listeners.clear();
      root.unmount();
    },
  };
}
