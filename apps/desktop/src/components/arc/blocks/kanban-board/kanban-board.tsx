"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { AlertTriangle, CalendarDays, ListChecks, Plus, X } from "lucide-react";
import { motionTokens } from "../../lib/motion-tokens";
import { DropdownMenu } from "../../dropdown-menu/dropdown-menu";
import { sampleCards, sampleColumns, samplePeople } from "./kanban-board-data";
import type { KanbanCard, KanbanColumn, KanbanPerson } from "./kanban-board-data";
import styles from "./kanban-board.module.css";

/**
 * A kanban board with physical drag and drop. A lifted card follows the pointer from where you grabbed it and tilts with
 * its speed, a slot opens where it will land while neighbours glide aside, the board scrolls when you reach an edge, and on
 * release the card springs into the slot carrying your throw. Group by assignee to split the board into swimlanes; the
 * cards fly to their lanes. Columns count against WIP limits live while you drag. Space lifts a card from the keyboard.
 */

export type { KanbanCard, KanbanChecklistItem, KanbanColumn, KanbanPerson } from "./kanban-board-data";
export type KanbanGroupBy = "status" | "assignee";

export interface KanbanBoardProps {
  columns?: KanbanColumn[];
  people?: KanbanPerson[];
  /** Controlled cards, in board order. */
  cards?: KanbanCard[];
  /** Initial cards when uncontrolled. */
  defaultCards?: KanbanCard[];
  /** Called with the full card list after every move, edit, or new card. */
  onCardsChange?: (cards: KanbanCard[]) => void;
  defaultGroupBy?: KanbanGroupBy;
  /** Person id that new cards are assigned to. */
  currentUser?: string;
  title?: string;
  className?: string;
  /** Pensée patch: when set, clicking a card (or Enter on it) calls this instead of opening the details drawer. */
  onCardOpen?: (card: KanbanCard, event: { metaKey: boolean; ctrlKey: boolean }) => void;
  /** Pensée patch: false hides the title, count and Status/Swimlanes switch, for a page that has its own header. */
  toolbar?: boolean;
  /** Pensée patch: false hides the id on each card. */
  showIds?: boolean;
  /** Pensée patch: what one card is called, for "Add card", "Card title" and the add buttons' labels. */
  noun?: string;
  /** Pensée patch: renders the add field for a column in place of the block's own textarea; `close` hides it. */
  composer?: (column: string, close: () => void) => ReactNode;
}

interface DragState { id: string; cell: string; index: number; width: number; height: number; origin: { cell: string; index: number }; dropping: boolean }
interface Pending { id: string; x: number; y: number; pointerId: number; touch: boolean; element: HTMLElement; armed: boolean; timer?: number }

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const SEP = "|";
const cellKey = (column: string, lane?: string) => lane ? `${lane}${SEP}${column}` : column;
const parseCell = (key: string) => { const at = key.indexOf(SEP); return at < 0 ? { column: key, lane: undefined } : { lane: key.slice(0, at), column: key.slice(at + 1) }; };
const cx = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
const inCell = (card: KanbanCard, key: string) => { const { column, lane } = parseCell(key); return card.column === column && (!lane || card.assignee === lane); };

