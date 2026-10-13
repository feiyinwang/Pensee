import { ScrollFade } from "@/components/scroll-fade";
import { SidebarNavigator } from "./sidebar-navigator";

export function FileBrowser() {
  return (
    <div className="flex h-full min-h-0 flex-col px-3">
      <ScrollFade className="min-h-0 flex-1 overflow-y-scroll scrollbar-none">
        <SidebarNavigator />
      </ScrollFade>
    </div>
  );
}
