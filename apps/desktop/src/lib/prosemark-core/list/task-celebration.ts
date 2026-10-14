/**
 * Task check celebration: when a todo's checkbox is toggled to checked, the
 * box pops (1 → 0.9 → 1.05 → 1), the tick draws in left to right, and six
 * dots burst outward and fade. Unchecking plays nothing.
 *
 * The box and tick are CSS-drawn on the prefix mark's `::before` / `::after`
 * (prosemark-theme.css), and CodeMirror rebuilds that span when the checked
 * class flips, so a CSS transition never sees a change. The motion is
 * therefore one-shot WAAPI on the new span's pseudo-elements, started only
 * from a checkbox toggle — never from a render, so loading or scrolling a
 * note full of checked todos stays still.
 *
 * The dots can't live in the content DOM (CodeMirror's observer would read
 * them as edits), so they go in a short-lived layer on `scrollDOM`, like
 * CodeMirror's own selection layers, and remove themselves on finish.
 *
 * Decoration over a finished state change: the doc already holds `[x]`,
 * nothing waits on the animation, and it ignores pointer events. Skipped
 * entirely under `prefers-reduced-motion`. See docs/motion.md.
 */

import type { Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** `--ease-out` from App.css, named here because WAAPI can't read `var()`.
 *  Set per keyframe so each segment eases, as in the reference; on the
 *  options it would bend the whole timeline and squash the offsets. */
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Box pop, tick draw and burst timings, from the reference TaskCheckbox. */
const POP_MS = 400;
const TICK_DELAY_MS = 60;
const TICK_MS = 200;
const BURST_MS = 500;

const DOT_COUNT = 6;
const DOT_SIZE_PX = 4;
/** Distance from the box centre each dot travels; alternates far / near. */
const DOT_FAR_PX = 19;
const DOT_NEAR_PX = 14;
const DOT_COLORS = ["var(--accent-solid)", "var(--text-muted)"] as const;

/** The checkbox toggle's userEvent; `computeCheckboxToggle` in ./index sets it. */
export const TOGGLE_CHECKBOX_EVENT = "input.toggle-checkbox";

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Positions of the `x` in tasks this update turned from `[ ]` to `[x]`. A
 *  later transaction in the same update maps each one forward. */
export function newlyCheckedTicks(transactions: readonly Transaction[]): number[] {
  let ticks: number[] = [];
  for (const tr of transactions) {
    ticks = ticks.map((pos) => tr.changes.mapPos(pos));
    if (!tr.isUserEvent(TOGGLE_CHECKBOX_EVENT)) continue;
    tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
      if (inserted.toString().toLowerCase() === "x") ticks.push(fromB);
    });
  }
  return ticks;
}

/** The checked prefix mark holding `pos`; the `x` sits inside it. */
function prefixElementAt(view: EditorView, pos: number): HTMLElement | null {
  const { node } = view.domAtPos(pos);
  const el = node instanceof HTMLElement ? node : node.parentElement;
  return el?.closest<HTMLElement>(".cm-list-prefix-task-checked") ?? null;
}

function popBox(prefix: HTMLElement): void {
  const pop: Keyframe[] = [
    { scale: "1", offset: 0, easing: EASE_OUT },
    { scale: "0.9", offset: 0.3, easing: EASE_OUT },
    { scale: "1.05", offset: 0.7, easing: EASE_OUT },
    { scale: "1", offset: 1 },
  ];
  for (const pseudoElement of ["::before", "::after"]) {
    prefix.animate(pop, { duration: POP_MS, pseudoElement });
  }
  // The tick's left 24% of the box is empty, so the reveal starts there.
  prefix.animate([{ clipPath: "inset(0 76% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
    duration: TICK_MS,
    delay: TICK_DELAY_MS,
    easing: EASE_OUT,
    fill: "backwards",
    pseudoElement: "::after",
  });
}

function burst(view: EditorView, x: number, y: number, live: Set<HTMLElement>): void {
  const layer = document.createElement("div");
  layer.className = "cm-task-celebration";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "absolute",
    left: `${x.toString()}px`,
    top: `${y.toString()}px`,
    width: "0",
    height: "0",
    pointerEvents: "none",
  });
  const animations: Animation[] = [];
  for (let i = 0; i < DOT_COUNT; i += 1) {
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      position: "absolute",
      left: `${(-DOT_SIZE_PX / 2).toString()}px`,
      top: `${(-DOT_SIZE_PX / 2).toString()}px`,
      width: `${DOT_SIZE_PX.toString()}px`,
      height: `${DOT_SIZE_PX.toString()}px`,
      borderRadius: "50%",
      backgroundColor: DOT_COLORS[i % DOT_COLORS.length],
    });
    layer.append(dot);
    const angle = (i / DOT_COUNT) * Math.PI * 2 - Math.PI / 2;
    const dist = i % 2 === 0 ? DOT_FAR_PX : DOT_NEAR_PX;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const at = (t: number, scale: number) =>
      `translate(${(dx * t).toFixed(2)}px, ${(dy * t).toFixed(2)}px) scale(${scale.toString()})`;
    animations.push(
      dot.animate(
        [
          { transform: at(0.4, 0.4), opacity: 1, offset: 0, easing: EASE_OUT },
          { transform: at(0.8, 1), opacity: 1, offset: 0.5, easing: EASE_OUT },
          { transform: at(1, 0), opacity: 0, offset: 1 },
        ],
        { duration: BURST_MS, fill: "forwards" },
      ),
    );
  }
  view.scrollDOM.append(layer);
  live.add(layer);
  const remove = () => {
    layer.remove();
    live.delete(layer);
  };
  Promise.all(animations.map((a) => a.finished)).then(remove, remove);
}

export const taskCelebration = ViewPlugin.fromClass(
  class {
    private readonly live = new Set<HTMLElement>();

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      const ticks = newlyCheckedTicks(update.transactions);
      if (ticks.length === 0 || prefersReducedMotion()) return;
      // The checked span only exists after this update's DOM pass.
      this.view.requestMeasure({
        read: (view) => {
          const scroller = view.scrollDOM.getBoundingClientRect();
          return ticks.flatMap((pos) => {
            const prefix = prefixElementAt(view, pos);
            if (!prefix) return [];
            const rect = prefix.getBoundingClientRect();
            const box = getComputedStyle(prefix, "::before");
            const centerX = rect.left + parseFloat(box.left) + parseFloat(box.width) / 2;
            const centerY = rect.top + rect.height / 2;
            return [
              {
                prefix,
                x: centerX - scroller.left + view.scrollDOM.scrollLeft,
                y: centerY - scroller.top + view.scrollDOM.scrollTop,
              },
            ];
          });
        },
        write: (targets, view) => {
          for (const { prefix, x, y } of targets) {
            popBox(prefix);
            burst(view, x, y, this.live);
          }
        },
      });
    }

    destroy() {
      for (const layer of this.live) layer.remove();
      this.live.clear();
    }
  },
);
