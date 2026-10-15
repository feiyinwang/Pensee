import { PROJECT_TYPE } from "./projects";
import { TWEET_TYPE } from "./x-bookmarks";
import type { TypedNote } from "./tauri";

// Spaces (SPECs/spaces-spec.md): saved questions about a note's `Type:`, never
// folders. The built-ins live here; a space you add is a markdown note with
// `Type: Space`, read back through `spaceFromNote`.

export type SpaceView = "gallery" | "list" | "cards" | "files" | "kanban";
export type CoverKind = "book" | "video" | "podcast" | "paper" | "tweet" | "note";
export type SpaceIcon = "projects" | "library" | "files" | "space";

/** One tab of a space: which types it shows and how its covers look. */
export interface SpaceTab {
  id: string;
  label: string;
  /** What one item is called, for the empty state ("Add your first book"). */
  noun: string;
  types: string[];
  cover: CoverKind;
  /** Where the tab's notes come from when Pensée brings them in itself, so
   *  the tab can show that sync's state (SPECs/x-bookmarks-spec.md). */
  source?: "x";
}

export interface SpaceDef {
  /** A built-in id, or `note:<path>` for a space note. */
  key: string;
  name: string;
  icon: SpaceIcon;
  view: SpaceView;
  tabs: SpaceTab[];
  /** The space note, for a space you added. */
  path?: string;
}

export const SPACE_NOTE_TYPE = "Space";
export const SPACE_VIEWS = ["gallery", "list", "cards"] as const;

const tab = (
  id: string,
  label: string,
  noun: string,
  types: string[],
  cover: CoverKind,
  source?: SpaceTab["source"],
): SpaceTab => ({ id, label, noun, types, cover, ...(source ? { source } : {}) });

export const BUILT_IN_SPACES: readonly SpaceDef[] = [
  {
    key: "projects",
    name: "Projects",
    icon: "projects",
    view: "kanban",
    tabs: [tab("projects", "Projects", "project", [PROJECT_TYPE], "note")],
  },
  {
    key: "library",
    name: "Library",
    icon: "library",
    view: "gallery",
    tabs: [
      tab("books", "Books", "book", ["Book"], "book"),
      // Courses are videos too: their notes keep `Type: Course` and show here.
      tab("videos", "Videos", "video", ["YouTube", "Video", "Course"], "video"),
      tab("podcasts", "Podcasts", "podcast", ["Podcast"], "podcast"),
      tab("papers", "Papers", "paper", ["Paper"], "paper"),
      tab("bookmarks", "Bookmarks", "bookmark", [TWEET_TYPE], "tweet", "x"),
    ],
  },
  { key: "files", name: "Files", icon: "files", view: "files", tabs: [] },
];

export const FILES_SPACE_KEY = "files";

export function builtInSpace(key: string): SpaceDef | undefined {
  return BUILT_IN_SPACES.find((space) => space.key === key);
}

export function noteSpaceKey(path: string): string {
  return `note:${path}`;
}

const COVER_BY_TYPE: Record<string, CoverKind> = {
  book: "book",
  youtube: "video",
  video: "video",
  course: "video",
  podcast: "podcast",
  paper: "paper",
  tweet: "tweet",
};

/** The cover a type draws in a space you added (`Shows: Book` looks like a book). */
export function coverKindForType(type: string): CoverKind {
  return COVER_BY_TYPE[type.trim().toLowerCase()] ?? "note";
}

export function splitTypes(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseView(value: string | undefined): SpaceView {
  const view = value?.trim().toLowerCase();
  return SPACE_VIEWS.find((v) => v === view) ?? "gallery";
}

/** A space note (`Type: Space`) as a space. `Shows` falls back to the note's
 *  own name, so "Recipes" with no `Shows` still means something. */
export function spaceFromNote(note: TypedNote): SpaceDef {
  const name = note.title ?? note.name;
  const types = splitTypes(note.properties.shows);
  const shown = types.length > 0 ? types : [note.name];
  return {
    key: noteSpaceKey(note.path),
    name,
    icon: "space",
    view: parseView(note.properties.view),
    tabs: [tab("all", name, shown[0].toLowerCase(), shown, coverKindForType(shown[0]))],
    path: note.path,
  };
}

/** A file name made from what was typed into "Name"; null when nothing usable is left. */
export function spaceFileStem(name: string): string | null {
  const stem = name
    .replace(/[/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem.length > 0 ? stem : null;
}

/** The notes that belong to `spaceTab`. */
export function notesInTab(notes: readonly TypedNote[], spaceTab: SpaceTab): TypedNote[] {
  const wanted = new Set(spaceTab.types.map((t) => t.toLowerCase()));
  return notes.filter((note) => wanted.has(note.note_type.toLowerCase()));
}

export function allTypes(space: SpaceDef): string[] {
  return space.tabs.flatMap((t) => t.types);
}

/** Stable small hash of a title, so a default cover keeps its colour and layout. */
export function titleHash(title: string): number {
  let hash = 2166136261;
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** How many avatar and cover tones there are (`.tone0`…`.tone9` in
 *  `spaces.module.css`). */
export const TONES = 10;

/** An X author's initial avatar, the same in Library and in the opened note:
 *  the name shown (the author, else `@handle`), its first letter, and a tone. */
export function tweetAvatar(
  author: string | null | undefined,
  handle: string | null | undefined,
  fallback: string,
): { name: string; initial: string; tone: number } {
  const name = author || (handle ? `@${handle}` : fallback);
  return {
    name,
    initial: Array.from(name.replace(/^@/, ""))[0]?.toUpperCase() ?? "",
    tone: titleHash(name) % TONES,
  };
}

/** First author-like property of a note, for a cover's byline. */
export function bylineOf(note: TypedNote): string | null {
  const p = note.properties;
  return p.author ?? p.authors ?? p.channel ?? p.host ?? p.creator ?? p.by ?? null;
}
