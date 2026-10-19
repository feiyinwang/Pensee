import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Highlighter, Trash2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cursor02Icon } from "@hugeicons/core-free-icons";

import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import type { BookLocation as BookTabLocation } from "@/components/editor-area/page-kinds/book";
import { askAgent, warmAgent } from "@/lib/agent-ask";
import { speak } from "@/lib/speak";
import { getFileStem } from "@/lib/paths";
import { useBookTips } from "@/hooks/use-tips";
import { stepBookTextSize } from "@/lib/book-text-size";
import { ReaderController, type ReaderStatus, type SelectionInfo } from "./reader-controller";
import styles from "./book-reader.module.css";
import "./book-reader.css";

// A PDF/EPUB tab (SPECs/book-reader-spec.md). React renders only the frame
// and the selection pill; ReaderController owns the book.

type Pill =
  | { kind: "selection"; selection: SelectionInfo; x: number; y: number }
  | { kind: "highlight"; id: string; x: number; y: number };

/** Up to this many words is a word or phrase to define; more is a passage
 *  to explain. */
const MAX_DEFINE_WORDS = 3;

function isOneWord(text: string): boolean {
  return !/\s/.test(text.trim());
}

function definePrompt(book: string, text: string): string {
  if (isOneWord(text))
    return `Define the word "${text}" as it's used in the book ${book}, in the passage I'm reading. Start with its pronunciation in IPA. Keep it short.`;
  return text.split(/\s+/).length <= MAX_DEFINE_WORDS
    ? `Define "${text}" as it's used in the book ${book}, in the passage I'm reading. Keep it short.`
    : `Explain what "${text}" means in the book ${book}, in the context of the passage I'm reading. Keep it short.`;
}

/** Define: ask the agent, and say a single word aloud. */
function define(book: string, text: string) {
  if (isOneWord(text)) speak(text);
  askAgent(definePrompt(book, text));
}

