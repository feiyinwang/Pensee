import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import * as editorApi from "@/hooks/editor-api";
import { parseDocument, parseFrontmatter } from "@/lib/frontmatter";
import { formatMarkdownDestination, getParentDir } from "@/lib/paths";
import { rebaseMarkdownLinks } from "@/lib/rebase-markdown-links";
import * as tauri from "@/lib/tauri";
import { tabularPasteTransaction } from "@/lib/tabular-paste";
import { showEditorNotice } from "./editor-notice-store";

const MAX_IMAGE_SIZE_MB = 5;
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;

async function handleImagePaste(
  file: File,
  view: EditorView,
  filePath: string,
  isDisposed: () => boolean,
) {
  const buffer = await file.arrayBuffer();
  if (isDisposed()) return;
  if (buffer.byteLength > MAX_IMAGE_SIZE) {
    const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    showEditorNotice(`Image not pasted: ${sizeMb} MB is over the ${MAX_IMAGE_SIZE_MB} MB limit`);
    return;
  }

  const imageData = Array.from(new Uint8Array(buffer));
  const format = file.type.split("/")[1] || "png";
  const result = await tauri.saveClipboardImage(filePath, imageData, format);
  if (isDisposed()) return;
  const imageMarkdown = `![${file.name}](${formatMarkdownDestination(result.relative_path)})`;
  const cursor = view.state.selection.main.head;
  view.dispatch({ changes: { from: cursor, insert: imageMarkdown } });
}

// Pasting a whole document (frontmatter + body) into a file without
// frontmatter adopts the frontmatter into the panel and inserts only the body.
function handleFrontmatterPaste(event: ClipboardEvent, view: EditorView, filePath: string) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;

  const parsedFrontmatter = parseFrontmatter(text);
  if (parsedFrontmatter.frontmatter === null) return false;

  const parsedDocument = parseDocument(text);

  const file = editorApi.getOpenFile(filePath);
  if (!file || file.frontmatter !== null) return false;

  event.preventDefault();
  editorApi.updateFrontmatter(filePath, parsedFrontmatter.frontmatter);
  if (parsedDocument.body) {
    view.dispatch(view.state.replaceSelection(parsedDocument.body));
  }
  return true;
}

// Relative image and link paths are relative to the note they live in, so
// text copied out of one note must be rebased before landing in a note in
// another folder. The clipboard can't carry the source path (CodeMirror clears
// it to plain text), so remember the last copy and match it on paste.
let lastCopy: { text: string; dir: string } | null = null;

function normalizeClipboardText(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

// Mirrors what CodeMirror puts on the clipboard: the selected ranges, or the
// caret lines when nothing is selected.
function recordCopy(view: EditorView, filePath: string) {
  const { state } = view;
  const ranges = state.selection.ranges;
  const text = ranges.some((range) => !range.empty)
    ? ranges
        .filter((range) => !range.empty)
        .map((range) => state.sliceDoc(range.from, range.to))
        .join(state.lineBreak)
    : ranges.map((range) => state.doc.lineAt(range.head).text).join(state.lineBreak);
  lastCopy = { text: normalizeClipboardText(text), dir: getParentDir(filePath) };
}

function handleRebasedPaste(event: ClipboardEvent, view: EditorView, filePath: string) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text || !lastCopy || normalizeClipboardText(text) !== lastCopy.text) return false;
  const rebased = rebaseMarkdownLinks(text, lastCopy.dir, getParentDir(filePath));
  if (rebased === text) return false;
  event.preventDefault();
  view.dispatch(view.state.replaceSelection(rebased), { userEvent: "input.paste" });
  return true;
}

// Typing `---` on the first line of a file without frontmatter opens an empty
// frontmatter panel instead of leaving a horizontal rule in the body.
function handleFrontmatterStart(event: KeyboardEvent, view: EditorView, filePath: string) {
  if (event.key !== "-") return false;

  const { doc, selection } = view.state;
  const pos = selection.main.head;
  const firstLine = doc.line(1);

  if (pos !== firstLine.from + 2) return false;
  if (firstLine.text !== "--") return false;

  const file = editorApi.getOpenFile(filePath);
  if (!file || file.frontmatter !== null) return false;

  editorApi.updateFrontmatter(filePath, "");
  view.dispatch({
    changes: { from: firstLine.from, to: firstLine.from + 2 },
  });
  event.preventDefault();
  return true;
}

/** Paste and keyboard handling that touches files: image paste to disk,
 *  frontmatter adoption on paste, relative paths rebased when pasting text
 *  copied from a note in another folder, tab-separated text pasted as a pipe table,
 *  and the `---` frontmatter shortcut. */
export function editorClipboardExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return EditorView.domEventHandlers({
    copy(_event, view) {
      recordCopy(view, getFilePath());
      return false;
    },
    cut(_event, view) {
      recordCopy(view, getFilePath());
      return false;
    },
    paste(event, view) {
      if (handleFrontmatterPaste(event, view, getFilePath())) return true;

      const items = event.clipboardData?.items;
      if (!items) return false;

      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const imageFile = item.getAsFile();
        if (!imageFile) continue;

        event.preventDefault();
        void handleImagePaste(imageFile, view, getFilePath(), isDisposed).catch((error) => {
          console.error("[editor] Failed to paste image:", error);
        });
        return true;
      }

      if (handleRebasedPaste(event, view, getFilePath())) return true;

      const text = event.clipboardData?.getData("text/plain");
      const tableTransaction = text ? tabularPasteTransaction(view.state, text) : null;
      if (tableTransaction) {
        event.preventDefault();
        view.dispatch(tableTransaction);
        return true;
      }

      return false;
    },
    keydown(event, view) {
      return handleFrontmatterStart(event, view, getFilePath());
    },
  });
}
