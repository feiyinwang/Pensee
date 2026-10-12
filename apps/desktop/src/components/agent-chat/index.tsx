import { lazy, Suspense, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { useAgentStore } from "@/stores/agent-store";
import "./agent-chat.css";

// The panel pulls in Arc (and `motion`), so it loads on first open, never at
// startup (docs/arc.md). Once loaded it stays mounted to keep scroll and draft.
const AgentPanel = lazy(() => import("./agent-panel"));

/** Linear-style agent chat: a launcher pill in the window's bottom-right
 *  corner and a floating panel above it. See SPECs/agent-chat-spec.md. */
export function AgentChat() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const toggle = useAgentStore((s) => s.toggle);
  const [hasOpened, setHasOpened] = useState(false);
  if (isOpen && !hasOpened) setHasOpened(true);

  return (
    <>
      {hasOpened && (
        <Suspense fallback={null}>
          <AgentPanel />
        </Suspense>
      )}
      <button
        type="button"
        data-agent-launcher
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        title="Agent (⌘J)"
        className="agent-launcher fixed z-40 flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap text-[var(--text-secondary)] transition-colors hover:bg-[var(--item-hover-bg)] hover:text-[var(--text-primary)] aria-expanded:bg-[var(--item-active-bg)] aria-expanded:text-[var(--text-primary)]"
      >
        <HugeiconsIcon icon={AiChat02Icon} size={16} color="currentColor" strokeWidth={2} />
        Agent
      </button>
    </>
  );
}