export default function BookReader({
  location,
  isShown,
}: {
  location: BookTabLocation;
  isActive: boolean;
  inColumn: boolean;
  isShown: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ReaderController | null>(null);
  const [status, setStatus] = useState<ReaderStatus>({ kind: "loading" });
  const [pill, setPill] = useState<Pill | null>(null);
  const [textSize, setTextSize] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const bookName = getFileStem(location.path);
  const isShownRef = useRef(isShown);
  isShownRef.current = isShown;

  // Define and Explain go to the agent, so have it running before they're asked.
  useEffect(() => warmAgent(), []);

  useBookTips(location.note ?? null);

  useEffect(() => {
    ensureArcTokens();
    const scroller = scrollerRef.current;
    const host = hostRef.current;
    if (!scroller || !host) return;
    setStatus({ kind: "loading" });
    const controller = new ReaderController(
      location.path,
      location.note ?? null,
      scroller,
      host,
      setStatus,
    );
    controller.setShown(isShownRef.current);
    controllerRef.current = controller;
    setTextSize(null);
    void controller.start();
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [location.path, location.note]);

  // A hidden tab's highlights leave the page's registry (highlight-painter.ts).
  // Before paint: a frame drawn with the tab hidden and its ranges still
  // registered costs ~half a second, and one drawn with the tab shown but
  // its pages still out of rendering flashes an empty column.
  useLayoutEffect(() => {
    controllerRef.current?.setShown(isShown);
  }, [isShown]);

  /** Viewport point → position inside the frame, above the given rect. */
  const pillAt = useCallback((rect: DOMRect) => {
    const frame = frameRef.current!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - frame.left, y: rect.top - frame.top };
  }, []);

  /** The pill for what is under (x, y): the selection, else a highlight
   *  there, else none. Left and right clicks both show it. */
  const showPillAt = useCallback(
    (x: number, y: number) => {
      const controller = controllerRef.current;
      if (!controller) return;
      const selection = controller.selection();
      if (selection) {
        setPill({ kind: "selection", selection, ...pillAt(selection.rect) });
        return;
      }
      const hit = controller.highlightAt(x, y);
      setPill(hit ? { kind: "highlight", id: hit.highlight.id, ...pillAt(hit.rect) } : null);
    },
    [pillAt],
  );

  const onMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      const { clientX, clientY } = event;
      // Let the selection settle (a double-click selects a word after mouseup).
      requestAnimationFrame(() => showPillAt(clientX, clientY));
    },
    [showPillAt],
  );

  // Right-click shows the same pill, never a second menu.
  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      showPillAt(event.clientX, event.clientY);
    },
    [showPillAt],
  );

  // The pill belongs to one spot in the text: scrolling or Escape drops it.
  // H highlights the selection it offers, as its Highlight button does.
  useEffect(() => {
    if (!pill) return;
    const scroller = scrollerRef.current;
    const close = () => setPill(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return close();
      if (pill.kind !== "selection" || event.key.toLowerCase() !== "h") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) {
        return;
      }
      event.preventDefault();
      const controller = controllerRef.current;
      if (controller) void controller.addHighlight(pill.selection);
      close();
    };
    scroller?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      scroller?.removeEventListener("scroll", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pill]);

  // The text size control is EPUB only: a PDF's text is part of its page.
  const isEpub = location.path.toLowerCase().endsWith(".epub");
  useEffect(() => {
    if (status.kind === "ready" && isEpub) setTextSize(controllerRef.current?.textSize ?? null);
  }, [status.kind, isEpub]);

  const stepTextSize = (direction: -1 | 1) => {
    const controller = controllerRef.current;
    if (!controller) return;
    const size = stepBookTextSize(controller.textSize, direction);
    controller.setTextSize(size);
    setTextSize(size);
  };

  const run = (action: (controller: ReaderController) => void) => {
    const controller = controllerRef.current;
    if (controller) action(controller);
    setPill(null);
  };

  return (
    <div ref={frameRef} className="book-reader">
      <div
        ref={scrollerRef}
        className="book-reader-scroller"
        onMouseUp={onMouseUp}
        onMouseDown={() => setPill(null)}
        onContextMenu={onContextMenu}
      >
        <div ref={hostRef} className="book-reader-pages" />
      </div>
      {status.kind === "loading" ? (
        <div className="book-reader-status">Opening {bookName}…</div>
      ) : null}
      {status.kind === "error" ? (
        <div className="book-reader-status" role="alert">
          Couldn't open {bookName}: {status.message}
        </div>
      ) : null}
      {textSize !== null ? (
        <TextSizeControl
          size={textSize}
          onStep={stepTextSize}
          reduceMotion={reduceMotion ?? false}
        />
      ) : null}
      <AnimatePresence>
        {pill ? (
          <motion.div
            key={`${pill.kind}-${pill.x}-${pill.y}`}
            className={styles.tray}
            style={{ left: pill.x, top: pill.y }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
            transition={
              reduceMotion
                ? { duration: motionTokens.duration.instant }
                : motionTokens.spring.snappy
            }
            onMouseDown={(event) => event.preventDefault()}
          >
            {pill.kind === "selection" ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => run((c) => void c.addHighlight(pill.selection))}
              >
                <Highlighter size={14} aria-hidden />
                Highlight
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                onClick={() => run((c) => void c.removeHighlight(pill.id))}
              >
                <Trash2 size={14} aria-hidden />
                Remove highlight
              </button>
            )}
            {pill.kind === "selection" ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => run(() => define(bookName, pill.selection.text))}
              >
                <HugeiconsIcon icon={Cursor02Icon} size={14} color="currentColor" strokeWidth={2} />
                Define
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Apple Books' "Aa": a button that opens smaller/larger text buttons. */
function TextSizeControl({
  size,
  onStep,
  reduceMotion,
}: {
  size: number;
  onStep: (direction: -1 | 1) => void;
  reduceMotion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const smallest = stepBookTextSize(size, -1) === size;
  const largest = stepBookTextSize(size, 1) === size;

  return (
    <div ref={rootRef} className={styles.textSize}>
      <button
        type="button"
        className={styles.textSizeTrigger}
        aria-label="Text size"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Aa
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className={`${styles.tray} ${styles.textSizeTray}`}
            role="group"
            aria-label="Text size"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
            transition={
              reduceMotion
                ? { duration: motionTokens.duration.instant }
                : motionTokens.spring.snappy
            }
          >
            <button
              type="button"
              className={`${styles.button} ${styles.textSizeStep}`}
              aria-label="Smaller text"
              disabled={smallest}
              onClick={() => onStep(-1)}
            >
              <span className={styles.smallA}>A</span>
            </button>
            <span className={styles.divider} aria-hidden />
            <button
              type="button"
              className={`${styles.button} ${styles.textSizeStep}`}
              aria-label="Larger text"
              disabled={largest}
              onClick={() => onStep(1)}
            >
              <span className={styles.largeA}>A</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
