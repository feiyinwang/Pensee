import { useWorkspaceStore } from "@/stores/workspace-store";

export function getWorkspaceRoot() {
  return useWorkspaceStore.getState().root;
}

/** How many notes the vault's index holds. */
export function getWorkspaceFileCount() {
  return useWorkspaceStore.getState().fileCount;
}

export function getWorkspaceIdentity() {
  const { root, workspaceGeneration } = useWorkspaceStore.getState();
  return { root, workspaceGeneration };
}

export function isCurrentWorkspaceIdentity(identity: ReturnType<typeof getWorkspaceIdentity>) {
  const current = getWorkspaceIdentity();
  return (
    current.root === identity.root && current.workspaceGeneration === identity.workspaceGeneration
  );
}
