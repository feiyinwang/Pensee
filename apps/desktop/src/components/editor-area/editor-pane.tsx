import type { EditorView } from "@codemirror/view";
import { ProseMarkEditor } from "./prosemark-editor";
import { BookCard } from "./book-card";
import { VideoPlayer } from "./video-player";
import { FrontmatterPanel } from "./frontmatter-panel";
import { PageTitle } from "./page-title";
import { EditorScrollContainer } from "./editor-scroll-container";
import { EditorSearchOverview } from "./editor-search-overview";
import { SectionRail } from "./section-rail";
import { useCloseEditorSearchWhenInactive } from "./use-close-editor-search-when-inactive";
import { useIsFileLoading } from "@/hooks/use-tabs";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function AsciiSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <span>{SPINNER_FRAMES[frame]}</span>;
}

interface EditorPaneProps {
  path: string;
  isActive: boolean;
  /** One of several side-by-side tab columns: always shown, and sized for
   *  its island rather than the whole window. */
  inColumn?: boolean;
}

export const EditorPane = memo(function EditorPane({
  path,
  isActive,
  inColumn = false,
}: EditorPaneProps) {
  const isLoading = useIsFileLoading(path);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  useCloseEditorSearchWhenInactive(isActive);

  const getScrollContainer = useCallback(() => scrollContainerRef.current, []);

  const visibilityClass =
    inColumn || isActive
      ? "relative z-10 h-full"
      : "absolute inset-0 invisible pointer-events-none";

  if (isLoading) {
    return (
      <div className={visibilityClass}>
        <div className="flex h-full items-center justify-center text-ui text-[var(--text-muted)]">
          <AsciiSpinner />
        </div>
      </div>
    );
  }

  return (
    <div data-pane className={visibilityClass}>
      <EditorScrollContainer ref={scrollContainerRef}>
        <div
          className={`mx-auto w-full pb-6 ${inColumn ? "pt-10" : "pt-20 md:pt-24"}`}
          style={{
            maxWidth: "var(--pensee-editor-outer-width)",
            boxSizing: "border-box",
            paddingLeft: "var(--pensee-editor-side-padding)",
            paddingRight: "var(--pensee-editor-side-padding)",
          }}
        >
          <PageTitle key={path} path={path} view={editorView} />
          <FrontmatterPanel filePath={path} />
          <BookCard filePath={path} />
        </div>
        <VideoPlayer filePath={path} />
        <ProseMarkEditor
          filePath={path}
          getScrollContainer={getScrollContainer}
          autoFocus={isActive}
          onViewChange={setEditorView}
        />
      </EditorScrollContainer>
      <SectionRail filePath={path} view={editorView} scrollContainerRef={scrollContainerRef} />
      {isActive && <EditorSearchOverview scrollContainerRef={scrollContainerRef} />}
    </div>
  );
});
