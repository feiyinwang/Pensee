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
  "Inspirations/Quote.md": "---\nType: Inspiration\n---\n\nLess, but better.\n",
};

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
  // Open tabs and global settings (`config`, e.g. calendar-visible) left by an
  // earlier run would make journeys depend on run order.
  for (const file of ["sessions.json", "recent_files.json", "config"]) {
    rmSync(join(APP_DATA, file), { force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVault();
  console.log(`QA vault ready at ${VAULT}`);
}
