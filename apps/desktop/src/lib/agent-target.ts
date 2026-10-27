import { useSettingsStore } from "@/stores/settings-store";
import {
  agentModel,
  agentProvider,
  type AgentModel,
  type AgentModelId,
  type AgentProvider,
} from "./agent-models";

/** The CLI and model a request runs on, from Settings → Agent. `tier`
 *  overrides the chosen model (Organize asks for Balanced at least). */
export function agentTarget(tier?: AgentModelId): { provider: AgentProvider; model: AgentModel } {
  const settings = useSettingsStore.getState();
  const provider = agentProvider(settings.getSetting("agent.provider"));
  const model = agentModel(tier ?? settings.getSetting("agent.model"), provider.id);
  return { provider, model };
}

/** The `provider` and `model` fields of `agent_warm` and `agent_send`. */
export function agentInvokeArgs(tier?: AgentModelId): { provider: string; model: string } {
  const { provider, model } = agentTarget(tier);
  return { provider: provider.id, model: model.cli };
}
