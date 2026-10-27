// Talk notes journeys (TALK in docs/qa/user-journeys.md).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
//
// The e2e app can't answer macOS's microphone prompt, so getUserMedia is
// swapped for a tone from Web Audio: MediaRecorder still records it for real
// and the take goes through the same save and insert path as a voice.
import { ok, strictEqual } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileExists, invoke, mouseClick, waitForTitle, workspaceRoot } from "./_helpers.js";

async function openNote(name) {
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await browser.execute((value) => {
    const field = document.querySelector("[cmdk-input]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  const row = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await row.waitForExist({ timeout: 5_000 });
  await row.click();
  await waitForTitle(name);
}

/** A microphone that hums, or one the system refuses. */
const fakeMicrophone = (allow) =>
  browser.execute((allowed) => {
    navigator.mediaDevices.getUserMedia = async () => {
      if (!allowed) throw new DOMException("Permission denied", "NotAllowedError");
      const ctx = new AudioContext();
      // Without a real click WebKit may refuse to resume; the take then records silence, which is enough here.
      ctx.resume().catch(() => {});
      const tone = ctx.createOscillator();
      const out = ctx.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      return out.stream;
    };
  }, allow);

const dockText = () =>
  browser.execute(() => document.querySelector(".talk-dock")?.textContent ?? "");
const pressDock = (label) =>
  browser.execute((text) => {
    const button = [...document.querySelectorAll(".talk-dock button")].find((b) =>
      b.textContent.trim().endsWith(text),
    );
    button?.click();
    return Boolean(button);
  }, label);

/** What the scripted Whisper hears in TALK-08: live passes hand out two lines
 *  at a time, the final pass all of them. Claude is real. */
const SCRIPT = [
  { start: 0, end: 2.5, text: "Okay, a few things today." },
  {
    start: 3,
    end: 8,
    text: "First, what to build next quarter. Voice capture: people want it, a few weeks of work.",
  },
  { start: 9, end: 13, text: "A mobile app: everyone asks, but it's months." },
  { start: 14, end: 18, text: "Fixing Organize is cheap, but hardly anyone uses it." },
  { start: 19, end: 22, text: "Okay, next: where my week actually goes." },
  { start: 23, end: 28, text: "Writing is about twenty hours, QA twelve, support eight." },
  { start: 29, end: 31, text: "And meetings, maybe four." },
];
/** The QA app's Whisper: run.sh points PENSEE_WHISPER_SCRIPT at this file, which
 *  the app reads on every call (whisper.rs). Installed or not, and what it hears. */
const WHISPER_SCRIPT = join(
  homedir(),
  "Library/Application Support/com.pensee.app.e2e/whisper-script.json",
);
const setWhisper = (installed, segments = []) =>
  writeFileSync(WHISPER_SCRIPT, JSON.stringify({ installed, segments }));

/** Presses a dock button once it's there: after a take the pill shows "Saved" a moment before Record. */
const pressDockWhenThere = async (label) => {
  await browser.waitUntil(async () => (await dockText()).includes(label), {
    timeout: 10_000,
    timeoutMsg: `no ${label} in the pill: ${await dockText()}`,
  });
  return pressDock(label);
};

describe("Journeys: talk notes", () => {
  let root;

  before(async () => {
    root = await workspaceRoot();
  });

  it("TALK-01 Record, talk, Stop: the take is saved in Recordings/ and lands in the note as a player", async () => {
    setWhisper(false);
    await openNote("Talk note");
    await fakeMicrophone(true);
    ok(await pressDock("Record"), "no Record button on the note");
    await browser
      .waitUntil(async () => (await dockText()).includes("Stop"), {
        timeout: 5_000,
        timeoutMsg: "recording never started",
      })
      .catch(async (e) => {
        console.log("DEBUG dock", await dockText());
        throw e;
      });
    await browser.pause(2_500);
    ok(await pressDock("Stop"));
    await browser
      .waitUntil(async () => /Saved to Recordings\/|Saved\. To transcribe/.test(await dockText()), {
        timeout: 10_000,
        timeoutMsg: "the take was never saved",
      })
      .catch(async (e) => {
        console.log("DEBUG dock", await dockText());
        throw e;
      });

    const note = await invoke("read_file", { path: `${root}/Notes/Talk note.md` });
    ok(note.ok, note.error);
    const embed = /!\[\[(Recordings\/\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.(m4a|webm))\]\]/.exec(
      note.value.content,
    );
    ok(/## Talk · \d{2}:\d{2}/.test(note.value.content), `no talk heading: ${note.value.content}`);
    ok(embed, `no audio embed: ${note.value.content}`);
    ok(await fileExists(`${root}/${embed[1]}`), `${embed[1]} isn't on disk`);
    await $(".cm-audio-embed .cm-audio-embed-play").waitForExist({ timeout: 5_000 });
    strictEqual(await $(".cm-audio-embed-name").getText(), embed[1].split("/")[1]);
    // The QA app has no Whisper model: answer the offer so the next take starts clean.
    if ((await dockText()).includes("Not now")) ok(await pressDock("Not now"));
  });

  it("TALK-04 With no Whisper model, Stop offers its download; Not now leaves the take without a transcript", async () => {
    setWhisper(false);
    await openNote("Talk note");
    await fakeMicrophone(true);
    ok(await pressDockWhenThere("Record"));
    await browser
      .waitUntil(async () => (await dockText()).includes("Stop"), {
        timeout: 5_000,
        timeoutMsg: "recording never started",
      })
      .catch(async (e) => {
        console.log("DEBUG dock", await dockText());
        throw e;
      });
    await browser.pause(1_500);
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Whisper Small"), {
      timeout: 10_000,
      timeoutMsg: "no offer to download Whisper",
    });
    ok(/488 MB/.test(await dockText()), await dockText());
    ok(await pressDock("Not now"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 5_000,
    });
    const note = (await invoke("read_file", { path: `${root}/Notes/Talk note.md` })).value.content;
    ok(!note.includes("[!transcript]"), note);
  });

  it("TALK-05 A take's transcript shows folded under its player; the chevron opens it", async () => {
    await openNote("Talk transcript");
    const shown = () =>
      browser.execute(() => ({
        head: document.querySelector(".cm-callout-head")?.textContent ?? null,
        expanded:
          document.querySelector(".cm-callout-chevron")?.getAttribute("aria-expanded") ?? null,
        lines: [...document.querySelectorAll(".cm-callout-line")].map((l) => l.textContent),
        player: !!document.querySelector(".cm-audio-embed .cm-audio-embed-play"),
      }));
    await browser.waitUntil(async () => (await shown()).head !== null, {
      timeout: 5_000,
      timeoutMsg: "no callout header",
    });
    let s = await shown();
    ok(s.player, "no player above the transcript");
    ok(/Transcript · 2 lines · On this Mac · Whisper Small/.test(s.head), s.head);
    strictEqual(s.expanded, "false");
    strictEqual(s.lines.length, 0, `folded, yet lines show: ${s.lines}`);
    await browser.execute(() => document.querySelector(".cm-callout-chevron").click());
    await browser.waitUntil(async () => (await shown()).lines.length === 2, {
      timeout: 3_000,
      timeoutMsg: "the chevron didn't open it",
    });
    s = await shown();
    strictEqual(s.expanded, "true");
    ok(s.lines[1].includes("First, what to build next quarter."), s.lines[1]);
  });

  it("TALK-06 A time in the transcript plays the take from that moment", async () => {
    await openNote("Talk transcript");
    await $(".cm-callout-chevron").waitForExist({ timeout: 5_000 });
    if ((await $(".cm-callout-chevron").getAttribute("aria-expanded")) === "false") {
      await browser.execute(() => document.querySelector(".cm-callout-chevron").click());
    }
    await browser.execute(() => {
      const audio = document.querySelector(".cm-audio-embed audio");
      audio.muted = true;
    });
    const link = await $("//*[contains(@class,'cm-callout-line')]//*[contains(., '0:02')][not(*)]");
    await link.waitForExist({ timeout: 3_000 });
    await mouseClick(link);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const audio = document.querySelector(".cm-audio-embed audio");
          return !!audio && !audio.paused && audio.currentTime >= 1.9;
        }),
      { timeout: 5_000, timeoutMsg: "the take didn't play from 0:02" },
    );
  });

  it("TALK-08 While you talk, topics show as tabs with their diagram; Stop writes them under the transcript", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(true, SCRIPT);
    ok(await pressDockWhenThere("Record"));
    const box = () =>
      browser.execute(() => {
        const el = document.querySelector(".talk-box");
        if (!el) return null;
        return {
          tabs: [...el.querySelectorAll(".talk-box-tabs button")]
            .map((b) => b.textContent.trim())
            .filter(Boolean),
          diagram: !!el.querySelector(".talk-diagram svg, .talk-diagram.is-chart *"),
          card: el.querySelector(".talk-box-card")?.textContent ?? null,
          status: el.querySelector(".talk-box-status")?.textContent ?? "",
          note: el.querySelector(".talk-box-empty, .talk-box-error")?.textContent ?? null,
        };
      });
    await browser
      .waitUntil(async () => (await box())?.diagram, {
        timeout: 60_000,
        timeoutMsg: "no topic diagram while talking",
      })
      .catch(async (e) => {
        console.log("DEBUG box", JSON.stringify(await box()));
        throw e;
      });
    ok((await box()).tabs.length >= 1, JSON.stringify(await box()));
    await browser.pause(10_000);
    console.log("DEBUG box later", JSON.stringify(await box()));
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 60_000,
      timeoutMsg: "never finished after Stop",
    });
    // The editor saves a moment after the last change.
    const read = async () =>
      (await invoke("read_file", { path: `${root}/Notes/Talk note.md` })).value.content;
    await browser
      .waitUntil(async () => (await read()).includes("```mermaid"), { timeout: 5_000 })
      .catch(() => {});
    const note = await read();
    ok(/> \[!transcript\]- Transcript · 7 lines · On this Mac · Whisper Small/.test(note), note);
    ok(
      /### .+\n\n```mermaid\n/.test(note),
      `no topic section with a diagram: ${JSON.stringify(note)}`,
    );
  });

  it("TALK-10 Turning to a new topic shows the New topic? card; Accept new tab opens its tab", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true);
    // Ends on the turn, so the card stays up until it's answered.
    setWhisper(true, [SCRIPT[1], SCRIPT[2], SCRIPT[4]]);
    ok(await pressDockWhenThere("Record"));
    const card = () =>
      browser.execute(() => document.querySelector(".talk-box-card")?.textContent ?? null);
    const tabs = () =>
      browser.execute(
        () =>
          [
            ...document.querySelectorAll(
              ".talk-box-tabs [data-value], .talk-box-tabs button[aria-pressed]",
            ),
          ].length,
      );
    await browser
      .waitUntil(async () => (await card())?.includes("New topic?"), {
        timeout: 60_000,
        timeoutMsg: "no New topic? card after “Okay, next”",
      })
      .catch(async (e) => {
        console.log(
          "DEBUG box",
          await browser.execute(() => document.querySelector(".talk-box")?.textContent),
        );
        throw e;
      });
    const before = await tabs();
    // The card quotes the words of the turn (Claude may quote "next" or "Okay, next").
    ok(/“[^”]*next[^”]*”/i.test(await card()), await card());
    await browser.execute(() => {
      const accept = [...document.querySelectorAll(".talk-box-card button")].find((b) =>
        b.textContent.trim().startsWith("Accept"),
      );
      accept?.click();
    });
    await browser.waitUntil(async () => (await tabs()) === before + 1, {
      timeout: 5_000,
      timeoutMsg: "Accept didn't open a tab",
    });
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 60_000,
    });
  });

  it("TALK-09 Recording before Whisper is downloaded: the box offers it, and the take still records", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(false);
    ok(await pressDockWhenThere("Record"));
    await browser.waitUntil(
      async () =>
        browser
          .execute(() => document.querySelector(".talk-box")?.textContent ?? "")
          .then((t) => t.includes("Download Whisper Small")),
      { timeout: 10_000, timeoutMsg: "the box didn't offer Whisper" },
    );
    ok((await dockText()).includes("Stop"), "recording stopped");
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => /Whisper Small/.test(await dockText()), {
      timeout: 10_000,
    });
    ok(await pressDock("Not now"));
  });

  it("TALK-02 With the microphone refused, Record says how to allow it and writes nothing", async () => {
    await openNote("Talk note");
    // An earlier take's save may still be landing: wait until the file holds still.
    const read = async () =>
      (await invoke("read_file", { path: `${root}/Notes/Talk note.md` })).value.content;
    let before = await read();
    for (let i = 0; i < 10; i++) {
      await browser.pause(500);
      const now = await read();
      if (now === before) break;
      before = now;
    }
    await fakeMicrophone(false);
    ok(await pressDockWhenThere("Record"));
    await browser.waitUntil(async () => (await dockText()).includes("Privacy & Security"), {
      timeout: 5_000,
      timeoutMsg: "no message about the microphone",
    });
    ok(await pressDock("OK"));
    strictEqual(
      (await invoke("read_file", { path: `${root}/Notes/Talk note.md` })).value.content,
      before,
    );
  });
});
