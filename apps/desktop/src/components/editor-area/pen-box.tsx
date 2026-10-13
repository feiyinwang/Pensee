import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FloatingButtonGroup } from "@/components/arc/floating-button-group/floating-button-group";
import { ensureArcTokens } from "./board/arc-tokens";

// The second pen's box (SPECs/second-pen-spec.md#asking-the-pens-box): Arc's
// floating button group for what the pen can do, each pill showing its key,
// and under it the box to type in. Nothing runs until Enter: clicking a pill,
// or typing its key (! @ [ − #, half- or full-width) at the start of the box
// or after a space, selects it and types nothing. Enter runs the selected
// pill, steered by whatever was typed; with none selected, Enter is Answer on
// what you typed. Loaded on demand, so notes never pay for Arc or motion at
// startup.

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

/** The pill a typed character names: `-` is `−`, and a Chinese or Japanese
 *  input method's full-width punctuation counts as its plain key. */
const KEY_OF: Record<string, string> = {
  "-": "−",
  "－": "−",
  "！": "!",
  "＠": "@",
  "＃": "#",
  "[": "[[",
  "［": "[[",
  "【": "[[",
};
function asKey(char: string): string {
  return KEY_OF[char] ?? char;
}

/** A key picks a pill only where it can't be part of a word: at the start of
 *  the box or after a space. So "off-shore" and "why?" still type. */
function atWordStart(value: string, at: number): boolean {
  return at === 0 || /\s/.test(value[at - 1] ?? "");
}

function PenBox({ pills, onChoose, onClose }: PenBoxProps) {
  const [mode, setMode] = useState<string | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const modePill = pills.find((pill) => pill.key === mode) ?? null;

  const run = (key: string) => onChoose(key, input.current?.value ?? text);
  const pick = (key: string) => setMode((current) => (current === key ? null : key));
  const isPill = (key: string) => pills.some((pill) => pill.key === key);

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
      else if (text.trim()) run("!");
      return;
    }
    // A pill's key selects that pill and types nothing.
    const key = asKey(event.key);
    const at = event.currentTarget.selectionStart ?? text.length;
    if (!mod && !event.altKey && isPill(key) && atWordStart(text, at)) {
      event.preventDefault();
      pick(key);
    }
  };

  // An input method can insert the key without a usable keydown: take it out
  // of the text here instead, under the same rule.
  const onChange = (value: string) => {
    if (value.length === text.length + 1) {
      let inserted = value.length - 1;
      for (let i = 0; i < text.length; i++) {
        if (value[i] !== text[i]) {
          inserted = i;
          break;
        }
      }
      const key = asKey(value[inserted]!);
      if (isPill(key) && atWordStart(value, inserted)) {
        pick(key);
        return;
      }
    }
    setText(value);
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
          // Clicking only selects it; Enter runs it.
          onSelect: () => {
            pick(pill.key);
            input.current?.focus();
          },
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
              ? `${modePill.label}: add a direction, or just press Enter`
              : "Pick a pill, or ask a question"
          }
          aria-label="Ask a question, or press a pill's key to pick it"
          onChange={(event) => onChange(event.target.value)}
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
                <kbd>↵</kbd> answer, after your take
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
