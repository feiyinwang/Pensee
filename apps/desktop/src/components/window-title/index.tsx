import { useActiveFilePath, useActiveTab, useOpenFiles } from "@/hooks/use-tabs";
import { pageKind } from "@/components/editor-area/page-kinds";
import { getFileName } from "@/lib/paths";
import { useWindowTitle } from "./use-window-title";

export function WindowTitle() {
  const activeTab = useActiveTab();
  const activeFilePath = useActiveFilePath();
  const openFiles = useOpenFiles();

  const title = (() => {
    if (!activeTab) return "Pensée";
    if (!activeFilePath) {
      const label = pageKind(activeTab.location).title(activeTab.location);
      return `${label} - Pensée`;
    }
    const file = openFiles.get(activeFilePath);
    const name = getFileName(activeFilePath);
    return file?.isDirty ? `${name} (unsaved) - Pensée` : `${name} - Pensée`;
  })();

  useWindowTitle(title);

  return null;
}
