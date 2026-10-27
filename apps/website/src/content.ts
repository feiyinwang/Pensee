/**
 * Everything the homepage says, in one place (SPECs/website-homepage-spec.md).
 * The GIFs and book covers are imported from where they already live, so
 * there is one copy of each in the repo.
 */
import bookGif from "../../../assets/readme/book.gif";
import checkGif from "../../../assets/readme/check.gif";
import connectGif from "../../../assets/readme/connect.gif";
import dockGif from "../../../assets/readme/dock.gif";
import penGif from "../../../assets/readme/pen.gif";
import podcastGif from "../../../assets/readme/podcast.gif";
import youtubeGif from "../../../assets/readme/youtube.gif";

import type { Zoom } from "./zoom";

/** The part of a GIF a card shows (src/zoom.ts). */
export type { Zoom };

export const VERSION = "0.6.0";
export const REPO = "https://github.com/feiyinwang/Pensee";
/** The newest release's zip, straight to the browser. scripts/release.sh uploads it under this fixed name. */
export const DOWNLOAD = `${REPO}/releases/latest/download/Pensee-arm64.zip`;
/** The newest release's Windows installer, under the fixed name .github/workflows/release-windows.yml uploads. */
export const DOWNLOAD_WINDOWS = `${REPO}/releases/latest/download/Pensee-windows-x64-setup.exe`;
export const BREW = "brew install --cask feiyinwang/tap/pensee";

export const HEADLINE = "Thinking, made by writing.";
/** The README's first paragraph, with "neurodivergent" added. */
export const INTRO =
  "I’m making Pensée for people like me: neurodivergent, with ADHD or a brain that works a little differently. We collect everything: the article, the video, the book a friend mentioned, the idea that shows up at 2am. Very little of it gets digested, and we wish it did, because digesting is how you come to understand the world and yourself.";
const CLAUDE_NOTE =
  "The second pen and the Agent run on Claude Code; Pensée signs you in from Settings.";
export const FINE_PRINT = `${CLAUDE_NOTE} Pensée isn’t notarized by Apple yet, so if macOS won’t open the download, use the install line: it clears the flag macOS puts on downloads.`;
export const FINE_PRINT_WINDOWS = `${CLAUDE_NOTE} The installer isn’t signed yet, so Windows may warn the first time you run it: choose More info, then Run anyway.`;

/**
 * The Talk section, after the room named in `after` (SPECs/website-homepage-spec.md,
 * "Talk section"). The talk its demo plays is in talk-script.ts.
 */
export const TALK_SECTION = {
  after: "think",
  eyebrow: "New · Talk to a note",
  title: "Talk it through. Watch it take shape.",
  intro:
    "Press Record and think out loud. Pensée sorts what you say into topics and draws each one while you talk, then puts it in your note when you stop. Whisper writes the transcript on your computer.",
  /** Under the demo while no line is being said. */
  rest: {
    start:
      "A 48-second talk about a job in Lisbon, drawn as it was said. Click a picture under the topics to draw it another way, or press Stop to see it in the note.",
    ended:
      "That’s the talk. Press Stop and it goes into the note, or click a picture to draw a topic another way.",
    stopped:
      "This is the note after Stop: what you concluded, and each topic as a board you can open and rearrange.",
  },
};

/** Public-domain paintings, downloaded from Wikimedia Commons into public/paintings. */
export interface Painting {
  src: string;
  /** object-position: where the subject sits, so a crop keeps it. */
  focus: string;
  by: string;
  title: string;
  year: string;
  at: string;
}

