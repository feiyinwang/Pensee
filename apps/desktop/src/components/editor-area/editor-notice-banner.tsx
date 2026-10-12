import type { CSSProperties } from "react";
import { dismissEditorNotice, useEditorNoticeStore } from "./editor-notice-store";

const SURFACE: CSSProperties = {
  background: "var(--surface-card)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid var(--line-subtler)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
  color: "var(--text-secondary)",
  letterSpacing: "-0.01em",
};

export function EditorNoticeBanner() {
  const message = useEditorNoticeStore((s) => s.message);
  const action = useEditorNoticeStore((s) => s.action);
  if (!message) return null;
  if (!action) {
    return (
      <button
        type="button"
        onClick={dismissEditorNotice}
        className="pointer-events-auto absolute left-1/2 top-6 z-30 max-w-[90%] -translate-x-1/2 cursor-pointer rounded-lg border-0 px-3 py-2 text-left text-[13px]"
        style={SURFACE}
      >
        {message}
      </button>
    );
  }
  return (
    <div
      role="status"
      className="pointer-events-auto absolute left-1/2 top-6 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-lg py-1.5 pl-3 pr-1.5 text-[13px]"
      style={SURFACE}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          dismissEditorNotice();
          action.run();
        }}
        className="h-7 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
      >
        {action.label}
      </button>
    </div>
  );
}
