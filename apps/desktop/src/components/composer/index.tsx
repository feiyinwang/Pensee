import { lazy, Suspense } from "react";
import { useComposerStore } from "@/stores/composer-store";
import { useEditorStore } from "@/stores/editor-store";

const ComposerDialog = lazy(() => import("./composer-dialog"));
const ComposerCard = lazy(() => import("./composer-card"));

/** ⌘N's composer (SPECs/composer-spec.md). The New tab page shows its own. */
export function Composer() {
  const open = useComposerStore((s) => s.open);
  const onLauncher = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.location.kind === "launcher",
  );
  if (!open || onLauncher) return null;
  return (
    <Suspense fallback={null}>
      <ComposerDialog />
    </Suspense>
  );
}

/** The composer in the New tab page, in place of a menu of ways to start. */
export function InlineComposer() {
  return (
    <Suspense fallback={null}>
      <div className="composer-inline surface-card">
        <ComposerCard variant="inline" />
      </div>
    </Suspense>
  );
}
