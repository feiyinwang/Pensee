// Talk notes journeys (TALK in docs/qa/user-journeys.md).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
//
// The e2e app can't answer macOS's microphone prompt, so getUserMedia is
// swapped for a tone from Web Audio: MediaRecorder still records it for real
// and the take goes through the same save and insert path as a voice.
import { ok, strictEqual } from "node:assert/strict";
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

describe("Journeys: talk notes", () => {
  let root;

  before(async () => {
    root = await workspaceRoot();
  });

  it("TALK-01 Record, talk, Stop: the take is saved in Recordings/ and lands in the note as a player", async () => {
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
    await openNote("Talk note");
    await fakeMicrophone(true);
    ok(await pressDock("Record"));
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

  it("TALK-02 With the microphone refused, Record says how to allow it and writes nothing", async () => {
    await openNote("Talk note");
    const before = (await invoke("read_file", { path: `${root}/Notes/Talk note.md` })).value
      .content;
    await fakeMicrophone(false);
    ok(await pressDock("Record"));
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
