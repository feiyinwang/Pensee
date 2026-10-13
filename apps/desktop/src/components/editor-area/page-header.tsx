import type { EditorView } from "@codemirror/view";
import { useId, useState } from "react";

import { FrontmatterPanel } from "./frontmatter-panel";
import { PageTitle } from "./page-title";
import { useFrontmatterEntries } from "./use-frontmatter-entries";

/**
 * The page's title with its properties folded behind a toggle right under it,
 * at the title's left edge ("4 properties ›"). Closed by default so the title
 * sits right above the body. A block with no named property yet (just typed `---`) is always
 * open: its focused key field must be on screen.
 */
export function PageHeader({ path, view }: { path: string; view: EditorView | null }) {
  const fm = useFrontmatterEntries(path);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const count = fm.entries.filter((entry) => entry.key !== "").length;
  const showToggle = fm.hasFrontmatter && count > 0;
  const showPanel = fm.hasFrontmatter && (open || count === 0);

  return (
    <>
      <PageTitle key={path} path={path} view={view} />
      {showToggle && (
        <button
          type="button"
          aria-expanded={showPanel}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="page-header-toggle text-label text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          {count === 1 ? "1 property" : `${count} properties`}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden
            className={showPanel ? "rotate-90" : undefined}
          >
            <path
              d="M3.5 2l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {showPanel && <FrontmatterPanel id={panelId} fm={fm} />}
    </>
  );
}
