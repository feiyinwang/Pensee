import * as tauri from "@/lib/tauri";
import { importBook } from "@/lib/book-import";
import { useEditorStore } from "@/stores/editor-store";
import type { SampleId } from "./onboarding-store";

/** What each sample is, and the pen move its loop ends on
 *  (SPECs/onboarding-spec.md, screen 3). */
export interface Sample {
  label: string;
  /** Quiet text on the right of its button: whose it is. */
  meta: string;
  /** How the writer brings something in before ⌘. */
  capture: "pin" | "highlight" | "none";
  /** The pill the loop runs, and its name. */
  pill: "!" | "@" | "[[";
  pillName: string;
  /** Pin samples: the second the player opens at, and the line Pensée
   *  writes when the writer clicks the empty first line. */
  start?: number;
  suggest?: string;
}

export const SAMPLES: Record<SampleId, Sample> = {
  video: {
    label: "YouTube",
    meta: "Huberman Lab",
    capture: "pin",
    pill: "@",
    pillName: "Check",
    // Tool 7, "Tuning Your Dopamine for Ongoing Motivation".
    start: 5882,
    suggest: "Rewarding yourself after studying can make studying feel worse.",
  },
  podcast: {
    label: "Podcast",
    meta: "Dwarkesh Podcast",
    capture: "pin",
    pill: "!",
    pillName: "Answer",
    start: 721,
    suggest: "Why do most learning tools fail?",
  },
  book: {
    label: "Book",
    meta: "The Elements of Style",
    capture: "highlight",
    pill: "[[",
    pillName: "Connect",
  },
  write: {
    label: "Just write",
    meta: "A blank note",
    capture: "none",
    pill: "!",
    pillName: "Answer",
  },
};

/** Where the practice notes go, inside the vault. */
export const SAMPLES_FOLDER = "Pensée samples";

const NOTES: Record<"video" | "podcast" | "write", { name: string; content: string }> = {
  video: {
    name: "Controlling Your Dopamine For Motivation, Focus & Satisfaction",
    content: [
      "---",
      "Type: YouTube",
      "Link: https://www.youtube.com/watch?v=QmOF0crdyRU",
      "Author: Andrew Huberman",
      "---",
      "",
      "- ",
      "",
    ].join("\n"),
  },
  podcast: {
    name: "The reason most learning tools fail",
    content: [
      "---",
      "Type: Podcast",
      "Link: https://api.substack.com/feed/podcast/134213434/463435c7e1f71b2fb8da7a138134566f.mp3",
      "Cover: https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/f0/3a/c1/f03ac1eb-64cb-9a44-66f1-9312b4491daf/mza_854851886077379904.jpg/300x300bb.jpg",
      "Author: Dwarkesh Podcast, Andy Matuschak",
      "---",
      "",
      "- ",
      "",
    ].join("\n"),
  },
  write: {
    name: "Why do we forget most of what we read",
    content: "- Why do we forget most of what we read?\n",
  },
};

/** Writes the sample's practice note into the vault (or, for the book,
 *  downloads and imports it beside its page), opens it, and returns the
 *  note's path. An existing practice note is reopened as it is. */
export async function openSample(root: string, id: SampleId): Promise<string> {
  if (id === "book") {
    const book = await tauri.downloadSampleBook();
    const page = await importBook(book, { type: "book" });
    if (!page) throw new Error("The sample book couldn't be added to your folder.");
    return page;
  }
  const folder = `${root}/${SAMPLES_FOLDER}`;
  // Already there from an earlier run: reading it proves it, else this throws.
  await tauri.createDirectory(folder).catch(() => tauri.readDirectory(folder));
  const note = NOTES[id];
  const path = `${folder}/${note.name}.md`;
  try {
    await tauri.readFile(path);
  } catch {
    await tauri.writeFile(path, note.content);
  }
  await useEditorStore.getState().openFile(path);
  return path;
}
