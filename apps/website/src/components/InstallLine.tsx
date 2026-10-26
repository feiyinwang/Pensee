import { useEffect, useState } from "react";

import { BREW } from "../content";
import { useVisitorOs } from "../visitor-os";

type CopyState = "idle" | "copied" | "failed";
const LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Select and copy",
};

/** The Homebrew line with a Copy button that confirms for 1.5s. Homebrew is
 *  the Mac's, so a Windows visitor doesn't see it. */
export function InstallLine() {
  const [state, setState] = useState<CopyState>("idle");
  const windows = useVisitorOs() === "windows";

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BREW);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  if (windows) return null;
  return (
    <div className="line">
      <code>{BREW}</code>
      <button className="copy" type="button" onClick={copy}>
        {LABEL[state]}
      </button>
    </div>
  );
}
