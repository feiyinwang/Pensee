import type { ReactNode, Ref } from "react";

const SCROLLBAR_GUTTER = "18px";

// Breathing room above a scroll target (heading jump, search match) so it
// doesn't land flush against the top edge.
export const EDITOR_SAFE_SCROLL_MARGIN = 24;
export const EDITOR_SCROLLBAR_GUTTER = SCROLLBAR_GUTTER;

interface EditorScrollContainerProps {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function EditorScrollContainer({ ref, children }: EditorScrollContainerProps) {
  return (
    <div className="relative h-full">
      <div
        ref={ref}
        className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        style={{
          borderTop: "12px solid transparent",
          borderBottom: "12px solid transparent",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}
