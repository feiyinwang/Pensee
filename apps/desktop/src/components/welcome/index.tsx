import { useWorkspace } from "@/hooks/use-workspace";
import * as tauri from "@/lib/tauri";
import { getParentDir } from "@/lib/paths";

export function WelcomeScreen() {
  const { openWorkspace } = useWorkspace();

  async function handleAddLocation() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      await openWorkspace(picked);
    }
  }

  async function handleOpenFile() {
    const picked = await tauri.pickFile();
    if (!picked) return;
    const dir = getParentDir(picked);
    await openWorkspace(dir);
    await import("@/stores/editor-store").then((m) => m.useEditorStore.getState().openFile(picked));
  }

  return (
    <div className="flex h-full items-center justify-center text-[var(--color-text-primary)]">
      <div className="w-full max-w-[300px] px-6">
        <p className="mb-6 text-center text-ui leading-relaxed text-[var(--color-text-muted)]">
          Add a folder with your specs, docs, notes, or any markdown files.
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void handleAddLocation()}
            className="flex items-center gap-2 label-ui rounded-[var(--radius-button)] bg-[var(--text-primary)] px-4 py-2 text-label whitespace-nowrap font-medium text-[var(--surface-primary)] transition-opacity hover:opacity-90"
          >
            Add folder
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFile()}
            className="flex items-center gap-2 label-ui rounded-md border border-[var(--line-subtle)] px-4 py-2 text-label whitespace-nowrap font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            Open file
          </button>
        </div>
      </div>
    </div>
  );
}
