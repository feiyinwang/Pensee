import { useActiveTab } from "@/hooks/use-tabs";
import { TabColumns } from "./tab-columns";
import { pageKindView } from "./page-kinds/views";
import { EditorSearchOverlay } from "./editor-search-overlay";
import { EditorNoticeBanner } from "./editor-notice-banner";
import { AddToProjectsRepeats } from "@/components/add-to-projects";

interface EditorAreaProps {
  showFooter?: boolean;
}

function EditorArea({ showFooter = true }: EditorAreaProps) {
  const activeTab = useActiveTab();

  return (
    <div className="relative h-full overflow-hidden">
      <div className="relative h-full min-h-0 overflow-hidden">
        <TabColumns />
      </div>
      {showFooter && activeTab
        ? pageKindView(activeTab.location).renderFooter?.(activeTab.location)
        : null}
      <EditorSearchOverlay />
      <EditorNoticeBanner />
      <AddToProjectsRepeats />
    </div>
  );
}

export { EditorArea };
