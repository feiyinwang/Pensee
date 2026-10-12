import { lazy, Suspense } from "react";
import { useCalendarPanelVisible } from "@/hooks/use-calendar-panel";

// The panel is built from Arc (and `motion`), so it loads on first open, never
// at startup (docs/arc.md).
const CalendarPanelContent = lazy(() => import("./calendar-panel"));

/** The right-hand calendar column (Cmd+]). Renders nothing while hidden. */
export function CalendarPanel() {
  const isVisible = useCalendarPanelVisible();
  if (!isVisible) return null;
  return (
    <Suspense fallback={null}>
      <CalendarPanelContent />
    </Suspense>
  );
}
