import { lazy, Suspense, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cursor02Icon } from "@hugeicons/core-free-icons";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import "./agent-chat.css";

// The panel pulls in Arc (and `motion`), so it loads on first open, never at
// startup (docs/arc.md). Once loaded it stays mounted to keep scroll and draft.
const AgentPanel = lazy(() => import("./agent-panel"));
const WARM_DELAY_MS = 2_000;

/** Linear-style agent chat: a launcher pill in the window's bottom-right
 *  corner and a floating panel above it. See SPECs/agent-chat-spec.md. */
export function AgentChat() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const toggle = useAgentStore((s) => s.toggle);
  const [hasOpened, setHasOpened] = useState(false);
  if (isOpen && !hasOpened) setHasOpened(true);
  const root = useWorkspaceStore((s) => s.root);

  // Start Claude in the background once the workspace is up, so the first
  // question doesn't wait for it. Delayed to stay out of the window's own startup.
  useEffect(() => {
    if (!root) return;
    const timer = setTimeout(() => useAgentStore.getState().warm(), WARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [root]);

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
        <HugeiconsIcon icon={Cursor02Icon} size={16} color="currentColor" strokeWidth={2} />
        Agent
      </button>
    </>
  );
}
