"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./radar-chart.module.css";

export interface RadarAxis {
  /** Stable identity, such as "talent". */
  key: string;
  /** Name around the chart, in the tooltip, and in the data table. */
  label: string;
  /** Top of this axis. Defaults to the chart's max. */
  max?: number;
}

export interface RadarSeries {
  /** Stable identity. */
  key: string;
  /** Name in the legend, the tooltip, and the table. */
  label: string;
  /** One value per axis key. Missing values count as zero. */
  values: Record<string, number | undefined>;
}

/** Use a radar chart to compare the shape of two or three profiles across the same five to eight measures. */
export interface RadarChartProps {
  axes: RadarAxis[];
  /**
   * Up to three profiles. Shapes are drawn by position: the first takes the first series (derived from the accent), and replacing the series at a position
   * morphs that shape into the new one instead of swapping it.
   */
  series: RadarSeries[];
  /** What is compared, such as "Office locations". Names the chart for assistive technology. */
  label: string;
  /** Default top of every axis. */
  max?: number;
  /** Concentric guides. */
  rings?: number;
  /** Largest diameter of the web in pixels. It shrinks to fit narrow containers. */
  size?: number;
  formatValue?: (value: number, axis: RadarAxis) => string;
  /** Controlled axis in focus. */
  activeAxis?: string | null;
  onActiveAxisChange?: (key: string | null) => void;
  /** Profile names with a line key below the chart. */
  legend?: boolean;
  emptyLabel?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }, restDelta = .0005) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta, restSpeed: restDelta * 2 }; };
