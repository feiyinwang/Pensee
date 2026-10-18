// Builds the QA vault from scratch and makes it the e2e app's only recent
// workspace, so every journey run starts from the same notes.
// Run by e2e/qa/run.sh before WebdriverIO launches the app.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The e2e build's own app-data dir (identifier com.pensee.app.e2e), so the
// vault never touches the user's real workspace or a release instance.
const APP_DATA = join(homedir(), "Library/Application Support/com.pensee.app.e2e");
export const VAULT = join(APP_DATA, "qa-vault");

const NOTES = {
  "Welcome.md": "A note to open first.\n\n## Section\n\n- one\n- two\n- [ ] a task\n",
  "Notes/On writing.md": "Writing is thinking.\n\nSee [[Welcome]].\n",
  "Projects/Launch site.md":
    "---\nType: Project\nStatus: Ongoing\nDeadline: 2026-12-01\n---\n\nShip the site.\n",
  "Projects/Old idea.md": "---\nType: Project\nStatus: Done\n---\n\nFinished.\n",
  "Library/A book.md": "---\nType: Book\nAuthor: Someone\n---\n\n## Highlights\n",
  // The standing outline (ED-20…23): enough headings, at three depths, and
  // enough text under each that clicking one has to scroll the note.
  "Notes/Outline tour.md": ["Overview", "Setup", "Daily use", "Shortcuts", "Wrapping up"]
    .flatMap((title, i) => [
      `## ${title}`,
      "",
      ...Array.from({ length: 12 }, (_, n) => `Paragraph ${n + 1} under ${title}.\n`),
      ...(i % 2 === 0 ? [`### ${title} details`, "", "A deeper section.", ""] : []),
    ])
    .join("\n"),
  // The second pen (PEN journeys): its own lines already in a note (two
  // echoes, a sealed answer with an empty take), a note for Connect to find,
  // and a video note with a transcript to answer from.
  "Notes/Pen.md": [
    "Writing is thinking on paper.",
    "",
    "- rereading feels like learning because the page looks familiar",
    "  - Supports: Highlighting felt like studying but left nothing behind. — [[Study habits]] ^ai-e-bbbb",
    "  - Another angle: You knew familiar faces but forgot their names. — [[People]] ^ai-e-cccc",
    "- I think we basically just need to really sleep on it",
    "- why does sleep help memory?",
    "- why do drafts get better overnight?",
    "  - Sleep replays the day's memories and links them to older ones. ^ai-s-aaaa",
    "    - ",
    "- naps help you remember what you studied",
    "- how to make a new habit stick",
    "",
  ].join("\n"),
  // Organize's pyramid (PEN-30): a flat brain dump, every line at one level.
  "Notes/Side projects.md": [
    "- I start too many things at once",
    "- no deadline so it drifts",
    "- the habit app I worked on for 3 weeks, then nothing",
    // Two points in one line: Organize splits it, losing neither.
    "- I think excitement basically fades after the first week, and then the boring middle part (auth, settings, edge cases) really drags",
    "- I always stall at settings pages",
    "- I don't tell anyone, so no one asks how it's going",
    "- when I pair with a friend I finish",
    "- small scope worked: the CLI I shipped in a weekend",
    "",
  ].join("\n"),
  // The writer's own example (PEN-31): Organize must keep all five levels.
  "Notes/Fruit.md": [
    "fruit",
    "",
    "* apple",
    "* banana",
    "* blueberry",
    "   * benefit of eating blueberry",
    "      * Types of benefits",
    "         * Biomechnical functionalities",
    "",
  ].join("\n"),
  "Notes/Sleep log.md": [
    "- Slept eight hours before the exam and remembered far more of the reading.",
    "- After a short nap the second half of the essay finally made sense.",
    "",
  ].join("\n"),
  "Library/How we remember.md": [
    "---",
    "Type: Video",
    "Link: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "---",
    "",
    "<details>",
    "<summary>Transcript</summary>",
    "<p><small>0:05</small> Rereading makes the page familiar, and familiarity feels like knowing.</p>",
    "<p><small>1:10</small> In a 2006 study, students either reread a passage or recalled it. A week later, the recall group remembered far more.</p>",
    "</details>",
    "",
    "- recall beats rereading after a week",
    "- what did the 2006 study compare?",
    "",
  ].join("\n"),
  // The transcript box (YT-04…08): four paragraphs, two sentences each.
  "Speech talk.md": [
    "---",
    "Type: Video",
    "Url: https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    "---",
    "<details>",
    "<summary>Transcript</summary>",
    "<p><small>0:00</small> Welcome to the show about speech. Today we talk about how the brain makes words.</p>",
    "<p><small>1:00</small> Speech is a motor act, like playing the piano. Every syllable is a movement.</p>",
    "<p><small>2:00</small> Children learn languages by listening first. Then they babble and copy sounds.</p>",
    "<p><small>3:00</small> Thanks for listening to this episode. See you next time.</p>",
    "</details>",
    "",
    "My first note",
    "",
  ].join("\n"),
};

