"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, Reorder, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Transition } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./dock.module.css";

export interface DockItem {
  id: string;
  label: string;
  /** A 20px icon, such as a lucide icon with a 1.75 stroke. */
  icon: ReactNode;
  /** A key hint shown in the label, such as "V". The dock only displays it; the page handles the key. */
  shortcut?: string;
  /** A count on the item, such as open comments. Its digits roll when it changes and it leaves at 0. */
  badge?: number;
  /** Makes the item a group. The group shows its last chosen member, and opening it grows a tray out of the dock surface. */
  items?: DockItem[];
}
export interface DockChange { type: "move"; id: string; index: number }

/**
 * A floating command dock for the handful of tools or modes someone switches between all day, such as the tools of a canvas editor.
 * One label glides between items as the pointer or keyboard moves, a selection springs to the chosen item, and a group grows a tray
 * straight out of the dock surface to show its members. With onItemsChange, items can be dragged into a new order, or moved with
 * Alt and the arrow keys. Arrow keys move along the dock, Enter or the up arrow opens a group, and Escape closes it.
 */
export interface DockProps {
  items: DockItem[];
  /** Id of the selected item or group member. */
  value?: string | null;
  onValueChange?: (id: string) => void;
  /** Enables drag to reorder and Alt with the arrow keys. Receives the next list and what moved. */
  onItemsChange?: (items: DockItem[], change: DockChange) => void;
  /** Accessible name of the toolbar. */
  label?: string;
  className?: string;
}

/** Geometry in px. Keep in step with the stylesheet. */
const ITEM = 44, PAD = 6, BAR = ITEM + PAD * 2, RADIUS = 22, TRAY_ITEM = 40, TRAY_PAD = 6, TRAY = TRAY_ITEM + TRAY_PAD * 2, TRAY_RADIUS = 20, FILLET = 12, GAP = 2;
/** Hover delay before the first label, and how long a label stays warm so the next one glides in without waiting. */
const DELAY = 60, WARM = 700; // Pensée patch (docs/arc.md): upstream 380

const { spring, duration, ease, blur } = motionTokens;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const r2 = (value: number) => Math.round(value * 100) / 100;
/** Shared spring characters restated as stiffness and damping, so a new target keeps the current velocity. */
const physical = (visualDuration: number, bounce: number): Transition => {
  const root = 2 * Math.PI / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1, restDelta: .001, restSpeed: .05 };
};
const glide = physical(.2, .1), /* Pensée patch: upstream .3 */ grow = physical(.46, .2), shrink = physical(.3, 0), stretch = physical(spring.morph.visualDuration, .12);
const instant: Transition = { duration: 0 };

/** The dock outline: a rounded bar, and when a tray is out, a tab of the same material rising from it with concave fillets at the joint. */
function outline(width: number, rise: number, center: number, trayWidth: number) {
  const W = r2(width), H = BAR, R = RADIUS;
  const base = `M${R} 0 L${W - R} 0 A${R} ${R} 0 0 1 ${W} ${R} L${W} ${H - R} A${R} ${R} 0 0 1 ${W - R} ${H} L${R} ${H} A${R} ${R} 0 0 1 0 ${H - R} L0 ${R} A${R} ${R} 0 0 1 ${R} 0 Z`;
  if (rise < .5) return base;
  const f = Math.min(FILLET, rise / 2);
  const tw = Math.min(trayWidth, W - 2 * R - 2 * f);
  const cx = clamp(center, R + f + tw / 2, W - R - f - tw / 2);
  const a = r2(cx - tw / 2), b = r2(cx + tw / 2), h = r2(rise), ff = r2(f);
  const r = r2(Math.max(0, Math.min(TRAY_RADIUS, h - f, tw / 2)));
  return `M${R} 0 L${r2(a - ff)} 0 Q${a} 0 ${a} ${-ff} L${a} ${r2(-h + r)} Q${a} ${-h} ${r2(a + r)} ${-h} L${r2(b - r)} ${-h} Q${b} ${-h} ${b} ${r2(-h + r)} L${b} ${-ff} Q${b} 0 ${r2(b + ff)} 0 `
    + `L${W - R} 0 A${R} ${R} 0 0 1 ${W} ${R} L${W} ${H - R} A${R} ${R} 0 0 1 ${W - R} ${H} L${R} ${H} A${R} ${R} 0 0 1 0 ${H - R} L0 ${R} A${R} ${R} 0 0 1 ${R} 0 Z`;
}

