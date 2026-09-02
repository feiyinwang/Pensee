import { keymap, dropCursor, EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { defaultHideExtensions } from "./hide";
import { defaultFoldableSyntaxExtensions } from "./fold";
import { clickLinkExtension, defaultClickLinkHandler } from "./clickLink";
import { codeBlockDecorationsExtension, codeFenceTheme } from "./codeFenceExtension";
import {
  baseSyntaxHighlights,
  baseTheme,
  generalSyntaxHighlights,
  lightTheme,
} from "./syntaxHighlighting";
import { fixedTabWidthExtension } from "./tabWidthExtension";
import { listExtension } from "./list";
import { revealBlockOnArrowExtension } from "./revealBlockOnArrow";
import { prosemarkMarkdownFormattingKeymap } from "./markdownFormattingKeymap";
import { platformDeleteKeymap } from "./deleteKeymap";
export { prosemarkMarkdownSyntaxExtensions } from "./markdown";

export const prosemarkBasicSetup = (): Extension => [
  // ProseMark Setup
  defaultHideExtensions,
  defaultFoldableSyntaxExtensions,
  revealBlockOnArrowExtension,
  clickLinkExtension,
  defaultClickLinkHandler,
  listExtension,
  fixedTabWidthExtension,
  codeBlockDecorationsExtension,

  // Basic CodeMirror Setup
  history(),
  dropCursor(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  // Word- and line-wise delete, bound by name so they do not depend on the
  // library's platform sniffing. Every editor in the app pulls this from here;
  // see `deleteKeymap.ts`.
  platformDeleteKeymap,
  keymap.of([
    ...prosemarkMarkdownFormattingKeymap,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
  foldGutter(),
  EditorView.lineWrapping,
];

export const prosemarkBaseThemeSetup = (): Extension => [
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  baseTheme,
  codeFenceTheme,
];

export const prosemarkLightThemeSetup = (): Extension => [prosemarkBaseThemeSetup(), lightTheme];
