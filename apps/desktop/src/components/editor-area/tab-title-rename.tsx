import { useEffect, useRef } from "react";

import { getFileStem } from "@/lib/paths";
import { renameFileStem } from "@/lib/file-actions";

/**
 * A note header's title in rename mode: the file name (without extension),
 * selected. Enter or clicking away renames, Escape keeps the name — the same
 * rules as renaming in the sidebar, through the same write path.
 */
export function TabTitleRename({
  path,
  className,
  onDone,
}: {
  path: string;
  className?: string;
  onDone: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone();
    if (value !== null) void renameFileStem(path, value);
  };

  return (
    <input
      ref={ref}
      className={className}
      defaultValue={getFileStem(path)}
      aria-label="Rename note"
      spellCheck={false}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        else if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
