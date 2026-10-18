import { keymap, dropCursor, EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  deleteLine,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultHideExtensions } from "./hide";
import { defaultFoldableSyntaxExtensions } from "./fold";
import { urlClassExtension } from "./urlClass";
import { codeBlockDecorationsExtension, codeFenceTheme } from "./codeFenceExtension";
import { baseSyntaxHighlights, baseTheme, generalSyntaxHighlights } from "./syntaxHighlighting";
import { fixedTabWidthExtension } from "./tabWidthExtension";
import { listExtension } from "./list";
import { revealBlockOnArrowExtension } from "./revealBlockOnArrow";
import { platformDeleteKeymap } from "./deleteKeymap";
export { prosemarkMarkdownSyntaxExtensions } from "./markdown";

// What the host is expected to add on top: `history()` (in its own
// compartment so it can be reset per document), link click handling, search
// (Pensée runs its own overlay; the panel-based `searchKeymap` is not used),
// autocompletion sources, and the markdown formatting keymap. Code-editor
// defaults that make no sense for prose (fold gutter, bracket matching,
// indent-on-input, lint) are deliberately absent.
export const prosemarkBasicSetup = (): Extension => [
  // ProseMark Setup
  defaultHideExtensions,
  defaultFoldableSyntaxExtensions,
  revealBlockOnArrowExtension,
  urlClassExtension,
  listExtension,
  fixedTabWidthExtension,
  codeBlockDecorationsExtension,

  // Basic CodeMirror Setup
  dropCursor(),
  closeBrackets(),
  // Word- and line-wise delete, bound by name so they do not depend on the
  // library's platform sniffing. Every editor in the app pulls this from here;
  // see `deleteKeymap.ts`.
  platformDeleteKeymap,
  keymap.of([
    ...closeBracketsKeymap,
    ...editorDefaultKeymap,
    ...historyKeymap,
    // Obsidian's "Delete paragraph": the line(s) the selection touches
    // (SPECs/obsidian-shortcuts-spec.md).
    { key: "Mod-d", run: deleteLine, preventDefault: true },
    indentWithTab,
  ]),
  EditorView.lineWrapping,
];

/** CodeMirror's `defaultKeymap` with indent moved from Mod-[ / Mod-] to
 *  Mod-Shift-[ / Mod-Shift-], and without Mod-l (select line). Mod-[ toggles
 *  the sidebar app-wide (`useKeyboardShortcuts`), and CodeMirror only
 *  preventDefaults — it never stops propagation — so leaving it bound would
 *  run both; Mod-] moves with Mod-[ so the pair stays a pair. Mod-l is
 *  Obsidian's toggle checkbox (`editorCommands`). Every editor in the app
 *  (main, columns, mermaid) pulls this so the keys mean one thing everywhere. */
export const editorDefaultKeymap = [
  { key: "Mod-Shift-[", run: indentLess },
  { key: "Mod-Shift-]", run: indentMore },
  ...defaultKeymap.filter(
    (binding) => binding.key !== "Mod-[" && binding.key !== "Mod-]" && binding.key !== "Mod-l",
  ),
];

export const prosemarkBaseThemeSetup = (): Extension => [
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  baseTheme,
  codeFenceTheme,
];