const morph = physical({ visualDuration: .6, bounce: motionTokens.spring.morph.bounce });
const follow = { stiffness: 460, damping: 40, restDelta: .01 };
const SLOTS = 3;
const LABEL_ROOM = 64;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const subscribeNothing = () => () => {};
function useReducedMotionSafe() {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

export function RadarChart({ axes, series, label, max = 100, rings = 4, size = 320, formatValue, activeAxis, onActiveAxisChange, legend = true, emptyLabel = "No data", ref, className }: RadarChartProps) {
  const reduced = useReducedMotionSafe();
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const shapes = useRef<(SVGPathElement | null)[]>([]);
  useImperativeHandle(ref, () => figure.current as HTMLElement);
  const inView = useInView(figure, { once: true, amount: .35 });
  const n = axes.length;
  const shown = series.slice(0, SLOTS);
  const empty = n < 3 || shown.length === 0;

  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const read = () => setWidth(node.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const room = width < 360 ? 46 : LABEL_ROOM;
  const radius = Math.max(40, Math.min(size, width - room * 2) / 2);
  const box = radius * 2 + room * 2;
  const cx = box / 2, cy = box / 2;
  const angle = (i: number) => (i / Math.max(1, n)) * Math.PI * 2;
  const pointAt = useCallback((i: number, share: number) => ({ x: cx + Math.sin(angle(i)) * radius * share, y: cy - Math.cos(angle(i)) * radius * share }), [cx, cy, radius, n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each position keeps a live shape (shares 0..1 per axis) that blends toward its target.
  const targets = Array.from({ length: SLOTS }, (_, slot) => shown[slot] ? axes.map(axis => clamp((shown[slot].values[axis.key] ?? 0) / (axis.max ?? max), 0, 1)) : axes.map(() => 0));
  const signature = `${axes.map(axis => `${axis.key}:${axis.max ?? max}`).join(",")}|${targets.map(list => list.join(",")).join(";")}`;
  const live = useRef<number[][]>(Array.from({ length: SLOTS }, () => axes.map(() => 0)));
  const grow = useMotionValue(0);

  const paint = useCallback(() => {
    const g = grow.get();
    live.current.forEach((shares, slot) => {
      const node = shapes.current[slot];
      if (!node) return;
      if (!n || shares.every(value => value === 0)) { node.setAttribute("d", ""); return; }
      const d = shares.map((share, i) => { const p = pointAt(i, share * g); return `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join("") + "Z";
      node.setAttribute("d", d);
    });
  }, [grow, n, pointAt]);

  // Running animations draw through this ref, so a resize mid-morph never paints the old geometry.
  const paintRef = useRef(paint);
  useLayoutEffect(() => { paintRef.current = paint; paint(); }, [paint, width]);

  useEffect(() => {
    const next = targets;
    const from = live.current.map((shares, slot) => shares.length === n ? shares.slice() : next[slot].map(() => 0));
    if (reduced) { live.current = next; paintRef.current(); return; }
    const controls = animate(0, 1, { ...morph, onUpdate: t => { live.current = from.map((shares, slot) => shares.map((value, i) => value + (next[slot][i] - value) * t)); paintRef.current(); } });
    return () => controls.stop();
  }, [signature, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // The web unfolds from the centre the first time it is seen.
  useEffect(() => {
    if (empty) return;
    if (reduced) { grow.jump(1); paintRef.current(); return; }
    if (!inView || grow.get() >= 1) return;
    const controls = animate(grow, 1, { ...physical({ visualDuration: .9, bounce: 0 }), onUpdate: () => paintRef.current() });
    return () => controls.stop();
  }, [empty, grow, inView, reduced]);

  const [ownAxis, setOwnAxis] = useState<string | null>(null);
  const wanted = activeAxis !== undefined ? activeAxis : ownAxis;
  const index = wanted ? axes.findIndex(axis => axis.key === wanted) : -1;
  const current = index >= 0 ? index : null;
  // The tooltip keeps the last reading while it fades out instead of collapsing to an empty box.
  const [held, setHeld] = useState(current);
  if (current !== null && current !== held) setHeld(current);
  const setAxis = (next: number | null) => {
    const key = next === null ? null : axes[next]?.key ?? null;
    if (activeAxis === undefined) setOwnAxis(key);
    if (key !== wanted) onActiveAxisChange?.(key);
  };
  const [focusSlot, setFocusSlot] = useState<number | null>(null);

  // Vertex markers glide along the web to the axis in focus, one per profile.
  const markerX = [useMotionValue(0), useMotionValue(0), useMotionValue(0)];
  const markerY = [useMotionValue(0), useMotionValue(0), useMotionValue(0)];
  const springX = [useSpring(markerX[0], follow), useSpring(markerX[1], follow), useSpring(markerX[2], follow)];
  const springY = [useSpring(markerY[0], follow), useSpring(markerY[1], follow), useSpring(markerY[2], follow)];
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const tipSpringX = useSpring(tipX, follow), tipSpringY = useSpring(tipY, follow);
  const wasShown = useRef(false);
  useLayoutEffect(() => {
    if (current === null) { wasShown.current = false; return; }
    const instant = !wasShown.current || reduced;
    targets.forEach((shares, slot) => {
      const p = pointAt(current, shares[current] ?? 0);
      markerX[slot].set(p.x); markerY[slot].set(p.y);
      if (instant) { springX[slot].jump(p.x); springY[slot].jump(p.y); }
    });
    const bubble = tip.current, host = stage.current;
    if (bubble && host) {
      const tw = bubble.offsetWidth, th = bubble.offsetHeight, hostWidth = host.clientWidth, hostHeight = host.clientHeight;
      const offsetX = (hostWidth - box) / 2;
      // Past the axis label: above or below it on the sides, beside it at the top and bottom, so the label and vertices stay visible.
      const edge = pointAt(current, 1);
      const sx = Math.sin(angle(current)), sy = -Math.cos(angle(current));
      let left: number, top: number;
      if (Math.abs(sx) < .35) { left = offsetX + edge.x + 60; top = edge.y + sy * 12 - th / 2; }
      else { left = sx > 0 ? offsetX + edge.x + 2 : offsetX + edge.x - tw - 2; top = sy < 0 ? edge.y - th - 20 : edge.y + 22; }
      left = clamp(left, 0, Math.max(0, hostWidth - tw)); top = clamp(top, 0, Math.max(0, hostHeight - th));
      tipX.set(left); tipY.set(top);
      if (instant) { tipSpringX.jump(left); tipSpringY.jump(top); }
    }
    wasShown.current = true;
  });

  const axisFrom = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || empty) return null;
    const x = clientX - rect.left - (rect.width - box) / 2 - cx, y = clientY - rect.top - cy;
    if (Math.hypot(x, y) < radius * .12) return current;
    const turn = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(turn / (Math.PI * 2 / n)) % n;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || event.buttons) setAxis(axisFrom(event.clientX, event.clientY)); };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId); setAxis(axisFrom(event.clientX, event.clientY)); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty) return;
    if (event.key === "Escape" && current !== null) { event.preventDefault(); setAxis(null); return; }
    const from = current ?? -1;
    const moves: Record<string, number> = { ArrowRight: from + 1, ArrowDown: from + 1, ArrowLeft: from < 0 ? n - 1 : from - 1, ArrowUp: from < 0 ? n - 1 : from - 1, Home: 0, End: n - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setAxis((moves[event.key] + n) % n);
  };

  const format = (value: number, axis: RadarAxis) => formatValue ? formatValue(value, axis) : grouped.format(value);
  const axis = current !== null ? axes[current] : null;
  const tipAxis = axis ?? (held !== null ? axes[held] ?? null : null);
  const readings = tipAxis ? shown.map((item, slot) => ({ item, slot, value: item.values[tipAxis.key] ?? 0 })).sort((a, b) => b.value - a.value) : [];
  const lead = readings[0]?.value ?? 0;
  const announce = axis ? `${axis.label}. ${readings.map(entry => `${entry.item.label} ${format(entry.value, axis)}`).join(", ")}` : "";
  const summary = empty ? `${label}. ${emptyLabel}.` : `${label}. ${shown.map(item => `${item.label}: ${axes.map(entry => `${entry.label} ${format(item.values[entry.key] ?? 0, entry)}`).join(", ")}`).join(". ")}.`;
  const offset = width ? (width - box) / 2 : 0;

  return <figure ref={figure} className={[styles.figure, className].filter(Boolean).join(" ")} aria-label={label}>
    <div ref={stage} className={styles.stage} style={{ height: width ? box : undefined }} data-active={current !== null || undefined} data-focus={focusSlot !== null || undefined}
      role="group" tabIndex={empty ? -1 : 0} aria-roledescription="radar chart" aria-label={`${label}. Use arrow keys to move between measures.`}
      onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={event => { if (event.pointerType !== "mouse") setAxis(null); }} onPointerCancel={() => setAxis(null)} onPointerLeave={event => { if (event.pointerType === "mouse") setAxis(null); }}
      onKeyDown={onKeyDown} onBlur={() => setAxis(null)} onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !empty && current === null) setAxis(0); }}>
      {width > 0 && <>
        <svg className={styles.svg} width={box} height={box} style={{ left: offset }} aria-hidden="true" focusable="false">
          <g className={styles.web} data-shown={inView || reduced || undefined}>
            {Array.from({ length: rings }, (_, r) => { const share = (r + 1) / rings; return <path key={r} className={styles.ring} d={axes.map((_, i) => { const p = pointAt(i, share); return `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join("") + "Z"} />; })}
            {axes.map((item, i) => { const p = pointAt(i, 1); return <line key={item.key} className={styles.spoke} data-on={current === i || undefined} x1={cx} y1={cy} x2={p.x} y2={p.y} />; })}
          </g>
          {Array.from({ length: SLOTS }, (_, slot) => <path key={slot} ref={node => { shapes.current[slot] = node; }} className={styles.shape} data-slot={slot} data-dim={(focusSlot !== null && focusSlot !== slot) || undefined} data-on={focusSlot === slot || undefined} />)}
          {Array.from({ length: SLOTS }, (_, slot) => shown[slot] ? <motion.circle key={slot} className={styles.marker} data-slot={slot} r={4.5} cx={0} cy={0} style={{ x: reduced ? markerX[slot] : springX[slot], y: reduced ? markerY[slot] : springY[slot] }} /> : null)}
        </svg>
        {axes.map((item, i) => {
          const p = pointAt(i, 1), sx = Math.sin(angle(i)), sy = -Math.cos(angle(i));
          const anchor = Math.abs(sx) < .2 ? "center" : sx > 0 ? "start" : "end";
          const style: CSSProperties = { left: offset + p.x + sx * 10, top: p.y + sy * 12, translate: `${anchor === "center" ? "-50%" : anchor === "end" ? "-100%" : "0"} ${Math.abs(sy) > .8 ? (sy < 0 ? "-100%" : "0") : "-50%"}` };
          return <span key={item.key} className={styles.axisLabel} data-anchor={anchor} data-on={current === i || undefined} style={{ ...style, maxWidth: anchor === "center" ? 120 : room + 8 }} aria-hidden="true">{item.label}</span>;
        })}
      </>}
      <motion.div ref={tip} className={styles.tooltip} style={{ x: reduced ? tipX : tipSpringX, y: reduced ? tipY : tipSpringY }} aria-hidden="true">
        <p className={styles.tipTitle}>{tipAxis?.label ?? ""}</p>
        {readings.map(entry => <p key={entry.item.key} className={styles.tipRow} data-slot={entry.slot}>
          <span className={styles.tipKey} />
          <span className={styles.tipName}>{entry.item.label}</span>
          <span className={styles.tipValue}>{tipAxis ? format(entry.value, tipAxis) : ""}</span>
          <span className={styles.tipGap}>{tipAxis && entry.value < lead ? `−${format(lead - entry.value, tipAxis)}` : ""}</span>
        </p>)}
      </motion.div>
      {empty && <p className={styles.message}>{emptyLabel}</p>}
    </div>
    {legend && !empty && <div className={styles.legend} role="group" aria-label={`${label} profiles`} onPointerLeave={() => setFocusSlot(null)}>
      {shown.map((item, slot) => <motion.button key={slot} type="button" layout={!reduced} transition={motionTokens.spring.morph} className={styles.key} data-slot={slot} data-dim={(focusSlot !== null && focusSlot !== slot) || undefined}
        aria-pressed={focusSlot === slot} onClick={() => setFocusSlot(focusSlot === slot ? null : slot)}
        onPointerEnter={event => { if (event.pointerType === "mouse") setFocusSlot(slot); }}>
        {/* A new name morphs the key's width and the row recentres, instead of the neighbours jumping. */}
        <motion.span layout={!reduced && "position"} transition={motionTokens.spring.morph} className={styles.keyLine} aria-hidden="true" />
        <motion.span layout={!reduced && "position"} transition={motionTokens.spring.morph} className={styles.keyLabel}>{item.label}</motion.span>
      </motion.button>)}
    </div>}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announce}</p>
    <p className={styles.srOnly}>{summary}</p>
    {!empty && <div className={styles.srOnly}><table>
      <caption>{label}</caption>
      <thead><tr><th scope="col">Measure</th>{shown.map(item => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
      <tbody>{axes.map(entry => <tr key={entry.key}><th scope="row">{entry.label}</th>{shown.map(item => <td key={item.key}>{format(item.values[entry.key] ?? 0, entry)}</td>)}</tr>)}</tbody>
    </table></div>}
  </figure>;
}

export default RadarChart;