export const PAINTINGS = {
  rembrandt: {
    src: "/paintings/rembrandt.webp",
    focus: "40% 62%",
    by: "Rembrandt",
    title: "Philosopher in Meditation",
    year: "1632",
    at: "Musée du Louvre, Paris",
  },
  caravaggio: {
    src: "/paintings/caravaggio.webp",
    focus: "50% 42%",
    by: "Caravaggio",
    title: "Saint Jerome Writing",
    year: "1605–06",
    at: "Galleria Borghese, Rome",
  },
  fragonard: {
    src: "/paintings/fragonard.webp",
    focus: "50% 40%",
    by: "Jean-Honoré Fragonard",
    title: "Young Girl Reading",
    year: "c. 1769",
    at: "National Gallery of Art, Washington",
  },
  vermeer: {
    src: "/paintings/vermeer.webp",
    focus: "50% 34%",
    by: "Johannes Vermeer",
    title: "The Geographer",
    year: "1669",
    at: "Städel Museum, Frankfurt",
  },
  antonello: {
    src: "/paintings/antonello.webp",
    focus: "50% 56%",
    by: "Antonello da Messina",
    title: "Saint Jerome in His Study",
    year: "c. 1475",
    at: "National Gallery, London",
  },
  hammershoi: {
    src: "/paintings/hammershoi.webp",
    focus: "50% 42%",
    by: "Vilhelm Hammershøi",
    title: "Interior with a Woman Seen from the Back",
    year: "1903–04",
    at: "Randers Kunstmuseum",
  },
  wright: {
    src: "/paintings/wright.webp",
    focus: "50% 36%",
    by: "Joseph Wright of Derby",
    title: "A Philosopher Lecturing on the Orrery",
    year: "c. 1766",
    at: "Derby Museum and Art Gallery",
  },
} satisfies Record<string, Painting>;

/** The note in the 1200×750 pen GIFs: the title, the pen's box and every line it adds, at 1.67×. */
const PEN_NOTE: Zoom = { box: [335, 75, 1055, 525], size: [1200, 750] };
/** The book GIF up close (16:10, 1.43×): the whole note, and the start of the book page with the Highlight pill and the highlighted sentence. The ends of the book's longer lines fall outside. */
const BOOK_PANES: Zoom = { box: [20, 40, 860, 565], size: [1200, 750] };

export type SceneId = "library" | "projects" | "calendar" | "agent" | "markdown" | "rich";
/** Scenes the app's onboarding already plays (apps/desktop/src/components/onboarding/feature-scenes.ts). */
export type OnboardingSceneId = "dump" | "tabs";

/** A keycap label, or words for a gesture that has no key. */
export type Key = string | { say: string };

export interface Feature {
  id: string;
  title: string;
  description: string;
  keys: Key[];
  /** A README GIF, one of this site's scenes, or one of the app's onboarding scenes. */
  demo: { gif: string; zoom?: Zoom } | { scene: SceneId } | { onboarding: OnboardingSceneId };
}

export interface Room {
  id: string;
  name: string;
  /** The room's intro; each carries a piece of the README's opening. */
  intro: string;
  painting: Painting;
  features: Feature[];
}

