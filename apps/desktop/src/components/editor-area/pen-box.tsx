import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FloatingButtonGroup } from "@/components/arc/floating-button-group/floating-button-group";
import { ensureArcTokens } from "./board/arc-tokens";

// The second pen's box (SPECs/second-pen-spec.md#asking-the-pens-box): Arc's
// floating button group for what the pen can do, each pill showing its key,
// and under it the box to type in. A function's key, typed into the empty box
// (? ! @ + − # >), selects its pill and types nothing; what you type next
// steers it, and Enter runs it. With no pill selected, Enter asks the AI what
// you typed (⌘↵: has it ask you instead). Loaded on demand, so notes never
// pay for Arc or motion at startup.

export interface PenPill {
  key: string;
  label: string;
  title: string;
}

export interface PenBoxProps {
  pills: PenPill[];
  onChoose: (key: string, text: string) => void;
  onClose: () => void;
}

/** Each pill shows its key, where an icon would go: the shortcut is the label. */
function Key({ char }: { char: string }): ReactNode {
  return <span className="pen-pill-key">{char}</span>;
}

/** A typed key as the pill it names: `-` is `−`. */
function asKey(char: string): string {
  return char === "-" ? "−" : char;
}

function PenBox({ pills, onChoose, onClose }: PenBoxProps) {
  const [mode, setMode] = useState<string | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const modePill = pills.find((pill) => pill.key === mode) ?? null;

  const run = (key: string) => onChoose(key, input.current?.value ?? text);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Backspace" && mode && !text) {
      event.preventDefault();
      setMode(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (mode) run(mode);
      else if (text.trim()) run(mod ? "?" : "!");
      return;
    }
    // A function's key, in the empty box, selects its pill; it types nothing.
    if (!text && !mod && !event.altKey) {
      const key = asKey(event.key);
      if (pills.some((pill) => pill.key === key)) {
        event.preventDefault();
        setMode(key === mode ? null : key);
      }
    }
  };

  return (
    <div className="pen-box">
      <FloatingButtonGroup
        label="What the pen can do"
        size="sm"
        items={pills.map((pill) => ({
          id: pill.key,
          label: pill.label,
          icon: <Key char={pill.key} />,
          pressed: pill.key === mode,
          onSelect: () => run(pill.key),
        }))}
      />
      <div className="pen-box-field" data-mode={mode ?? undefined}>
        <input
          ref={input}
          className="pen-box-input"
          type="text"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={text}
          placeholder={
            modePill
              ? `${modePill.label}: steer it, or press Enter`
              : "Ask anything, or press a pill's key"
          }
          aria-label="Ask the AI, or press a pill's key to pick it"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {(mode || text.trim()) && (
          <span className="pen-box-keys" aria-hidden="true">
            {mode ? (
              <>
                <kbd>↵</kbd> {modePill?.label.toLowerCase()}
              </>
            ) : (
              <>
                <kbd>↵</kbd> ask AI <kbd>⌘↵</kbd> ask me
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Renders the box into `host` (the editor tooltip's element). Returns its unmount. */
export function mountPenBox(host: HTMLElement, props: PenBoxProps): () => void {
  ensureArcTokens();
  const root = createRoot(host);
  root.render(<PenBox {...props} />);
  return () => root.unmount();
}
