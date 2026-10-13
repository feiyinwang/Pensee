import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File02Icon,
  PlusSignIcon,
  StopIcon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { useActiveFilePath, useResolvedDocumentTitle } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import { useAgentStore, type AgentItem } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { agentModel, parseModelCommand, type AgentModel } from "@/lib/agent-models";
import { AgentMarkdown } from "./agent-markdown";

export default function AgentPanel() {
  ensureArcTokens();
  const isOpen = useAgentStore((s) => s.isOpen);
  const items = useAgentStore((s) => s.items);
  const isRunning = useAgentStore((s) => s.run !== null);
  const close = useAgentStore((s) => s.close);
  const newChat = useAgentStore((s) => s.newChat);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const title = items.find((item) => item.role === "user")?.text ?? "New chat";

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Agent"
      hidden={!isOpen}
      onKeyDown={handleKeyDown}
      className="agent-panel surface-card fixed z-40 flex flex-col"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-label font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        <PanelIconButton label="New chat" icon={PlusSignIcon} onClick={newChat} />
        <PanelIconButton label="Close" icon={Cancel01Icon} onClick={close} />
      </header>
      <AgentMessages items={items} isRunning={isRunning} />
      <AgentComposer inputRef={inputRef} isRunning={isRunning} isOpen={isOpen} />
    </div>
  );
}

function PanelIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof PlusSignIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--item-hover-bg)] hover:text-[var(--text-secondary)]"
    >
      <HugeiconsIcon icon={icon} size={16} color="currentColor" strokeWidth={2} />
    </button>
  );
}

function AgentMessages({ items, isRunning }: { items: AgentItem[]; isRunning: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const last = items[items.length - 1];
  const showWorking = isRunning && last?.role !== "assistant";

  // Follow the stream while the user is at the bottom; leave them be if they
  // scrolled up to reread.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, showWorking]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-4"
    >
      {items.length === 0 && (
        <p className="m-auto text-ui font-medium text-[var(--text-muted)]">
          Ask about or edit your open pages.
        </p>
      )}
      {items.map((item) => (
        <AgentRow key={item.id} item={item} />
      ))}
      {showWorking && (
        <TextShimmer as="p" className="text-label font-medium text-[var(--text-secondary)]">
          Thinking
        </TextShimmer>
      )}
    </div>
  );
}

function AgentRow({ item }: { item: AgentItem }) {
  switch (item.role) {
    case "user":
      return (
        <p className="max-w-[85%] self-end rounded-xl bg-[var(--surface-subtle)] px-3 py-2 text-ui leading-[1.5] font-medium break-words whitespace-pre-wrap text-[var(--text-primary)] select-text">
          {item.text}
        </p>
      );
    case "assistant":
      return (
        <div className="agent-reply flex flex-col gap-2 text-ui leading-[1.55] font-medium break-words text-[var(--text-primary)] select-text">
          <AgentMarkdown text={item.text} />
        </div>
      );
    case "tool":
    case "status":
      return (
        <p className="truncate text-caption font-medium text-[var(--text-muted)]">{item.text}</p>
      );
    case "error":
      return (
        <p className="flex items-start gap-1.5 text-ui leading-[1.5] font-medium text-[var(--text-primary)] select-text">
          <HugeiconsIcon
            icon={Alert02Icon}
            size={14}
            color="currentColor"
            strokeWidth={2}
            className="mt-[3px] shrink-0"
          />
          <span className="min-w-0 break-words">{item.text}</span>
        </p>
      );
  }
}

const MAX_INPUT_HEIGHT = 6 * 22 + 16;

