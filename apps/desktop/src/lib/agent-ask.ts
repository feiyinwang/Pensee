import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { useAgentStore } from "@/stores/agent-store";

/** Open the agent panel and send `prompt`, for actions outside the chat box
 *  (the book reader's Explain/Define). One run at a time: while an answer is
 *  still coming, say so instead of dropping the request silently. */
export function askAgent(prompt: string): void {
  const agent = useAgentStore.getState();
  if (agent.run) {
    showEditorNotice("The agent is still answering. Ask again when it's done.");
    return;
  }
  if (!agent.isOpen) agent.toggle();
  void agent.send(prompt);
}

/** Start the agent's Claude ahead of a question (see agent-store `warm`). */
export function warmAgent(): void {
  useAgentStore.getState().warm();
}