// A paper whose PDF is embedded in its body, not named in a `Book` property
// (LIB-07): its Library card opens the PDF in the reader beside the note.
NOTES["Library/A paper.md"] = "---\nType: Paper\nAuthor: Someone\n---\n\n![[a-paper.pdf]]\n";
NOTES["Library/assets/a-paper.pdf"] = onePagePdf("A paper");

// A board with two cards far apart, for docking one after the other (BRD-07,
// PERF-07). A legacy ```board fence: opening it writes the .board.svg.
NOTES["Notes/Dock board.md"] = [
  "# Dock board",
  "",
  "```board",
  '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
  '{"id":"a1","t":"roundRect","x":0,"y":0,"w":180,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Thinking"}}',
  '{"id":"b1","t":"roundRect","x":620,"y":320,"w":180,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Writing"}}',
  "```",
  "",
].join("\n");

// A section ("Plan", f1) drawn around two joined cards after they were made,
// so the cards carry no `fr`, plus a card outside it (BRD-09..11).
NOTES["Notes/Section board.md"] = [
  "# Section board",
  "",
  "```board",
  '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}',
  '{"id":"s1","t":"roundRect","x":60,"y":100,"w":180,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Idea"}}',
  '{"id":"s2","t":"roundRect","x":400,"y":100,"w":180,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Draft"}}',
  '{"id":"l1","t":"arrow","x":240,"y":145,"w":160,"h":0,"pts":[[0,0],[160,0]],"b1":{"el":"s1","fx":0,"gap":0},"b2":{"el":"s2","fx":0,"gap":0}}',
  '{"id":"out","t":"roundRect","x":900,"y":100,"w":180,"h":90,"st":{"s":"blue","f":"blue-soft"},"lb":{"tx":"Elsewhere"}}',
  '{"id":"f1","t":"frame","x":0,"y":0,"w":700,"h":300,"name":"Plan"}',
  "```",
  "",
].join("\n");

// A note as long as a real working draft (about 2,000 lines of headings,
// prose, lists, tasks and links), so the speed journeys (PERF in
// docs/qa/performance.md) time typing and opening on a note that can be slow,
// not only on the short ones above.
NOTES["Notes/Long essay.md"] = Array.from({ length: 120 }, (_, i) =>
  [
    `## Part ${i + 1}`,
    "",
    `Paragraph ${i + 1} keeps going about how a draft grows: one idea leads to the next, and the note gets long before anyone notices. See [[Draft ideas]] for more.`,
    "",
    "- a first point to remember",
    "- a second point, with **bold** and *italic* words",
    "  - a nested detail under it",
    "- [ ] a task still open",
    "- [x] a task already done",
    "",
    "> A quoted line from something read along the way.",
    "",
    "Another paragraph to close the part, with `inline code` and a [link](https://example.com).",
    "",
  ].join("\n"),
).join("\n");

// The pinch journey (PERF-08) opens each of these as a column beside it, so a
// pinch has a strip of real notes to lay out, the long one among them: twenty
// tabs, as many as a writer keeps open in a day, so a pinch's cost shows
// whether it grows with every open tab or only the ones on screen.
const STRIP_NOTES = Array.from({ length: 10 }, (_, n) => `Strip ${n + 1}`);
for (const name of STRIP_NOTES) {
  NOTES[`Notes/${name}.md`] = Array.from({ length: 12 }, (_, i) =>
    [
      `## ${name} section ${i + 1}`,
      "",
      `A working paragraph in ${name}, long enough to wrap across the column a few times as a real draft does, with **bold** words and a [[Welcome]] link.`,
      "",
      "- a point to keep",
      "  - a detail under it",
      "- [ ] an open task",
      "",
    ].join("\n"),
  ).join("\n");
}
NOTES["Notes/Pinch hub.md"] =
  "Open [[Long essay]], [[Outline tour]], [[On writing]] and [[Welcome]] beside this.\n\n" +
  "Then [[Side projects]], [[Fruit]], [[Sleep log]], [[A book]], [[How we remember]], " +
  STRIP_NOTES.map((name) => `[[${name}]]`).join(", ") +
  ".\n";

/** Rebuild the vault and reset the e2e app's state. Called before every
 *  journey spec file (wdio.conf.js beforeSession), so specs never depend on
 *  the order they run in. */
export function seedVault() {
  rmSync(VAULT, { recursive: true, force: true });
  for (const [relative, content] of Object.entries(NOTES)) {
    const path = join(VAULT, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }

  mkdirSync(APP_DATA, { recursive: true });
  writeFileSync(join(APP_DATA, "recent_workspaces.json"), JSON.stringify([VAULT], null, 2));
  // Open tabs, global settings (`config`, e.g. calendar-visible) and
  // preferences (e.g. a folded transcript box) left by an earlier run would
  // make journeys depend on run order.
  for (const file of ["sessions.json", "recent_files.json", "config", "preferences.json"]) {
    rmSync(join(APP_DATA, file), { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVault();
  console.log(`QA vault ready at ${VAULT}`);
}

/** A valid one-page PDF showing `text`, with a correct xref table so pdf.js
 *  opens it without repair. */
export function onePagePdf(text) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