function AgentComposer({
  inputRef,
  isRunning,
  isOpen,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  isRunning: boolean;
  isOpen: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const send = useAgentStore((s) => s.send);
  const stop = useAgentStore((s) => s.stop);
  const setModel = useAgentStore((s) => s.setModel);
  const model = agentModel(
    useSettingsStore((s) => s.settings["agent.model"] as string | undefined),
  );
  // A `/model` draft is handled here and never sent to Claude.
  const modelCommand = parseModelCommand(draft);
  const matches = modelCommand?.matches ?? [];
  const canSend = draft.trim().length > 0 && !isRunning && !modelCommand;

  // Measured only while visible: a hidden panel reports scrollHeight 0.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !isOpen) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    // Scroll only once the text outgrows the cap; below it the box fits exactly.
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [draft, inputRef, isOpen]);

  const changeDraft = (next: string) => {
    setDraft(next);
    setHighlight(0);
  };

  const submit = () => {
    if (!canSend) return;
    void send(draft);
    setDraft("");
  };

  const pickModel = (picked: AgentModel) => {
    setModel(picked.id);
    changeDraft("");
  };

  const openModelMenu = () => {
    changeDraft("/model ");
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (modelCommand) {
      if (event.key === "Escape") {
        // Close the menu, not the panel.
        event.preventDefault();
        event.stopPropagation();
        changeDraft("");
        return;
      }
      if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((index) => (index + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const picked = matches[Math.min(highlight, matches.length - 1)];
        if (picked) pickModel(picked);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="flex h-8 min-w-0 items-center gap-2 px-2">
        <FocusChip />
        <button
          type="button"
          onClick={openModelMenu}
          title="Switch model (/model)"
          className="-mr-1 ml-auto flex h-6 shrink-0 items-center gap-0.5 rounded-md pr-1 pl-1.5 text-label font-medium whitespace-nowrap text-[var(--text-secondary)] transition-colors hover:bg-[var(--item-hover-bg)] hover:text-[var(--text-primary)]"
        >
          {model.name}
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            size={12}
            color="currentColor"
            strokeWidth={2}
            className="text-[var(--text-icon-muted)]"
          />
        </button>
      </div>
      {modelCommand && (
        <ModelMenu
          matches={matches}
          highlight={Math.min(highlight, matches.length - 1)}
          currentId={model.id}
          onHighlight={setHighlight}
          onPick={pickModel}
        />
      )}
      <div className="flex items-end gap-2 rounded-2xl bg-[var(--surface-input)] p-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => changeDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude…"
          aria-label="Message"
          data-no-focus-ring
          className="scrollbar-none min-w-0 flex-1 resize-none overflow-x-hidden bg-transparent py-[3px] text-ui leading-[22px] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        {isRunning ? (
          <button
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={stop}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle-strong)] text-[var(--text-primary)] transition-colors"
          >
            <HugeiconsIcon icon={StopIcon} size={14} color="currentColor" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            title="Send"
            disabled={!canSend}
            onClick={submit}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle-strong)] text-[var(--text-primary)] transition-colors disabled:bg-transparent disabled:text-[var(--text-icon-muted)]"
          >
            <HugeiconsIcon icon={ArrowUp02Icon} size={16} color="currentColor" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The focused tab, the one "this" refers to. Absent on non-file tabs. */
function FocusChip() {
  const path = useActiveFilePath();
  const title = useResolvedDocumentTitle(path);
  if (!path) return null;
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)]"
      title={path}
    >
      <HugeiconsIcon
        icon={File02Icon}
        size={14}
        color="currentColor"
        strokeWidth={2}
        className="shrink-0 text-[var(--text-icon-muted)]"
      />
      <span className="truncate">{title || getFileStem(path)}</span>
    </div>
  );
}

/** The `/model` menu above the composer. Mouse-down keeps focus in the
 *  textarea so the keyboard keeps working after a hover or click. */
function ModelMenu({
  matches,
  highlight,
  currentId,
  onHighlight,
  onPick,
}: {
  matches: AgentModel[];
  highlight: number;
  currentId: string;
  onHighlight: (index: number) => void;
  onPick: (model: AgentModel) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="mb-1 px-2 py-1.5 text-caption font-medium text-[var(--text-muted)]">
        No model by that name. Try Haiku, Sonnet or Opus.
      </p>
    );
  }
  return (
    <div role="listbox" aria-label="Model" className="mb-1 flex flex-col">
      {matches.map((model, index) => (
        <div
          key={model.id}
          role="option"
          aria-selected={index === highlight}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(model)}
          className="flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-label font-medium aria-selected:bg-[var(--item-hover-bg)]"
        >
          <span className="shrink-0 text-[var(--text-primary)]">{model.name}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">{model.blurb}</span>
          <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-secondary)]">
            {model.id === currentId && (
              <HugeiconsIcon icon={Tick02Icon} size={14} color="currentColor" strokeWidth={2} />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
