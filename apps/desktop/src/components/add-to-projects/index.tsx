import { lazy, Suspense } from "react";
import { useRepeatStore } from "./repeat-store";

// Arc and motion load only once a repeat is asked about (docs/arc.md).
const RepeatDialog = lazy(() => import("./repeat-dialog"));

/** The "Already a project?" popup's host: nothing until a question comes. */
export function AddToProjectsRepeats() {
  const asking = useRepeatStore((s) => s.resolve !== null);
  if (!asking) return null;
  return (
    <Suspense fallback={null}>
      <RepeatDialog />
    </Suspense>
  );
}
