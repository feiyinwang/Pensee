import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./guide-pill.css";

/** The name a held key shows on its keycap: ⌘ for Meta, the letter
 *  upper-cased, the symbol as typed. */
export function keyLabel(event: Pick<KeyboardEvent, "key">): string | null {
  const { key } = event;
  if (key === "Meta") return "⌘";
  if (key === "Alt") return "⌥";
  if (key === "Shift") return "⇧";
  if (key === "Enter") return "↵";
  if (key === "Escape") return "Esc";
  return key.length === 1 ? key.toUpperCase() : null;
}

/** The labels of the keys held right now, while `on`. */
function useHeldKeys(on: boolean): ReadonlySet<string> {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!on) return;
    const down = (event: KeyboardEvent) => {
      const label = keyLabel(event);
      if (!label) return;
      setHeld((prev) => (prev.has(label) ? prev : new Set(prev).add(label)));
    };
    const up = (event: KeyboardEvent) => {
      const label = keyLabel(event);
      // ⌘ swallows the keyup of the keys pressed with it: letting go of ⌘
      // lets go of everything.
      if (label === "⌘") return setHeld(new Set());
      if (!label) return;
      setHeld((prev) => {
        if (!prev.has(label)) return prev;
        const next = new Set(prev);
        next.delete(label);
        return next;
      });
    };
    const clear = () => setHeld(new Set());
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
    };
  }, [on]);
  return held;
}

/** Keycaps that press down while their key is held. */
export function GuideKeys({ keys }: { keys: readonly string[] }) {
  const held = useHeldKeys(keys.length > 0);
  return (
    <>
      {keys.map((k, i) => (
        <kbd key={`${k}-${i}`} data-down={held.has(k.toUpperCase()) || undefined}>
          {k}
        </kbd>
      ))}
    </>
  );
}

/** The bottom guide pill (SPECs/onboarding-spec.md, SPECs/in-context-tips-spec.md):
 *  the practice loop's one instruction at a time, and a tip's keys. `quiet`
 *  is its text button (Skip, Not now), `go` its filled one. */
export function GuidePill({
  children,
  quiet,
  go,
  leaving,
}: {
  children: ReactNode;
  quiet?: { label: ReactNode; onClick: () => void };
  go?: { label: ReactNode; onClick: () => void };
  leaving?: boolean;
}) {
  return createPortal(
    <div className="guide-pill" role="status" data-leaving={leaving || undefined}>
      {children}
      {quiet && (
        <button type="button" className="guide-pill-quiet" onClick={quiet.onClick}>
          {quiet.label}
        </button>
      )}
      {go && (
        <button type="button" className="guide-pill-go" onClick={go.onClick}>
          {go.label}
        </button>
      )}
    </div>,
    document.body,
  );
}