const subscribe = () => () => {};
function useReducedFlag() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return !!useReducedMotion() && hydrated;
}

function Digit({ digit, reduced }: { digit: number; reduced: boolean }) {
  return <span className={styles.digit}>
    <motion.span className={styles.column} initial={false} animate={{ y: `${-digit * 10}%` }} transition={reduced ? instant : spring.snappy}>
      {"0123456789".split("").map(n => <span key={n}>{n}</span>)}
    </motion.span>
  </span>;
}

/** A count whose digits roll to the new value, and whose width springs when it gains or loses a digit. */
function Badge({ count, reduced }: { count: number; reduced: boolean }) {
  const text = count > 99 ? "99" : String(count);
  return <AnimatePresence initial={false}>
    {count > 0 && <motion.span key="badge" className={styles.badge} aria-hidden="true"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1, width: 10 + text.length * 7 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .5, transition: { duration: duration.fast } }}
      transition={reduced ? { duration: .12 } : { ...spring.snappy, opacity: { duration: duration.fast } }}>
      {text.split("").map((n, i) => <Digit key={text.length - i} digit={Number(n)} reduced={reduced} />)}
    </motion.span>}
  </AnimatePresence>;
}

interface Tip { id: string; label: string; shortcut?: string }

export function Dock({ items, value = null, onValueChange, onItemsChange, label = "Tools", className }: DockProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const reduced = useReducedFlag();
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tipMeasure = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const trayRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef(false);
  const openRef = useRef<string | null>(null);
  const timers = useRef({ show: 0, hide: 0, cool: 0, warm: false });

  const [width, setWidth] = useState(items.length * (ITEM + GAP) + PAD * 2);
  const [focusId, setFocusId] = useState(items[0]?.id ?? "");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [shownTip, setShownTip] = useState<Tip | null>(null);
  if (tip && tip !== shownTip) setShownTip(tip);
  // Each group remembers the member chosen last, and shows it on the dock.
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const memberOf = (group: DockItem) => group.items?.find(member => member.id === value) ?? group.items?.find(member => member.id === chosen[group.id]) ?? group.items?.[0];
  const selectedTop = items.find(item => item.id === value || item.items?.some(member => member.id === value))?.id ?? null;
  // The tray keeps its last group while it sinks back, so its members fade with it instead of vanishing.
  const [trayGroup, setTrayGroup] = useState<string | null>(null);
  if (openGroup && openGroup !== trayGroup) setTrayGroup(openGroup);
  const group = items.find(item => item.id === trayGroup && item.items?.length);
  const members = group?.items ?? [];
  const trayWidth = members.length * TRAY_ITEM + Math.max(0, members.length - 1) * GAP + TRAY_PAD * 2;

  // The surface: tray rise, the tray's center, and its width all spring, and the outline is redrawn from them every frame.
  const rise = useMotionValue(0), center = useMotionValue(0), span = useMotionValue(ITEM);
  const barWidth = useMotionValue(width);
  const path = useTransform(() => outline(barWidth.get(), rise.get(), center.get(), span.get()));
  const trayOpacity = useTransform(rise, value => clamp((value / TRAY - .45) / .4, 0, 1));
  const trayX = useTransform(() => clamp(center.get(), RADIUS + FILLET + span.get() / 2, barWidth.get() - RADIUS - FILLET - span.get() / 2) - trayWidth / 2);

  // The label: one bubble that glides between items and springs to the width of its words.
  const tipX = useMotionValue(0), tipY = useMotionValue(0), tipWidth = useMotionValue(0), tipOn = useMotionValue(0);
  const tipTransform = useTransform(() => `translate3d(${r2(tipX.get() - tipWidth.get() / 2)}px, ${r2(tipY.get() + (1 - tipOn.get()) * (reduced ? 0 : 4))}px, 0) scale(${r2(reduced ? 1 : .96 + .04 * tipOn.get())})`);

  useLayoutEffect(() => {
    const node = barRef.current;
    if (!node) return;
    const update = () => { setWidth(node.offsetWidth); barWidth.set(node.offsetWidth); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [barWidth]);

  // Opening a group grows the tray out of the group's own footprint; closing sinks it back into the dock.
  useEffect(() => {
    if (!openGroup) {
      if (reduced) { rise.jump(0); return; }
      const controls = animate(rise, 0, shrink);
      return () => controls.stop();
    }
    const node = buttonRefs.current.get(openGroup), bar = barRef.current;
    if (!node || !bar) return;
    const from = node.getBoundingClientRect(), box = bar.getBoundingClientRect();
    const middle = from.left - box.left + from.width / 2;
    if (reduced) { center.jump(middle); span.jump(trayWidth); rise.jump(TRAY); return; }
    if (rise.get() < 1) { center.jump(middle); span.jump(ITEM); }
    const a = animate(rise, TRAY, grow), b = animate(center, middle, grow), c = animate(span, trayWidth, stretch);
    return () => { a.stop(); b.stop(); c.stop(); };
  }, [center, openGroup, reduced, rise, span, trayWidth]);

  useEffect(() => { openRef.current = openGroup; }, [openGroup]);

  // The label springs to the width of its new words; it only jumps while hidden.
  useLayoutEffect(() => {
    const node = tipMeasure.current;
    if (!node || !shownTip) return;
    const next = node.offsetWidth;
    if (reduced || tipOn.get() < .05) { tipWidth.jump(next); return; }
    const controls = animate(tipWidth, next, stretch);
    return () => controls.stop();
  }, [reduced, shownTip, tipOn, tipWidth]);

  useEffect(() => {
    const controls = animate(tipOn, tip ? 1 : 0, reduced ? { duration: .12 } : tip ? physical(.1, 0) : { duration: .1, ease: [...ease.exit] }); // Pensée patch: upstream .22 in, duration.exit + ease.standard out
    return () => controls.stop();
  }, [reduced, tip, tipOn]);

  useEffect(() => { const state = timers.current; return () => { window.clearTimeout(state.show); window.clearTimeout(state.hide); window.clearTimeout(state.cool); }; }, []);

  function placeTip(id: string, text: Tip, inTray: boolean) {
    const node = (inTray ? trayRefs : buttonRefs).current.get(id), root = rootRef.current;
    if (!node || !root) return;
    const box = node.getBoundingClientRect(), frame = root.getBoundingClientRect();
    const x = box.left - frame.left + box.width / 2;
    const level = (inTray || openRef.current ? -TRAY : 0) - 10;
    const warm = tipOn.get() > .05;
    if (!warm || reduced) { tipX.jump(x); tipY.jump(level); }
    else { animate(tipX, x, glide); animate(tipY, level, glide); }
    setTip(text);
  }

  /** Shows a label for an item, after a short delay the first time and at once while labels are warm. */
  function hint(item: DockItem, inTray: boolean, immediate = false) {
    if (dragging) return;
    const state = timers.current;
    window.clearTimeout(state.hide);
    window.clearTimeout(state.show);
    const text = { id: item.id, label: item.label, shortcut: item.shortcut };
    if (immediate || tipOn.get() > .05 || state.warm) placeTip(item.id, text, inTray);
    else state.show = window.setTimeout(() => placeTip(item.id, text, inTray), DELAY);
  }
  function unhint(delay = 90) {
    const state = timers.current;
    window.clearTimeout(state.show);
    window.clearTimeout(state.hide);
    state.hide = window.setTimeout(() => {
      state.warm = true;
      window.clearTimeout(state.cool);
      state.cool = window.setTimeout(() => { state.warm = false; }, WARM);
      setTip(null);
    }, delay);
  }

  function choose(item: DockItem, parent?: DockItem) {
    unhint(0);
    if (parent) { setChosen(current => ({ ...current, [parent.id]: item.id })); setOpenGroup(null); buttonRefs.current.get(parent.id)?.focus({ preventScroll: true }); }
    onValueChange?.(item.id);
  }

  function press(item: DockItem) {
    if (dragged.current) { dragged.current = false; return; }
    if (item.items?.length) {
      unhint(0);
      const member = memberOf(item);
      if (member && member.id !== value) onValueChange?.(member.id);
      setOpenGroup(open => open === item.id ? null : item.id);
      return;
    }
    setOpenGroup(null);
    choose(item);
  }

  const dismiss = useEffectEvent((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      const back = openGroup;
      setOpenGroup(null);
      if (back && rootRef.current?.contains(document.activeElement)) buttonRefs.current.get(back)?.focus({ preventScroll: true });
      return;
    }
    if (!rootRef.current?.contains(event.target as Node)) setOpenGroup(null);
  });
  useEffect(() => {
    if (!openGroup) return;
    const listener = (event: Event) => dismiss(event);
    document.addEventListener("pointerdown", listener, true);
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("pointerdown", listener, true); document.removeEventListener("keydown", listener); };
  }, [openGroup]);

  function focusItem(id: string) { setFocusId(id); buttonRefs.current.get(id)?.focus({ preventScroll: true }); }

  function onBarKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const item = items[index];
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (move && event.altKey && onItemsChange) {
      const to = index + move;
      if (to < 0 || to >= items.length) return;
      event.preventDefault();
      const next = [...items];
      next.splice(index, 1);
      next.splice(to, 0, item);
      onItemsChange(next, { type: "move", id: item.id, index: to });
      requestAnimationFrame(() => { buttonRefs.current.get(item.id)?.focus({ preventScroll: true }); hint(item, false, true); });
      return;
    }
    let next = -1;
    if (move) next = (index + move + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowUp" && item.items?.length) {
      event.preventDefault();
      setOpenGroup(item.id);
      const member = memberOf(item) ?? item.items[0];
      requestAnimationFrame(() => { trayRefs.current.get(member.id)?.focus({ preventScroll: true }); hint(member, true, true); });
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    focusItem(items[next].id);
    hint(items[next], false, true);
  }

  function onTrayKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "ArrowDown" || event.key === "Tab") {
      if (event.key === "ArrowDown") event.preventDefault();
      const back = openGroup;
      setOpenGroup(null);
      if (back && event.key === "ArrowDown") buttonRefs.current.get(back)?.focus({ preventScroll: true });
      return;
    }
    if (!move) return;
    event.preventDefault();
    const next = members[(index + move + members.length) % members.length];
    trayRefs.current.get(next.id)?.focus({ preventScroll: true });
    hint(next, true, true);
  }

  const showFocusHint = (node: HTMLElement, item: DockItem, inTray: boolean) => { if (node.matches(":focus-visible")) hint(item, inTray, true); };
  const layoutTransition = reduced ? instant : spring.smooth;
  const selectionTransition = reduced ? instant : physical(spring.snappy.visualDuration + .06, .18);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${blur.subtle}px)` };
  const style = { "--dock-item": `${ITEM}px`, "--dock-pad": `${PAD}px`, "--dock-gap": `${GAP}px`, "--dock-tray-item": `${TRAY_ITEM}px`, "--dock-tray-pad": `${TRAY_PAD}px` } as CSSProperties;

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} style={style} data-dragging={dragging ? "" : undefined} onPointerLeave={() => unhint(140)}>
    <svg className={styles.surface} width={width} height={BAR} aria-hidden="true"><motion.path d={path} /></svg>

    {group && <motion.div id={`${uid}-tray`} role="group" aria-label={group.label} className={styles.tray} data-open={openGroup === group.id || undefined} inert={openGroup !== group.id}
      style={{ x: trayX, opacity: trayOpacity, width: trayWidth }}>
      {members.map((member, i) => <motion.button key={member.id} ref={node => { if (node) trayRefs.current.set(member.id, node); else trayRefs.current.delete(member.id); }}
        type="button" className={styles.trayItem} aria-pressed={member.id === value} aria-label={member.shortcut ? `${member.label}, ${member.shortcut}` : member.label}
        tabIndex={member.id === (memberOf(group)?.id) ? 0 : -1}
        initial={reduced ? false : { opacity: 0, y: 8, scale: .9 }} animate={openGroup === group.id || reduced ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 6, scale: .92 }}
        transition={reduced ? instant : openGroup === group.id ? { ...spring.snappy, delay: .08 + i * motionTokens.stagger.item } : { duration: duration.fast, ease: [...ease.standard] }}
        onClick={() => choose(member, group)} onKeyDown={event => onTrayKey(event, i)}
        onPointerEnter={event => { if (event.pointerType === "mouse") hint(member, true); }} onPointerLeave={() => unhint()}
        onFocus={event => showFocusHint(event.currentTarget, member, true)} onBlur={() => unhint()}>
        <span className={styles.icon}>{member.icon}</span>
      </motion.button>)}
    </motion.div>}

    <LayoutGroup id={uid}>
      <Reorder.Group as="div" ref={barRef} axis="x" values={items} role="toolbar" aria-label={label} aria-orientation="horizontal" className={styles.bar}
        onReorder={(next: DockItem[]) => {
          if (!onItemsChange || !dragging) return;
          const index = next.findIndex(item => item.id === dragging);
          onItemsChange(next, { type: "move", id: dragging, index });
        }}>
        {items.map((item, index) => {
          const isGroup = !!item.items?.length;
          const face = isGroup ? memberOf(item) ?? item : item;
          const selected = selectedTop === item.id;
          const tipFor = isGroup ? { ...item, label: face.label === item.label ? item.label : `${item.label}: ${face.label}`, shortcut: face.shortcut ?? item.shortcut } : item;
          return <Reorder.Item key={item.id} as="div" value={item} className={styles.slot} drag={onItemsChange ? "x" : false} dragConstraints={barRef} dragElastic={.14}
            layout="position" transition={layoutTransition}
            whileDrag={reduced ? undefined : { scale: 1.12, zIndex: 3 }}
            onDragStart={() => { dragged.current = true; setDragging(item.id); setOpenGroup(null); setTip(null); window.clearTimeout(timers.current.show); }}
            onDragEnd={() => { setDragging(null); requestAnimationFrame(() => { dragged.current = false; }); }}>
            {selected && <motion.span layoutId="selection" className={styles.selection} transition={selectionTransition} aria-hidden="true" />}
            <button ref={node => { if (node) buttonRefs.current.set(item.id, node); else buttonRefs.current.delete(item.id); }} type="button"
              className={styles.item} data-selected={selected || undefined} data-open={openGroup === item.id || undefined}
              aria-pressed={isGroup ? undefined : selected} aria-haspopup={isGroup ? "true" : undefined} aria-expanded={isGroup ? openGroup === item.id : undefined}
              aria-controls={isGroup && openGroup === item.id ? `${uid}-tray` : undefined}
              aria-label={`${tipFor.label}${tipFor.shortcut ? `, ${tipFor.shortcut}` : ""}${item.badge ? `, ${item.badge}` : ""}${isGroup && selected ? ", selected" : ""}`}
              tabIndex={focusId === item.id || (!items.some(other => other.id === focusId) && index === 0) ? 0 : -1}
              onClick={() => press(item)} onKeyDown={event => onBarKey(event, index)} onFocus={event => { setFocusId(item.id); showFocusHint(event.currentTarget, tipFor, false); }} onBlur={() => unhint()}
              onPointerEnter={event => { if (event.pointerType === "mouse") hint(tipFor, false); }} onPointerLeave={() => unhint()}>
              <span className={styles.icon}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={face.id} className={styles.glyph} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .6, filter: `blur(${blur.subtle}px)` }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .6, filter: `blur(${blur.subtle}px)` }}
                    transition={reduced ? { duration: .12 } : spring.snappy}>{face.icon}</motion.span>
                </AnimatePresence>
              </span>
              {isGroup && <span className={styles.caret} aria-hidden="true" />}
              {item.badge !== undefined && <span className={styles.badgeAnchor}><Badge count={item.badge} reduced={reduced} /></span>}
            </button>
          </Reorder.Item>;
        })}
      </Reorder.Group>
    </LayoutGroup>

    <motion.div className={styles.tip} style={{ transform: tipTransform, width: tipWidth, opacity: tipOn }} aria-hidden="true">
      <span ref={tipMeasure} className={`${styles.tipRow} ${styles.measure}`}>{shownTip?.label}{shownTip?.shortcut && <kbd className={styles.kbd}>{shownTip.shortcut}</kbd>}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        {shownTip && <motion.span key={shownTip.id + shownTip.label} className={styles.tipRow} initial={hidden} animate={{ opacity: 1, y: "0em", filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0, transition: { duration: .08 } } : { opacity: 0, y: "-0.35em", filter: `blur(${blur.subtle}px)`, transition: { duration: .12 } }}
          transition={reduced ? { duration: .12 } : { duration: .18, ease: [...ease.enter] }}>
          {shownTip.label}{shownTip.shortcut && <kbd className={styles.kbd}>{shownTip.shortcut}</kbd>}
        </motion.span>}
      </AnimatePresence>
    </motion.div>
  </div>;
}

export default Dock;
