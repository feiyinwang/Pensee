import { formatDailyNoteDate } from "./daily-note";
import {
  LIBRARY_KIND_LABELS,
  findLibraryNote,
  parseLibraryLink,
  type LibraryKind,
  type LibraryLink,
} from "./library-add";
import type { TypedNote } from "./tauri";
import { safePageName } from "./wiki-pages";

// The ⌘T composer (SPECs/composer-spec.md). Pure: what a draft would make,
// the type a pasted link implies, and the words on the box. The writes live in
// hooks/use-composer.ts.

export type ComposerKind = "note" | LibraryKind;

/** What a dropped or attached file is filed as; null while nothing decides
 *  (a PDF the import reads once it is in the vault). */
export type FileKind = "book" | "paper" | null;

export interface ComposerDraft {
  title: string;
  body: string;
  /** The type chip's value: a preset (⌘⇧L, a Library tab) or the user's pick. */
  kind: ComposerKind;
  /** The user (or a Library tab) chose `kind`, so a pasted link doesn't change it. */
  kindPicked: boolean;
  /** `YYYY-MM-DD`: the text goes into that day's note. */
  day: string | null;
  /** Vault-relative folder for a plain note; null is the vault root. */
  folder: string | null;
  /** An attached PDF or EPUB, as an absolute path. */
  file: string | null;
}

export const EMPTY_DRAFT: ComposerDraft = {
  title: "",
  body: "",
  kind: "note",
  kindPicked: false,
  day: null,
  folder: null,
  file: null,
};

export function isDraftEmpty(draft: ComposerDraft): boolean {
  return !draft.title.trim() && !draft.body.trim() && !draft.file;
}

/** The kind the draft makes: a date makes a note of that day; an attached
 *  file is a book or paper; a link the user didn't type a kind for takes the
 *  site's kind (or Book, as Library does for a site it doesn't know). */
export function effectiveKind(draft: ComposerDraft): ComposerKind {
  if (draft.file) {
    return draft.kind === "paper" || draft.kind === "book" ? draft.kind : "book";
  }
  if (draft.day) return "note";
  if (!draft.kindPicked) {
    const link = parseLibraryLink(draft.title);
    if (link) return link.guess ?? (draft.kind === "note" ? "book" : draft.kind);
  }
  return draft.kind;
}

export type ComposerTarget =
  | { kind: "empty" }
  | { kind: "note"; name: string; folder: string | null }
  | { kind: "day"; day: string }
  | { kind: "link"; link: LibraryLink; library: LibraryKind; existing: TypedNote | null }
  | { kind: "title"; title: string; library: LibraryKind }
  | { kind: "file"; path: string; library: FileKind };

/** What submitting `draft` would do. `libraryNotes` are the Library notes, or
 *  null while they load (a link is then offered as new). */
export function composerTarget(
  draft: ComposerDraft,
  libraryNotes: readonly TypedNote[] | null,
): ComposerTarget {
  const kind = effectiveKind(draft);
  if (draft.file) {
    return {
      kind: "file",
      path: draft.file,
      library: draft.kindPicked ? (kind as FileKind) : null,
    };
  }
  if (draft.day) return { kind: "day", day: draft.day };
  if (kind === "note") {
    const name = safePageName(draft.title) || (draft.body.trim() ? "Untitled" : "");
    return name ? { kind: "note", name, folder: draft.folder } : { kind: "empty" };
  }
  const link = parseLibraryLink(draft.title);
  if (link) {
    const existing = libraryNotes ? findLibraryNote(libraryNotes, link.url) : null;
    return { kind: "link", link, library: kind, existing };
  }
  const title = safePageName(draft.title);
  return title ? { kind: "title", title, library: kind } : { kind: "empty" };
}

/** `Today`, `Tomorrow`, `Yesterday`, else `12 Oct` (with the year when it
 *  isn't this one). */
export function dayLabel(day: string, now: Date): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const offset = (delta: number) =>
    formatDailyNoteDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta));
  if (day === offset(0)) return "Today";
  if (day === offset(1)) return "Tomorrow";
  if (day === offset(-1)) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function lowerDay(label: string): string {
  return /^(Today|Tomorrow|Yesterday)$/.test(label) ? label.toLowerCase() : label;
}

/** The primary button: a verb for what this draft does. An empty draft
 *  (button disabled) still names what its type chip would make. */
export function submitLabel(
  target: ComposerTarget,
  kind: ComposerKind,
  hasBody: boolean,
  now: Date,
): string {
  switch (target.kind) {
    case "empty":
      return kind === "note" ? "Create note" : `Add ${LIBRARY_KIND_LABELS[kind].toLowerCase()}`;
    case "note":
      return "Create note";
    case "day": {
      const day = lowerDay(dayLabel(target.day, now));
      return hasBody ? `Add to ${day}` : `Open ${day}`;
    }
    case "link":
      return target.existing
        ? "Open note"
        : `Add ${LIBRARY_KIND_LABELS[target.library].toLowerCase()}`;
    case "title":
      return `Add ${LIBRARY_KIND_LABELS[target.library].toLowerCase()}`;
    case "file":
      return target.library ? `Add ${target.library}` : "Add to Library";
  }
}

/** Set a date: the title can't name a day's note, so a typed one moves to the
 *  top of the body rather than being hidden. A date makes a note, so a
 *  Library kind falls back to Note. */
export function withDay(draft: ComposerDraft, day: string | null): ComposerDraft {
  if (!day) return { ...draft, day: null };
  const title = draft.title.trim();
  const body = title ? (draft.body.trim() ? `${title}\n${draft.body}` : title) : draft.body;
  return { ...draft, day, title: "", body, kind: "note", kindPicked: false, file: null };
}

/** Pick a kind from the chip. A Library kind clears the date. */
export function withKind(draft: ComposerDraft, kind: ComposerKind): ComposerDraft {
  return { ...draft, kind, kindPicked: true, day: kind === "note" ? draft.day : null };
}

/** `body` added to the end of a page's `text`, a blank line apart. */
export function appendBlock(text: string, body: string): string {
  const addition = body.trim();
  if (!addition) return text;
  const head = text.replace(/\s+$/, "");
  return head ? `${head}\n\n${addition}\n` : `${addition}\n`;
}

/** The title an attached file is shown with: its name without the extension. */
export function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.(pdf|epub)$/i, "");
}
