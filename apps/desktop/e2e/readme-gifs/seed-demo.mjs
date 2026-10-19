// Seeds a made-up demo vault into the e2e build's own app-data dir
// (com.pensee.app.e2e), so README GIFs never show real notes. Run by
// film.sh before each scene; it replaces the vault and the app's saved
// session, so every scene starts from the same notes.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DATA = join(homedir(), "Library/Application Support/com.pensee.app.e2e");
const VAULT = join(APP_DATA, "Pensée demo");

const project = (status, start, deadline, body) =>
  `---\nType: Project\nStatus: ${status}\nStart: ${start}\nDeadline: ${deadline}\n---\n\n${body}\n`;
const amazon = (id) => `https://m.media-amazon.com/images/I/${id}.jpg`;
const book = (author, cover, body) =>
  `---\nType: Book\nAuthor: ${author}\nCover: ${amazon(cover)}\n---\n## Highlights\n${body}\n`;

const NOTES = {
  "Notes/Writing is thinking.md": [
    "A thought you haven't written down is still a feeling. Putting it into sentences is what turns it into an idea you can check, argue with, and build on.",
    "",
    "> If you're thinking without writing, you only think you're thinking.",
    "",
    "## Why it works",
    "",
    "- Writing is slow, so it makes you finish each thought before the next one starts.",
    "- The page remembers, so you can hold more than fits in your head.",
    "- Rereading shows you the gaps. See [[Notes that link]] for how links help.",
    "",
    "## This week",
    "",
    "- [x] Draft the opening of the essay",
    "- [x] Pull highlights from *How to Take Smart Notes*",
    "- [ ] Rewrite the middle section in plain words",
    "- [ ] Send the draft to two friends",
    "",
    "| Habit | When | Why |",
    "| --- | --- | --- |",
    "| Morning pages | 7:30 | Empty the head before work |",
    "| One idea per note | Always | Notes stay easy to link |",
    "| Weekly review | Friday | Find what keeps coming back |",
    "",
  ].join("\n"),
  "Notes/Notes that link.md":
    "A note earns its keep when it points somewhere. Link it to [[Writing is thinking]] and it starts a conversation.\n",
  "Notes/Reading list.md": "- *The Art of Clear Thinking*\n- *Bird by Bird*\n- *On Writing Well*\n",
  "Notes/Why I can't focus.md": [
    "A map of what pulls me away, and one small thing to try for each.",
    "",
    "```board",
    '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
    '{"id":"q","t":"roundRect","x":0,"y":240,"w":220,"h":90,"st":{"s":"yellow","f":"yellow-soft"},"lb":{"tx":"Why I can\'t focus"}}',
    '{"id":"m1","t":"roundRect","x":340,"y":60,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Too many tabs open"}}',
    '{"id":"m2","t":"roundRect","x":340,"y":240,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"No clear next step"}}',
    '{"id":"m3","t":"roundRect","x":340,"y":420,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Afraid to start badly"}}',
    '{"id":"t1","t":"roundRect","x":640,"y":60,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"One tab at a time"}}',
    '{"id":"t2","t":"roundRect","x":640,"y":240,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"Write the next step down"}}',
    '{"id":"t3","t":"roundRect","x":640,"y":420,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"Write a messy first line"}}',
    '{"id":"l1","t":"arrow","x":220,"y":285.0,"w":120,"h":-180.0,"pts":[[0,0],[120,-180.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m1","fx":0,"gap":0}}',
    '{"id":"l2","t":"arrow","x":220,"y":285.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m2","fx":0,"gap":0}}',
    '{"id":"l3","t":"arrow","x":220,"y":285.0,"w":120,"h":180.0,"pts":[[0,0],[120,180.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m3","fx":0,"gap":0}}',
    '{"id":"l4","t":"arrow","x":560,"y":105.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"m1","fx":0,"gap":0},"b2":{"el":"t1","fx":0,"gap":0}}',
    '{"id":"l5","t":"arrow","x":560,"y":285.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"m2","fx":0,"gap":0},"b2":{"el":"t2","fx":0,"gap":0}}',
    '{"id":"l6","t":"arrow","x":560,"y":465.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"m3","fx":0,"gap":0},"b2":{"el":"t3","fx":0,"gap":0}}',
    "```",
    "",
  ].join("\n"),
  "Notes/Focus board.md": [
    "Drag a card next to another to connect them.",
    "",
    "```board",
    '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
    '{"id":"q","t":"roundRect","x":0,"y":240,"w":220,"h":90,"st":{"s":"yellow","f":"yellow-soft"},"lb":{"tx":"Why I can\'t focus"}}',
    '{"id":"m1","t":"roundRect","x":340,"y":60,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Too many tabs open"}}',
    '{"id":"m2","t":"roundRect","x":340,"y":240,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"No clear next step"}}',
    '{"id":"m3","t":"roundRect","x":340,"y":420,"w":220,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Afraid to start badly"}}',
    '{"id":"t1","t":"roundRect","x":0,"y":540,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"One tab at a time"}}',
    '{"id":"t2","t":"roundRect","x":640,"y":240,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"Write the next step down"}}',
    '{"id":"t3","t":"roundRect","x":640,"y":420,"w":220,"h":90,"st":{"s":"green","f":"green-soft"},"lb":{"tx":"Write a messy first line"}}',
    '{"id":"l1","t":"arrow","x":220,"y":285.0,"w":120,"h":-180.0,"pts":[[0,0],[120,-180.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m1","fx":0,"gap":0}}',
    '{"id":"l2","t":"arrow","x":220,"y":285.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m2","fx":0,"gap":0}}',
    '{"id":"l3","t":"arrow","x":220,"y":285.0,"w":120,"h":180.0,"pts":[[0,0],[120,180.0]],"b1":{"el":"q","fx":0,"gap":0},"b2":{"el":"m3","fx":0,"gap":0}}',
    '{"id":"l5","t":"arrow","x":560,"y":285.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"m2","fx":0,"gap":0},"b2":{"el":"t2","fx":0,"gap":0}}',
    '{"id":"l6","t":"arrow","x":560,"y":465.0,"w":120,"h":0.0,"pts":[[0,0],[120,0.0]],"b1":{"el":"m3","fx":0,"gap":0},"b2":{"el":"t3","fx":0,"gap":0}}',
    "```",
    "",
  ].join("\n"),
  "Notes/How I learn.md": [
    "What I've noticed about how I learn, to check against what's known.",
    "- Rereading my notes is the best way to remember them.",
    "- I only understand a book once I've written about it.",
    "",
  ].join("\n"),
  "Notes/Questions.md": [
    "Things I keep wondering about while reading.",
    "- why does sleep help memory?",
    "",
  ].join("\n"),
  "Library/Reading slowly.md":
    "---\nType: Paper\nAuthor: Pensée demo\n---\n\n![[reading-slowly.pdf]]\n\n## My notes\n\n- Saving a page is not the same as understanding it.\n",
  "Projects/Essay on attention.md": project(
    "Ongoing",
    "2026-10-01",
    "2026-11-15",
    "An essay on why attention, not time, is what a writer runs out of.",
  ),
  "Projects/Garden journal.md": project(
    "Ongoing",
    "2026-09-12",
    "2026-12-01",
    "One page a week on what grew, what didn't, and why.",
  ),
  "Projects/Newsletter relaunch.md": project(
    "To-do",
    "2026-11-01",
    "2026-12-10",
    "A monthly letter of the best ideas from the notes.",
  ),
  "Projects/Book club notes.md": project(
    "To-do",
    "2026-11-05",
    "2026-11-30",
    "Questions and quotes for each meeting.",
  ),
  "Projects/Portfolio site.md": project(
    "Done",
    "2026-08-01",
    "2026-09-20",
    "A small site for finished essays.",
  ),
  "Library/How to Take Smart Notes.md": book(
    "Sönke Ahrens",
    "61m9hCq40PL",
    "- Writing is not what follows research; it is the medium of the work.",
  ),
  "Library/Controlling Your Dopamine For Motivation, Focus & Satisfaction.md":
    "---\nType: YouTube\nLink: https://www.youtube.com/watch?v=QmOF0crdyRU\n---\n",
  "Library/Andy Matuschak on why most learning tools fail.md":
    "---\nType: Podcast\nLink: https://api.substack.com/feed/podcast/134213434/463435c7e1f71b2fb8da7a138134566f.mp3\nCover: https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/f0/3a/c1/f03ac1eb-64cb-9a44-66f1-9312b4491daf/mza_854851886077379904.jpg/300x300bb.jpg\n---\n",
  "Library/Bird by Bird.md": book("Anne Lamott", "71JEw9Z4ujL", "- Take it bird by bird."),
  "Library/On Writing Well.md": book(
    "William Zinsser",
    "71bIiz4wX0L",
    "- Clutter is the disease of writing.",
  ),
  "Library/The Elements of Style.md": `---\nType: Book\nAuthor: William Strunk Jr.\nCover: ${amazon("71aV5vqvptL")}\nBook: The Elements of Style.epub\ntags: [Book]\n---\nA friend who edits for a living gave me this. Reading it one rule a night.\n## Highlights\n- Omit needless words. ^bk-s0-45-65\n`,
  "Library/Deep Work.md": book("Cal Newport", "71aqIRRigeL", "- Focus is a skill you train."),
  "Library/Steal Like an Artist.md": book("Austin Kleon", "617JBhF7XcL", "- Nothing is original."),
};

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "Library/assets"), { recursive: true });
copyFileSync(
  new URL("./reading-slowly.pdf", import.meta.url),
  join(VAULT, "Library/assets/reading-slowly.pdf"),
);
execFileSync("python3", [
  "-I",
  fileURLToPath(new URL("./make-book-epub.py", import.meta.url)),
  join(VAULT, "Library/The Elements of Style.epub"),
]);
for (const [relative, content] of Object.entries(NOTES)) {
  const path = join(VAULT, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
mkdirSync(APP_DATA, { recursive: true });
writeFileSync(join(APP_DATA, "recent_workspaces.json"), JSON.stringify([VAULT], null, 2));
for (const file of ["sessions.json", "recent_files.json", "config", "preferences.json"]) {
  rmSync(join(APP_DATA, file), { force: true });
}
// Dark whatever the Mac's appearance is now: macOS's Auto appearance turns
// light by day, and the GIFs should all look alike.
writeFileSync(join(APP_DATA, "config"), "appearance.theme = dark\n");
console.log(`Demo vault ready at ${VAULT}`);