export const ROOMS: Room[] = [
  {
    id: "think",
    name: "Think with a second pen",
    intro:
      "The AI is a second pen, not a ghostwriter. Press ⌘. on a line and it can check it against papers, connect it to your other notes, or answer it. Each time, the conclusion is yours to write.",
    painting: PAINTINGS.caravaggio,
    features: [
      {
        id: "check",
        title: "Check a claim against real papers",
        description:
          "Select a line and the pen cites papers for and against it. You write the call.",
        keys: ["⌘", ".", "@"],
        demo: { gif: checkGif, zoom: PEN_NOTE },
      },
      {
        id: "connect",
        title: "Find what you already wrote",
        description:
          "The pen brings back what your other notes say about a line. You write how they connect.",
        keys: ["⌘", ".", "["],
        demo: { gif: connectGif, zoom: PEN_NOTE },
      },
      {
        id: "answer",
        title: "Write your take before the answer",
        description:
          "The answer stays sealed until you’ve written your own. Then Tab combines the two into one list.",
        keys: ["⌘", ".", "!"],
        demo: { gif: penGif, zoom: PEN_NOTE },
      },
      {
        id: "organize",
        title: "Turn a brain dump into a plan",
        description:
          "Type fast and messy. The pen sorts your lines into an outline, in your own words.",
        keys: ["⌘", ".", "#"],
        demo: { onboarding: "dump" },
      },
    ],
  },
  {
    id: "collect",
    name: "Collect into notes",
    intro:
      "Pensée is where the collecting turns into understanding. Each article, video, book or podcast opens beside a note, and you write about it in your own words, where you read it.",
    painting: PAINTINGS.fragonard,
    features: [
      {
        id: "book",
        title: "Read a book beside its note",
        description:
          "PDFs and EPUBs open next to their note. Highlight a line and it lands there; click it later and the page comes back.",
        keys: [{ say: "Select → Highlight" }],
        demo: { gif: bookGif, zoom: BOOK_PANES },
      },
      {
        id: "youtube",
        title: "Pin notes to the second",
        description:
          "A YouTube note plays the video beside its transcript. Click a line to play from it, and ⌘S pins the moment to the line you’re writing.",
        keys: ["⌘", "S"],
        demo: { gif: youtubeGif },
      },
      {
        id: "podcast",
        title: "Podcasts work the same way",
        description:
          "Episodes play inside the note. ⌘S plays, ⌘S again pins the moment, and every pin jumps back to its second.",
        keys: ["⌘", "S"],
        demo: { gif: podcastGif },
      },
      {
        id: "library",
        title: "One shelf for everything you collect",
        description:
          "Books, videos, podcasts and papers in one Library, added from a link, a file or a title. Apple Books highlights sync in on their own.",
        keys: ["⌘G", "L"],
        demo: { scene: "library" },
      },
    ],
  },
  {
    id: "arrange",
    name: "Arrange your thinking",
    intro:
      "Your memory goes on the page, so your head doesn’t have to hold it all. The notes link up into something you can come back to: a board when an idea needs a map, your projects, and a page for every day.",
    painting: PAINTINGS.vermeer,
    features: [
      {
        id: "board",
        title: "Map the essay before you write it",
        description:
          "Put a board in the note. Drop a card next to another and it docks there, joined by an arrow.",
        keys: ["/board"],
        demo: { gif: dockGif },
      },
      {
        id: "projects",
        title: "Every project on one board",
        description:
          "Your project notes as a list, kanban or timeline. Moving a card updates the note’s status.",
        keys: ["⌘G", "P"],
        demo: { scene: "projects" },
      },
      {
        id: "tabs",
        title: "See every tab at once",
        description:
          "Pinch in on the trackpad and open tabs sit side by side. Pinch out on one to read it alone.",
        keys: [{ say: "Pinch" }],
        demo: { onboarding: "tabs" },
      },
      {
        id: "calendar",
        title: "A page for every day, week and quarter",
        description:
          "⌘T opens today’s note. ⌘] opens a calendar where any day, week, month, quarter or year is a note.",
        keys: ["⌘", "]"],
        demo: { scene: "calendar" },
      },
      {
        id: "agent",
        title: "An agent that edits with you",
        description: "⌘J opens a Claude chat that reads your open tabs and can edit your pages.",
        keys: ["⌘", "J"],
        demo: { scene: "agent" },
      },
    ],
  },
  {
    id: "own",
    name: "Keep it yours",
    intro:
      "Calm enough to get into the zone, and safe: every note is a markdown file in a folder on your own computer. Pensée opens your Obsidian vault as it is, and nothing you write leaves it unless you ask the pen or the Agent.",
    painting: PAINTINGS.antonello,
    features: [
      {
        id: "markdown",
        title: "Plain markdown, in your own folder",
        description:
          "Open your Obsidian vault as it is. Every note stays a file any editor can open, and the keys are Obsidian’s.",
        keys: ["⌘", "O"],
        demo: { scene: "markdown" },
      },
      {
        id: "rich",
        title: "Diagrams, math and tables in place",
        description:
          "Mermaid diagrams, LaTeX and tables render as you write. Images, videos and HTML files embed inline.",
        keys: [],
        demo: { scene: "rich" },
      },
    ],
  },
];
