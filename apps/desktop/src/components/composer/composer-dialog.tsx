import * as Dialog from "@radix-ui/react-dialog";
import { closeComposer } from "@/hooks/use-composer";
import ComposerCard from "./composer-card";

// ⌘T's composer over the page. Lazy with the card, so Arc loads on first use.
//
// Not modal. A modal Radix dialog sets `pointer-events: none` on <body> and
// restores it when it closes; Arc's popover and menu come with other copies of
// Radix's layer code that do the same, each restoring what it saw. The
// calendar then took no clicks, and closing in the wrong order left the whole
// window unclickable. Non-modal, the dialog never touches <body>; Esc and a
// click outside still close it.
export default function ComposerDialog() {
  return (
    <Dialog.Root open modal={false} onOpenChange={(open) => !open && closeComposer()}>
      <Dialog.Portal>
        <Dialog.Content
          className="composer-dialog surface-card"
          aria-describedby={undefined}
          // The card puts the caret in the title itself.
          onOpenAutoFocus={(event) => event.preventDefault()}
          // The chips' menus and calendar render outside the card: clicks in
          // them are inside the box.
          onInteractOutside={(event) => {
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest("[data-radix-popper-content-wrapper]")
            ) {
              event.preventDefault();
            }
          }}
        >
          <Dialog.Title className="sr-only">New note</Dialog.Title>
          <ComposerCard variant="dialog" onClose={closeComposer} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
