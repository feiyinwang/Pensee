import * as Dialog from "@radix-ui/react-dialog";
import { closeComposer } from "@/hooks/use-composer";
import ComposerCard from "./composer-card";

// ⌘T's composer over the page. Lazy with the card, so Arc loads on first use.
export default function ComposerDialog() {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeComposer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="composer-overlay" />
        <Dialog.Content
          className="composer-dialog surface-card"
          aria-describedby={undefined}
          // The card puts the caret in the title itself.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">New note</Dialog.Title>
          <ComposerCard variant="dialog" onClose={closeComposer} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
