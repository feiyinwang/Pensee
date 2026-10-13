import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  deleteGroupBackward,
  deleteGroupForward,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
} from "@codemirror/commands";

/**
 * The macOS delete shortcuts, bound explicitly so they do not depend on
 * CodeMirror's platform detection.
 *
 * `standardKeymap` already carries all four, but it registers them through
 * `mac:` variants, and those variants only exist when `@codemirror/view`'s
 * browser check decides the platform is a Mac (it reads `navigator.platform`,
 * a deprecated API). When that check says "not a Mac", `Option/Cmd + Delete`
 * are bound to nothing at all — measured in Chromium: with the platform
 * spoofed to Linux, both delete **zero** characters, and in a WKWebView the
 * unbound key falls through to the native contenteditable handler, which on a
 * CodeMirror document degrades to deleting a single character. That is exactly
 * the reported symptom.
 *
 * Binding them by name here removes the dependency: the keys work whatever the
 * library concludes about the platform. `Prec.high` puts them above
 * `defaultKeymap` and below the `Prec.highest` list/markdown handlers, none of
 * which bind a modified Backspace.
 *
 * This must be shared, not copied into each editor. Pensée already has three
 * CodeMirror instances (the page, a caption band, the mermaid source pane);
 * "each editor fills in its own missing keys" is the same shape as the global
 * focus-ring whitelist that kept growing — see PRD lesson 15 and 19.
 *
 * Windows/Linux note: `Alt-Backspace` is conventionally undo there. Pensée
 * ships macOS-only (Tauri dock menu, CLI installer), so the collision is
 * theoretical; if that changes, gate this list on the platform *here*, in one
 * place, rather than per editor.
 */
export const platformDeleteKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Alt-Backspace", run: deleteGroupBackward, preventDefault: true },
    { key: "Alt-Delete", run: deleteGroupForward, preventDefault: true },
    { key: "Meta-Backspace", run: deleteLineBoundaryBackward, preventDefault: true },
    { key: "Meta-Delete", run: deleteLineBoundaryForward, preventDefault: true },
  ]),
);
