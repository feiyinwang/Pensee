import { InlineComposer } from "@/components/composer";

// A new tab is the composer, in place (SPECs/composer-spec.md). Search stays
// on ⌘O / ⌘P.
export function NewTabPage() {
  return (
    <div className="flex h-full items-start justify-center px-6 pt-[16vh] pb-10">
      <InlineComposer />
    </div>
  );
}