function Roll({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const chars = Array.from(String(value));
  return <span className={styles.roll}>
    {chars.map((char, index) => <span key={chars.length - index} className={styles.rollDigit} aria-hidden="true">
      <motion.span className={styles.rollStrip} initial={false} animate={{ y: `${Number(char) * -10}%` }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}>
        {DIGITS.map(digit => <span key={digit}>{digit}</span>)}
      </motion.span>
    </span>)}
    <span className={styles.srOnly}>{value}</span>
  </span>;
}

function Face({ person, size = 22 }: { person?: KanbanPerson; size?: number }) {
  if (!person) return null;
  const initials = person.name.split(" ").map(part => part[0]).join("").slice(0, 2);
  return <span className={styles.face} style={{ width: size, height: size }} title={person.name}>
    {/* Pensée patch: a plain img, Pensée is not a Next app. */}
    {person.avatar ? <img src={person.avatar} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : <span aria-hidden="true">{initials}</span>}
  </span>;
}

interface CardViewProps { card: KanbanCard; person?: KanbanPerson; lifted?: boolean; showIds?: boolean }
const CardView = memo(function CardView({ card, person, lifted, showIds = true }: CardViewProps) {
  const done = card.checklist?.filter(item => item.done).length ?? 0;
  const total = card.checklist?.length ?? 0;
  return <div className={styles.cardInner} data-lifted={lifted || undefined}>
    {/* Pensée patch: showIds hides the id row when ids are not meaningful (they are note paths). */}
    {showIds || card.label ? <div className={styles.cardTop}>{showIds ? <span className={styles.cardId}>{card.id}</span> : null}{card.label ? <span className={styles.label} data-label={card.label}>{card.label}</span> : null}</div> : null}
    <p className={styles.cardTitle}>{card.title}</p>
    {/* Pensée patch: no meta row when there is nothing to show in it. */}
    {card.meta || card.due || total || card.points || person ? <div className={styles.cardMeta}>
      {card.meta}
      {card.due ? <span className={styles.metaItem}><CalendarDays size={13} aria-hidden="true" />{card.due}</span> : null}
      {total ? <span className={styles.metaItem} data-complete={done === total || undefined}><ListChecks size={13} aria-hidden="true" />{done}/{total}</span> : null}
      {card.points ? <span className={styles.metaItem} aria-label={`${card.points} points`}>{card.points} pt</span> : null}
      <span className={styles.metaFace}><Face person={person} /></span>
    </div> : null}
  </div>;
});

export function KanbanBoard({
  columns = sampleColumns,
  people = samplePeople,
  cards: controlled,
  defaultCards = sampleCards,
  onCardsChange,
  defaultGroupBy = "status",
  currentUser = samplePeople[0].id,
  title = "Billing v2",
  className,
  onCardOpen,
  toolbar = true,
  showIds = true,
  noun = "card",
  composer: renderComposer, // Pensée patch: Projects renders its own add field
}: KanbanBoardProps) {
  const uid = useId();
  const reduced = useReducedMotion() ?? false;
  const [inner, setInner] = useState(defaultCards);
  const cards = controlled ?? inner;
  const cardsRef = useRef(cards);
  useLayoutEffect(() => { cardsRef.current = cards; });
  const commit = useCallback((next: KanbanCard[]) => { cardsRef.current = next; if (!controlled) setInner(next); onCardsChange?.(next); }, [controlled, onCardsChange]);

  const [groupBy, setGroupBy] = useState<KanbanGroupBy>(defaultGroupBy);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => { dragRef.current = next; setDragState(next); };
  const [generation, setGeneration] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [lifted, setLifted] = useState<{ id: string; snapshot: KanbanCard[] } | null>(null);
  const [composer, setComposer] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const grab = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0, t: 0, px: 0, py: 0 });
  const suppressClick = useRef(false);
  const returnFocus = useRef<string | null>(null);

  const ox = useMotionValue(0);
  const oy = useMotionValue(0);
  const tilt = useSpring(0, { stiffness: 380, damping: 26 });

  const personById = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const columnName = (id: string) => columns.find(column => column.id === id)?.name ?? id;
  const lanes = groupBy === "assignee" ? people.map(person => person.id) : [undefined];

  /** Moves a card into a cell at an index counted among that cell's other cards. */
  const move = useCallback((list: KanbanCard[], id: string, key: string, index: number) => {
    const card = list.find(item => item.id === id);
    if (!card) return list;
    const { column, lane } = parseCell(key);
    const moved = { ...card, column, assignee: lane ?? card.assignee };
    const rest = list.filter(item => item.id !== id);
    const peers = rest.filter(item => inCell(item, key));
    const before = peers[index];
    const at = before ? rest.indexOf(before) : peers.length ? rest.indexOf(peers[peers.length - 1]) + 1 : rest.length;
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  }, []);

  const cellOf = useCallback((id: string, list = cardsRef.current) => {
    const card = list.find(item => item.id === id);
    if (!card) return null;
    const key = cellKey(card.column, groupBy === "assignee" ? card.assignee : undefined);
    return { key, index: list.filter(item => inCell(item, key)).findIndex(item => item.id === id) };
  }, [groupBy]);

  /* ----------------------------------------------------------------------------------------------------------------
   * Pointer drag
   * -------------------------------------------------------------------------------------------------------------- */

  const locate = useCallback((x: number, y: number) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const cells = Array.from(frame.querySelectorAll<HTMLElement>("[data-cell]"));
    let target: HTMLElement | undefined;
    let best = Infinity;
    for (const element of cells) {
      const rect = element.getBoundingClientRect();
      if (y < rect.top - 12 || y > rect.bottom + 12) continue;
      const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (distance < best) { best = distance; target = element; }
    }
    if (!target || best > 40) return null;
    const items = Array.from(target.querySelectorAll<HTMLElement>("[data-card-id]"));
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { index = i; break; }
    }
    return { cell: target.dataset.cell!, index };
  }, []);

  const relocate = useCallback(() => {
    const current = dragRef.current;
    if (!current || current.dropping) return;
    const spot = locate(pointer.current.x, pointer.current.y);
    if (spot && (spot.cell !== current.cell || spot.index !== current.index)) setDrag({ ...current, ...spot });
  }, [locate]);

  const placeOverlay = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    ox.set(pointer.current.x - rect.left - grab.current.x);
    oy.set(pointer.current.y - rect.top - grab.current.y);
  }, [ox, oy]);

  const begin = useCallback((info: Pending) => {
    const frame = frameRef.current;
    const spot = cellOf(info.id);
    if (!frame || !spot) return;
    const rect = info.element.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    grab.current = { x: info.x - rect.left, y: info.y - rect.top };
    ox.set(rect.left - frameRect.left);
    oy.set(rect.top - frameRect.top);
    velocity.current = { x: 0, y: 0, t: performance.now(), px: info.x, py: info.y };
    setDrag({ id: info.id, cell: spot.key, index: spot.index, width: rect.width, height: rect.height, origin: { cell: spot.key, index: spot.index }, dropping: false });
    suppressClick.current = true;
    const card = cardsRef.current.find(item => item.id === info.id);
    setAnnouncement(`Picked up ${card?.title}.`);
  }, [cellOf, ox, oy]);

  // Auto scroll: the closer the pointer is to an edge of the board, the faster it scrolls.
  useEffect(() => {
    if (!drag || drag.dropping) return;
    let frame = 0;
    const tick = () => {
      const scroller = scrollerRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const edge = Math.min(64, rect.width / 5);
        const speed = (distance: number) => distance <= 0 ? 0 : Math.ceil(20 * Math.min(1, distance / edge) ** 2);
        const { x, y } = pointer.current;
        const dx = speed(rect.left + edge - x) * -1 + speed(x - (rect.right - edge));
        const dy = speed(rect.top + edge - y) * -1 + speed(y - (rect.bottom - edge));
        if (dx || dy) {
          const left = scroller.scrollLeft, top = scroller.scrollTop;
          scroller.scrollLeft += dx;
          scroller.scrollTop += dy;
          if (scroller.scrollLeft !== left || scroller.scrollTop !== top) relocate();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag, relocate]);

  const drop = useCallback((cancel = false) => {
    const current = dragRef.current;
    if (!current || current.dropping) return;
    const next = cancel ? { ...current, ...current.origin, dropping: true } : { ...current, dropping: true };
    setDrag(next);
    tilt.set(0);
    const { column: target } = parseCell(next.cell);
    const card = cardsRef.current.find(item => item.id === next.id);
    setAnnouncement(cancel ? `${card?.title} returned.` : `Dropped ${card?.title} in ${columnName(target)}.`);
    const finish = () => {
      if (!cancel) commit(move(cardsRef.current, next.id, next.cell, next.index));
      setGeneration(map => ({ ...map, [next.id]: (map[next.id] ?? 0) + 1 }));
      setDrag(null);
    };
    if (reduced) { requestAnimationFrame(finish); return; }
    // A small spring chases the slot's live position, so it lands correctly even while neighbours are still gliding.
    let vx = velocity.current.x, vy = velocity.current.y, last = performance.now();
    const k = 460, c = 2 * Math.sqrt(k) * .8;
    const step = (now: number) => {
      const frame = frameRef.current;
      const slot = frame?.querySelector<HTMLElement>("[data-placeholder]");
      if (!frame || !slot) { finish(); return; }
      const dt = Math.min(.032, (now - last) / 1000);
      last = now;
      const frameRect = frame.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const tx = slotRect.left - frameRect.left, ty = slotRect.top - frameRect.top;
      const x = ox.get(), y = oy.get();
      vx += (k * (tx - x) - c * vx) * dt;
      vy += (k * (ty - y) - c * vy) * dt;
      ox.set(x + vx * dt);
      oy.set(y + vy * dt);
      if (Math.abs(tx - x) < .5 && Math.abs(ty - y) < .5 && Math.abs(vx) < 20 && Math.abs(vy) < 20) { ox.set(tx); oy.set(ty); finish(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, move, reduced, ox, oy, tilt]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const info = pending.current;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (info && event.pointerId === info.pointerId && !dragRef.current) {
        const distance = Math.hypot(event.clientX - info.x, event.clientY - info.y);
        if (info.touch && !info.armed) { if (distance > 8) { window.clearTimeout(info.timer); pending.current = null; } return; }
        if (distance > 5) begin(info);
        else return;
      }
      const current = dragRef.current;
      if (!current || current.dropping || (info && event.pointerId !== info.pointerId)) return;
      const now = performance.now();
      const v = velocity.current;
      const dt = Math.max(1, now - v.t);
      v.x = v.x * .6 + ((event.clientX - v.px) / dt * 1000) * .4;
      v.y = v.y * .6 + ((event.clientY - v.py) / dt * 1000) * .4;
      v.t = now; v.px = event.clientX; v.py = event.clientY;
      if (!reduced) tilt.set(Math.max(-7, Math.min(7, v.x / 160)));
      placeOverlay();
      relocate();
    };
    const onUp = (event: PointerEvent) => {
      const info = pending.current;
      if (info && event.pointerId !== info.pointerId) return;
      if (info) window.clearTimeout(info.timer);
      pending.current = null;
      if (dragRef.current) drop(event.type === "pointercancel");
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && dragRef.current) { event.preventDefault(); drop(true); } };
    const onTouchMove = (event: TouchEvent) => { if (dragRef.current || pending.current?.armed) event.preventDefault(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [begin, drop, placeOverlay, reduced, relocate, tilt]);

  const onCardPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || dragRef.current || lifted) return;
    suppressClick.current = false;
    const touch = event.pointerType !== "mouse";
    const info: Pending = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch, element: event.currentTarget, armed: !touch };
    pointer.current = { x: event.clientX, y: event.clientY };
    // Touch waits for a short press, so a swipe still scrolls the board.
    if (touch) info.timer = window.setTimeout(() => { if (pending.current === info) { info.armed = true; begin(info); } }, 240);
    pending.current = info;
  };

  /* ----------------------------------------------------------------------------------------------------------------
   * Keyboard lift
   * -------------------------------------------------------------------------------------------------------------- */

  const focusCard = (id: string) => requestAnimationFrame(() => frameRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false }));

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, card: KanbanCard) => {
    if (event.key === " " && !lifted) {
      event.preventDefault();
      setLifted({ id: card.id, snapshot: cardsRef.current });
      const spot = cellOf(card.id);
      setAnnouncement(`Lifted ${card.title}. ${columnName(card.column)}, position ${(spot?.index ?? 0) + 1}. Use arrow keys to move, space to drop, escape to cancel.`);
      return;
    }
    if (!lifted || lifted.id !== card.id) return;
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); setLifted(null); setAnnouncement(`Dropped ${card.title} in ${columnName(card.column)}.`); return; }
    if (event.key === "Escape") { event.preventDefault(); commit(lifted.snapshot); setLifted(null); setAnnouncement(`${card.title} returned.`); focusCard(card.id); return; }
    const spot = cellOf(card.id);
    if (!spot) return;
    const { column, lane } = parseCell(spot.key);
    const columnIndex = columns.findIndex(item => item.id === column);
    let key = spot.key, index = spot.index;
    if (event.key === "ArrowUp" && event.shiftKey && lane) { const at = people.findIndex(p => p.id === lane); if (at > 0) key = cellKey(column, people[at - 1].id); }
    else if (event.key === "ArrowDown" && event.shiftKey && lane) { const at = people.findIndex(p => p.id === lane); if (at < people.length - 1) key = cellKey(column, people[at + 1].id); }
    else if (event.key === "ArrowUp") index = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") index = index + 1;
    else if (event.key === "ArrowLeft" && columnIndex > 0) key = cellKey(columns[columnIndex - 1].id, lane);
    else if (event.key === "ArrowRight" && columnIndex < columns.length - 1) key = cellKey(columns[columnIndex + 1].id, lane);
    else return;
    event.preventDefault();
    if (key !== spot.key) index = Math.min(index, cardsRef.current.filter(item => item.id !== card.id && inCell(item, key)).length);
    const next = move(cardsRef.current, card.id, key, index);
    commit(next);
    const target = parseCell(key);
    const position = next.filter(item => inCell(item, key)).findIndex(item => item.id === card.id) + 1;
    setAnnouncement(`${columnName(target.column)}${target.lane ? `, ${personById.get(target.lane)?.name}` : ""}, position ${position}.`);
    focusCard(card.id);
  };

  /* ----------------------------------------------------------------------------------------------------------------
   * Quick add and details
   * -------------------------------------------------------------------------------------------------------------- */

  const addCard = (key: string) => {
    const text = draft.trim();
    if (!text) { setComposer(null); return; }
    const { column, lane } = parseCell(key);
    const highest = cardsRef.current.reduce((max, card) => Math.max(max, Number(card.id.replace(/\D/g, "")) || 0), 0);
    const card: KanbanCard = { id: `BIL-${highest + 1}`, title: text, column, assignee: lane ?? currentUser };
    commit(move([...cardsRef.current, card], card.id, key, Number.MAX_SAFE_INTEGER));
    setDraft("");
    setAnnouncement(`Added ${text} to ${columnName(column)}.`);
  };

  const openCard = (id: string) => { returnFocus.current = id; setOpenId(id); };
  const closeCard = () => { setOpenId(null); if (returnFocus.current) focusCard(returnFocus.current); };
  const updateCard = (id: string, patch: Partial<KanbanCard>) => commit(cardsRef.current.map(card => card.id === id ? { ...card, ...patch } : card));

  /* ----------------------------------------------------------------------------------------------------------------
   * Render
   * -------------------------------------------------------------------------------------------------------------- */

  const dragCard = drag ? cards.find(card => card.id === drag.id) : undefined;
  const counts = new Map(columns.map(column => [column.id, cards.filter(card => card.column === column.id).length]));
  if (drag && dragCard) {
    const target = parseCell(drag.cell).column;
    counts.set(dragCard.column, (counts.get(dragCard.column) ?? 1) - 1);
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const over = (column: KanbanColumn) => column.limit !== undefined && (counts.get(column.id) ?? 0) > column.limit;
  const layoutTransition = reduced ? { duration: 0 } : motionTokens.spring.smooth;
  const openCardData = openId ? cards.find(card => card.id === openId) : undefined;

  const renderCell = (column: KanbanColumn, lane?: string) => {
    const key = cellKey(column.id, lane);
    const list = cards.filter(card => inCell(card, key) && card.id !== drag?.id);
    const slot = drag && drag.cell === key ? drag.index : -1;
    const warn = drag && drag.cell === key && over(column);
    const items: ReactNode[] = list.map(card => {
      const isLifted = lifted?.id === card.id;
      return <motion.div
        key={card.id}
        layoutId={`${uid}-${card.id}-${generation[card.id] ?? 0}`}
        layout="position"
        transition={layoutTransition}
        className={styles.card}
        data-card-id={card.id}
        data-lifted={isLifted || undefined}
        role="button"
        tabIndex={0}
        aria-roledescription="Draggable card"
        aria-label={`${card.title}, ${card.id}, ${personById.get(card.assignee)?.name ?? "Unassigned"}`}
        aria-pressed={isLifted || undefined}
        onPointerDown={event => onCardPointerDown(event, card.id)}
        onClick={event => { if (suppressClick.current) { suppressClick.current = false; return; } if (!lifted) { if (onCardOpen) onCardOpen(card, event); else openCard(card.id); } }}
        onKeyDown={event => { if (event.key === "Enter" && !lifted) { event.preventDefault(); if (onCardOpen) onCardOpen(card, event); else openCard(card.id); return; } onCardKeyDown(event, card); }}
      >
        <CardView card={card} person={personById.get(card.assignee)} lifted={isLifted} showIds={showIds} />
      </motion.div>;
    });
    if (slot >= 0) items.splice(slot, 0, <motion.div key="placeholder" layout="position" transition={layoutTransition} data-placeholder="" className={styles.placeholder} data-warn={warn || undefined} style={{ height: drag!.height }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {warn ? <span className={styles.placeholderNote}><AlertTriangle size={14} aria-hidden="true" /> Over the limit of {column.limit}</span> : null}
    </motion.div>);
    const composing = composer === key;
    return <div key={key} className={styles.cell} data-cell={key} data-over={over(column) || undefined} data-target={drag && drag.cell === key && !drag.dropping ? "" : undefined}>
      {items}
      <AnimatePresence initial={false}>
        {composing && renderComposer ? <motion.div key="composer" className={styles.composer} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={layoutTransition}>{renderComposer(column.id, () => setComposer(null))}</motion.div> : composing ? <motion.form key="composer" className={styles.composer} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={layoutTransition} onSubmit={event => { event.preventDefault(); addCard(key); }}>
          <textarea autoFocus rows={2} value={draft} placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`} aria-label={`New ${noun} in ${column.name}`} onChange={event => setDraft(event.target.value)} onBlur={() => { if (!draft.trim()) setComposer(null); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addCard(key); } if (event.key === "Escape") { setComposer(null); setDraft(""); } }} />
          <div className={styles.composerActions}><button type="submit" className={styles.primarySmall} disabled={!draft.trim()}>Add {noun}</button><button type="button" className={styles.ghostSmall} onMouseDown={event => event.preventDefault()} onClick={() => { setComposer(null); setDraft(""); }}>Cancel</button></div>
        </motion.form> : groupBy === "status" ? <motion.button key="add" type="button" layout="position" transition={layoutTransition} className={styles.addRow} onClick={() => { setDraft(""); setComposer(key); }}><Plus size={14} aria-hidden="true" /> Add {noun}</motion.button> : null}
      </AnimatePresence>
    </div>;
  };

  return <MotionConfig reducedMotion="user">
    <div ref={frameRef} className={cx(styles.frame, className)} data-dragging={drag ? "" : undefined}>
      {toolbar ? <header className={styles.toolbar}>
        <div className={styles.heading}><h2>{title}</h2><span className={styles.total}><Roll value={cards.length} /> cards</span></div>
        <div className={styles.group} role="radiogroup" aria-label="Group by">
          {(["status", "assignee"] as const).map(option => <button key={option} type="button" role="radio" aria-checked={groupBy === option} className={styles.groupOption} onClick={() => { setGroupBy(option); setComposer(null); }}>
            {groupBy === option ? <motion.span layoutId={`${uid}-group`} className={styles.groupPill} transition={motionTokens.spring.morph} /> : null}
            <span>{option === "status" ? "Status" : "Swimlanes"}</span>
          </button>)}
        </div>
      </header> : null}

      <LayoutGroup id={uid}>
        <motion.div ref={scrollerRef} layoutScroll className={styles.scroller}>
          <div className={styles.board} style={{ ["--cols" as string]: columns.length }} data-mode={groupBy}>
            <div className={styles.headRow}>
              {columns.map(column => {
                const count = counts.get(column.id) ?? 0;
                const isOver = over(column);
                return <div key={column.id} className={styles.columnHead} data-over={isOver || undefined}>
                  <span className={styles.columnName}>{column.label ?? column.name}</span>
                  <span className={styles.count} aria-label={column.limit ? `${count} of ${column.limit}` : `${count} cards`}><Roll value={count} />{column.limit ? <span className={styles.limit}>/{column.limit}</span> : null}</span>
                  <AnimatePresence initial={false}>{isOver ? <motion.span key="over" className={styles.overTag} initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={motionTokens.spring.snappy}>Over limit</motion.span> : null}</AnimatePresence>
                  <button type="button" className={styles.iconButton} aria-label={`Add ${noun} to ${column.name}`} onClick={() => { setDraft(""); setComposer(cellKey(column.id, groupBy === "assignee" ? currentUser : undefined)); }}><Plus size={15} /></button>
                </div>;
              })}
            </div>
            {lanes.map(lane => {
              const person = lane ? personById.get(lane) : undefined;
              return <section key={lane ?? "all"} className={styles.lane} aria-label={person ? `${person.name} lane` : undefined}>
                {person ? <div className={styles.laneHead}><Face person={person} size={24} /><span>{person.name}</span><span className={styles.laneCount}><Roll value={cards.filter(card => card.assignee === lane && card.id !== drag?.id).length + (drag && parseCell(drag.cell).lane === lane ? 1 : 0)} /></span></div> : null}
                <div className={styles.row}>{columns.map(column => renderCell(column, lane))}</div>
              </section>;
            })}
          </div>
        </motion.div>
      </LayoutGroup>

      {drag && dragCard ? <motion.div className={styles.overlay} style={{ x: ox, y: oy, rotate: tilt, width: drag.width }} aria-hidden="true">
        <motion.div className={styles.overlayCard} initial={{ scale: 1 }} animate={{ scale: drag.dropping ? 1 : 1.035 }} transition={motionTokens.spring.snappy} data-dropping={drag.dropping || undefined}>
          <CardView card={dragCard} person={personById.get(dragCard.assignee)} showIds={showIds} />
        </motion.div>
      </motion.div> : null}

      <AnimatePresence>
        {openCardData ? <CardDrawer key="drawer" uid={uid} card={openCardData} columns={columns} people={people} onClose={closeCard} onChange={patch => updateCard(openCardData.id, patch)} /> : null}
      </AnimatePresence>
      <p className={styles.srOnly} aria-live="assertive">{announcement}</p>
    </div>
  </MotionConfig>;
}

function CardDrawer({ uid, card, columns, people, onClose, onChange }: { uid: string; card: KanbanCard; columns: KanbanColumn[]; people: KanbanPerson[]; onClose: () => void; onChange: (patch: Partial<KanbanCard>) => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [newItem, setNewItem] = useState("");
  const done = card.checklist?.filter(item => item.done).length ?? 0;
  const total = card.checklist?.length ?? 0;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); }, []);
  // The title grows with its text instead of scrolling inside a fixed box.
  useLayoutEffect(() => { const el = titleRef.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [card.title]);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button, input, textarea, select")).filter(item => !item.hasAttribute("disabled"));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <>
    <motion.div className={styles.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard] }} onClick={onClose} />
    <motion.div ref={panelRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby={`${uid}-drawer-title`} initial={{ x: "104%" }} animate={{ x: 0 }} exit={{ x: "104%" }} transition={motionTokens.spring.smooth} onKeyDown={onKeyDown}>
      <div className={styles.drawerHead}>
        <span id={`${uid}-drawer-title`} className={styles.cardId}>{card.id}</span>
        <button type="button" className={styles.iconButton} aria-label="Close details" onClick={onClose}><X size={16} /></button>
      </div>
      <textarea ref={titleRef} className={styles.titleInput} value={card.title} rows={1} aria-label="Title" onChange={event => onChange({ title: event.target.value.replace(/\n/g, " ") })} />
      <div className={styles.statusRow} role="radiogroup" aria-label="Status">
        {columns.map(column => <button key={column.id} type="button" role="radio" aria-checked={card.column === column.id} className={styles.statusOption} onClick={() => onChange({ column: column.id })}>
          {card.column === column.id ? <motion.span layoutId={`${uid}-status`} className={styles.statusPill} transition={motionTokens.spring.morph} /> : null}
          <span>{column.name}</span>
        </button>)}
      </div>
      <dl className={styles.props}>
        <div><dt>Assignee</dt><dd><span className={styles.selectRow}><DropdownMenu label={people.find(person => person.id === card.assignee)?.name ?? "Unassigned"} icon={<Face person={people.find(person => person.id === card.assignee)} size={20} />} items={people.map(person => ({ label: person.name, icon: <Face person={person} size={20} />, onSelect: () => onChange({ assignee: person.id }) }))} /></span></dd></div>
        <div><dt>Label</dt><dd>{card.label ?? "None"}</dd></div>
        <div><dt>Due</dt><dd>{card.due ?? "No date"}</dd></div>
        <div><dt>Estimate</dt><dd>{card.points ? `${card.points} points` : "None"}</dd></div>
      </dl>
      <label className={styles.drawerLabel} htmlFor={`${uid}-description`}>Description</label>
      <textarea id={`${uid}-description`} className={styles.description} rows={3} value={card.description ?? ""} placeholder="Add context for the team" onChange={event => onChange({ description: event.target.value })} />
      <div className={styles.checklistHead}><span className={styles.drawerLabel}>Checklist</span>{total ? <span className={styles.checkCount}><Roll value={done} />/{total}</span> : null}</div>
      {total ? <div className={styles.progress} data-complete={done === total || undefined} aria-hidden="true"><motion.span initial={false} animate={{ scaleX: done / total }} transition={motionTokens.spring.smooth} /></div> : null}
      <ul className={styles.checklist}>
        <AnimatePresence initial={false}>
          {card.checklist?.map(item => <motion.li key={item.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={motionTokens.spring.smooth}>
            <label className={styles.checkItem} data-done={item.done || undefined}>
              <input type="checkbox" className={styles.srOnly} checked={item.done} onChange={() => onChange({ checklist: card.checklist!.map(entry => entry.id === item.id ? { ...entry, done: !entry.done } : entry) })} />
              <span className={styles.box} aria-hidden="true"><svg viewBox="0 0 16 16" width="11" height="11"><motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={false} animate={{ pathLength: item.done ? 1 : 0, opacity: item.done ? 1 : 0 }} transition={motionTokens.spring.snappy} /></svg></span>
              <span>{item.text}</span>
            </label>
          </motion.li>)}
        </AnimatePresence>
      </ul>
      <form className={styles.checkAdd} onSubmit={event => { event.preventDefault(); if (!newItem.trim()) return; onChange({ checklist: [...(card.checklist ?? []), { id: `n${Date.now()}`, text: newItem.trim(), done: false }] }); setNewItem(""); }}>
        <input value={newItem} placeholder="Add an item" aria-label="New checklist item" onChange={event => setNewItem(event.target.value)} />
        <button type="submit" className={styles.ghostSmall} disabled={!newItem.trim()}>Add</button>
      </form>
    </motion.div>
  </>;
}

export default KanbanBoard;
