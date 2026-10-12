import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Highlighter, Trash2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cursor02Icon } from "@hugeicons/core-free-icons";

import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import type { BookLocation as BookTabLocation } from "@/components/editor-area/page-kinds/book";
import { askAgent } from "@/lib/agent-ask";
import { getFileStem } from "@/lib/paths";
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

function definePrompt(book: string, text: string): string {
  return text.split(/\s+/).length <= MAX_DEFINE_WORDS
    ? `Define "${text}" as it's used in the book ${book}, in the passage I'm reading. Keep it short.`
    : `Explain what "${text}" means in the book ${book}, in the context of the passage I'm reading. Keep it short.`;
}

export default function BookReader({
  location,
}: {
  location: BookTabLocation;
  isActive: boolean;
  inColumn: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ReaderController | null>(null);
  const [status, setStatus] = useState<ReaderStatus>({ kind: "loading" });
  const [pill, setPill] = useState<Pill | null>(null);
  const reduceMotion = useReducedMotion();
  const bookName = getFileStem(location.path);

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
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [location.path, location.note]);

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
  useEffect(() => {
    if (!pill) return;
    const scroller = scrollerRef.current;
    const close = () => setPill(null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    scroller?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      scroller?.removeEventListener("scroll", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pill]);

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
                onClick={() => run(() => askAgent(definePrompt(bookName, pill.selection.text)))}
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
