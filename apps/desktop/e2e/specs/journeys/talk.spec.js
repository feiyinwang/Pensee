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
import {
  fileExists,
  invoke,
  mouseClick,
  pressCmd,
  typeInEditor,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

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

/** A microphone that hums, one that sends only silence (as macOS does for an app it
 *  hasn't allowed), or one the system refuses. */
const fakeMicrophone = async (allow, { silent = false } = {}) => {
  const installed = await browser.execute(
    (allowed, mute) => {
      const fake = async () => {
        if (!allowed) throw new DOMException("Permission denied", "NotAllowedError");
        const ctx = new AudioContext();
        // Without a real click WebKit may refuse to resume; the take then records silence, which is enough here.
        ctx.resume().catch(() => {});
        const tone = ctx.createOscillator();
        const out = ctx.createMediaStreamDestination();
        // Silent: a live stream of exact zeros, as macOS sends an app it hasn't allowed.
        const level = ctx.createGain();
        level.gain.value = mute ? 0 : 1;
        tone.connect(level).connect(out);
        tone.start();
        // The recorder stops the track at Stop: close the hum with it, as a real
        // microphone goes quiet, so takes don't pile up open audio contexts. By
        // id on the prototype: getTracks() may hand back a new wrapper each time.
        // window.__talkMic holds the open ones, for the journeys that check it goes off.
        const [track] = out.stream.getAudioTracks();
        window.__talkMic ??= new Map();
        window.__talkMic.set(track.id, () => {
          tone.stop();
          void ctx.close();
        });
        if (!MediaStreamTrack.prototype.__talkStop) {
          const stop = MediaStreamTrack.prototype.stop;
          MediaStreamTrack.prototype.__talkStop = stop;
          MediaStreamTrack.prototype.stop = function () {
            stop.call(this);
            const close = window.__talkMic?.get(this.id);
            window.__talkMic?.delete(this.id);
            close?.();
          };
        }
        return out.stream;
      };
      // On the prototype and the instance: a plain assignment doesn't always stick.
      Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
        value: fake,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: fake,
        configurable: true,
        writable: true,
      });
      return navigator.mediaDevices.getUserMedia === fake;
    },
    allow,
    silent,
  );
  ok(installed, "the fake microphone didn't install");
};

const dockText = () =>
  browser.execute(() => document.querySelector(".talk-dock")?.textContent ?? "");
const pressDock = (label) =>
  browser.execute((text) => {
    const button = [...document.querySelectorAll(".talk-dock button")].find((b) =>
      b.textContent.trim().endsWith(text),
    );
    if (button) button?.click();
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
/** The QA app's ElevenLabs (PENSEE_ELEVENLABS_SCRIPT, elevenlabs.rs): the words
 *  Scribe sends back. The key `good-key` passes Check key; it stays in memory. */
const ELEVENLABS_SCRIPT = join(
  homedir(),
  "Library/Application Support/com.pensee.app.e2e/elevenlabs-script.json",
);
const setScribe = (words) => writeFileSync(ELEVENLABS_SCRIPT, JSON.stringify({ words }));

/** Starts a new talk: **Record**, or **New talk** on a note whose last take offers Continue. */
const pressRecord = async () => {
  const has = () =>
    browser.execute(() =>
      [...document.querySelectorAll(".talk-dock button")].some((b) =>
        /(Record|New talk)$/.test(b.textContent.trim()),
      ),
    );
  await browser.waitUntil(has, {
    timeout: 10_000,
    timeoutMsg: `no Record or New talk in the pill: ${await dockText()}`,
  });
  return (await pressDock("New talk")) || pressDock("Record");
};

/** Records a take of a few seconds (`label` "Continue", or a new talk); returns once the pill shows `after`. */
const recordTake = async (label, after) => {
  ok(label === "Continue" ? await pressDockWhenThere(label) : await pressRecord());
  await browser.waitUntil(async () => (await dockText()).includes("Stop"), {
    timeout: 5_000,
    timeoutMsg: `recording never started: ${await dockText()}`,
  });
  await browser.pause(1_500);
  ok(await pressDock("Stop"));
  await browser.waitUntil(async () => (await dockText()).includes(after), {
    timeout: 60_000,
    timeoutMsg: `no ${after} after Stop: ${await dockText()}`,
  });
};

/** The note's text once the editor's debounced save has landed. */
const readSettled = async (path) => {
  const read = async () => (await invoke("read_file", { path })).value.content;
  let before = await read();
  for (let i = 0; i < 10; i++) {
    await browser.pause(500);
    const now = await read();
    if (now === before) break;
    before = now;
  }
  return before;
};

const count = (text, part) => text.split(part).length - 1;
/** Talk note as it is on disk (a note that isn't open is written there directly). */
const noteText = async () =>
  (await invoke("read_file", { path: `${await workspaceRoot()}/Notes/Talk note.md` })).value
    .content;

async function openSettings() {
  await pressCmd("p");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue("Settings");
  const item = await $('//*[@cmdk-item][contains(., "Settings")]');
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await $("//h1[normalize-space(.)='Preferences']").waitForExist({ timeout: 5_000 });
}

/** Picks an option in the select of the setting labelled `label`. */
const chooseSetting = (label, value) =>
  browser.execute(
    (label, value) => {
      const title = [...document.querySelectorAll("[data-settings-panel] *")].find(
        (el) => el.childElementCount === 0 && el.textContent.trim() === label,
      );
      let row = title;
      while (row && !row.querySelector("select")) row = row.parentElement;
      const select = row?.querySelector("select");
      if (!select) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    label,
    value,
  );

const keyRow = () =>
  browser.execute(() => {
    const row = document.querySelector("[data-settings-panel] [data-elevenlabs-key]");
    if (!row) return null;
    return {
      state: row.getAttribute("data-elevenlabs-key"),
      text: row.textContent,
      alert: row.querySelector("[role=alert]")?.textContent ?? null,
    };
  });
const pressKeyRow = (label) =>
  browser.execute((label) => {
    const button = [
      ...document.querySelectorAll("[data-settings-panel] [data-elevenlabs-key] button"),
    ].find((b) => b.textContent.trim() === label);
    button?.click();
    return Boolean(button);
  }, label);
const typeKey = (key) =>
  browser.execute((key) => {
    const field = document.querySelector("[data-elevenlabs-key] input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, key);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, key);

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

  it("TALK-24 Record at rest is a dot that steps aside while you scroll or type, and comes back", async () => {
    await openNote("Long essay");
    const dot = () =>
      browser.execute(() => {
        const button = document.querySelector(".talk-dock .talk-dock-dot-button");
        if (!button) return null;
        const { width, height } = button.getBoundingClientRect();
        return {
          width,
          height,
          name: button.textContent.trim(),
          tucked: button.hasAttribute("data-tucked"),
        };
      });
    const rest = await dot();
    ok(rest, `no Record dot on the note: ${await dockText()}`);
    ok(rest.width <= 40 && rest.height <= 40, `the dot is ${rest.width}×${rest.height}`);
    strictEqual(rest.name, "Record");
    strictEqual(rest.tucked, false);

    // A real scroll of the note's scroller, not a synthetic event.
    await browser.execute(() => {
      const pane = document.querySelector(".talk-dock").closest("[data-pane]");
      const scroller = [...pane.querySelectorAll("*")].find(
        (el) =>
          el.scrollHeight > el.clientHeight + 100 && getComputedStyle(el).overflowY === "auto",
      );
      scroller.scrollTop += 400;
    });
    await browser.waitUntil(async () => (await dot())?.tucked === true, {
      timeout: 5_000,
      timeoutMsg: "scrolling the note didn't tuck Record",
    });
    await browser.waitUntil(async () => (await dot())?.tucked === false, {
      timeout: 5_000,
      timeoutMsg: "Record didn't come back after the scroll stopped",
    });

    // Typing in the note tucks it too; the note ends as it was.
    await typeInEditor("x");
    await browser.waitUntil(async () => (await dot())?.tucked === true, {
      timeout: 5_000,
      timeoutMsg: "typing in the note didn't tuck Record",
    });
    await browser.execute(() => document.execCommand("delete"));
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
    ok(await pressRecord());
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

  it("TALK-08 While you talk, topics show as tabs with their diagram; Stop writes them under the transcript", async function () {
    // Real Claude answers here, sometimes slowly: longer than the 60s default,
    // so a slow answer fails this journey's own wait (and stops its take).
    this.timeout(240_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(true, SCRIPT);
    ok(await pressRecord());
    const box = () =>
      browser.execute(() => {
        const el = document.querySelector(".talk-box");
        if (!el) return null;
        return {
          tabs: [...el.querySelectorAll(".talk-box-tabs button")]
            .map((b) => b.textContent.trim())
            .filter(Boolean),
          diagram: !!el.querySelector(
            ".talk-diagram svg, .talk-diagram.is-chart *, .talk-board svg",
          ),
          card: el.querySelector(".talk-box-card")?.textContent ?? null,
          status: el.querySelector(".talk-box-status")?.textContent ?? "",
          note: el.querySelector(".talk-box-empty, .talk-box-error")?.textContent ?? null,
        };
      });
    await browser
      .waitUntil(async () => (await box())?.diagram, {
        timeout: 100_000,
        timeoutMsg: "no topic diagram while talking",
      })
      .catch(async (e) => {
        console.log("DEBUG box", JSON.stringify(await box()));
        // Don't leave the take running into the next journey.
        await pressDock("Stop");
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
    // A chart stays Mermaid; a mind map or flowchart is a board beside the note.
    ok(
      /### .+\n\n(?:[^\n!#`-][^\n]*\n\n)?(```mermaid\n|!\[[^\]]*\]\([^)]*\.board\.svg>?\))/.test(
        note,
      ),
      `no topic section with a diagram: ${JSON.stringify(note)}`,
    );
  });

  it("TALK-10 Turning to a new topic shows the New topic? card; Accept new tab opens its tab", async function () {
    // Real Claude answers here, sometimes slowly: longer than the 60s default,
    // so a slow answer fails this journey's own wait (and stops its take).
    this.timeout(240_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    // Ends on the turn, so the card stays up until it's answered.
    setWhisper(true, [SCRIPT[1], SCRIPT[2], SCRIPT[4]]);
    ok(await pressRecord());
    const card = () =>
      browser.execute(() => document.querySelector(".talk-box-card")?.textContent ?? null);
    const tabs = () =>
      browser.execute(() => [...document.querySelectorAll(".talk-box-tab")].length);
    await browser
      // Claude may offer an earlier line first; the card for the turn replaces it.
      .waitUntil(async () => /New topic\?.*“[^”]*next[^”]*”/i.test((await card()) ?? ""), {
        timeout: 100_000,
        timeoutMsg: "no New topic? card after “Okay, next”",
      })
      .catch(async (e) => {
        console.log(
          "DEBUG box",
          await browser.execute(() => document.querySelector(".talk-box")?.textContent),
        );
        // Don't leave the take running into the next journey.
        await pressDock("Stop");
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
    ok(await pressRecord());
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

  it("TALK-11 Continue adds a take to the same talk: its player goes under the first take's transcript", async () => {
    const path = `${root}/Notes/Talk note.md`;
    await openNote("Talk note");
    await fakeMicrophone(true);
    // Small talk only, so the topics don't depend on what Claude makes of it.
    setWhisper(true, [SCRIPT[0]]);
    const before = await readSettled(path);
    await recordTake("Record", "Continue");
    await recordTake("Continue", "Continue");
    const note = await readSettled(path);
    strictEqual(count(note, "## Talk · "), count(before, "## Talk · ") + 1, note);
    strictEqual(count(note, "> [!transcript]-"), count(before, "> [!transcript]-") + 2, note);
    const added = note.slice(note.lastIndexOf("## Talk · "));
    const embeds = [...added.matchAll(/!\[\[(Recordings\/[^\]]+)\]\]/g)].map((m) => m.index);
    strictEqual(embeds.length, 2, added);
    const firstTranscript = added.indexOf("> [!transcript]-");
    ok(
      firstTranscript > embeds[0] && embeds[1] > firstTranscript,
      `the second take isn't under the first one's transcript: ${JSON.stringify(added)}`,
    );
  });

  it("TALK-12 The Recordings space lists every take; one shows its transcript and opens its note", async () => {
    await $("//button[normalize-space(.)='Recordings']").click();
    await $(".recordings-page").waitForExist({ timeout: 5_000 });
    const row = await $(
      "//button[contains(@class,'recordings-row')][contains(., 'Talk transcript')]",
    );
    await row.waitForExist({ timeout: 5_000 });
    await row.click();
    await browser.waitUntil(async () => (await $$(".recordings-transcript li")).length === 2, {
      timeout: 5_000,
      timeoutMsg: "the take's transcript didn't show",
    });
    ok(
      /On this Mac · Whisper Small/.test(await $(".recordings-h").getText()),
      await $(".recordings-h").getText(),
    );
    ok(await $(".recordings-detail .cm-audio-embed-play").isExisting(), "no player for the take");
    await $(".recordings-link").click();
    await waitForTitle("Talk transcript");
  });

  it("TALK-13 With ElevenLabs Scribe chosen and a key saved, a take's transcript comes from ElevenLabs", async () => {
    await openSettings();
    ok(await chooseSetting("Transcribe With", "elevenlabs"), "no Transcribe With setting");
    try {
      await browser.waitUntil(async () => (await keyRow())?.state === "none", {
        timeout: 5_000,
        timeoutMsg: "no ElevenLabs key field",
      });
      await typeKey("bad-key");
      ok(await pressKeyRow("Save"));
      await browser.waitUntil(async () => (await keyRow())?.state === "saved", { timeout: 5_000 });
      ok(await pressKeyRow("Check key"));
      await browser.waitUntil(async () => /refused the key/.test((await keyRow())?.alert ?? ""), {
        timeout: 5_000,
        timeoutMsg: "a bad key wasn't refused",
      });
      ok(await pressKeyRow("Remove"));
      await browser.waitUntil(async () => (await keyRow())?.state === "none", { timeout: 5_000 });
      await typeKey("good-key");
      ok(await pressKeyRow("Save"));
      await browser.waitUntil(async () => (await keyRow())?.state === "saved", { timeout: 5_000 });
      ok(await pressKeyRow("Check key"));
      await browser.waitUntil(async () => /accepted the key/.test((await keyRow())?.text ?? ""), {
        timeout: 5_000,
        timeoutMsg: "the good key wasn't accepted",
      });
      await browser.keys("Escape");

      const path = `${root}/Notes/Talk note.md`;
      await openNote("Talk note");
      await fakeMicrophone(true);
      setWhisper(false);
      setScribe([
        { text: "Scribe", start: 0.1, end: 0.5, type: "word" },
        { text: " ", start: 0.5, end: 0.6, type: "spacing" },
        { text: "heard", start: 0.6, end: 0.9, type: "word" },
        { text: " ", start: 0.9, end: 1.0, type: "spacing" },
        { text: "this.", start: 1.0, end: 1.4, type: "word" },
      ]);
      // A new talk, not a Continue of TALK-11's.
      await recordTake("Record", "Saved to Recordings/");
      const note = await readSettled(path);
      ok(/> \[!transcript\]- Transcript · 1 line · ElevenLabs Scribe/.test(note), note);
      ok(note.includes("Scribe heard this."), note);
    } finally {
      await openSettings();
      await chooseSetting("Transcribe With", "whisper");
      await browser.keys("Escape");
    }
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
    ok(await pressRecord());
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

  it("TALK-17 Closing the note while recording stops the take, saves it and turns the microphone off", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(false);
    const before = (await invoke("list_recordings")).value.length;
    const embeds = count(await noteText(), "![[Recordings/");
    ok(await pressRecord());
    await browser.waitUntil(async () => (await dockText()).includes("Stop"), {
      timeout: 5_000,
      timeoutMsg: `recording never started: ${await dockText()}`,
    });
    await browser.pause(1_500);
    await pressCmd("w");
    await browser.waitUntil(() => browser.execute(() => (window.__talkMic?.size ?? 0) === 0), {
      timeout: 10_000,
      timeoutMsg: "the microphone stayed on after the note closed",
    });
    await browser.waitUntil(
      async () => (await invoke("list_recordings")).value.length === before + 1,
      { timeout: 10_000, timeoutMsg: "the take wasn't saved to Recordings/" },
    );
    // The talk still went into the note, in its file.
    await browser.waitUntil(async () => count(await noteText(), "![[Recordings/") === embeds + 1, {
      timeout: 10_000,
      timeoutMsg: "the closed note didn't get the take",
    });
    // Its transcript offer follows to the next note you open.
    await openNote("Welcome");
    await browser.waitUntil(async () => /Whisper Small/.test(await dockText()), {
      timeout: 10_000,
      timeoutMsg: `no transcript offer after the note closed: ${await dockText()}`,
    });
    ok(await pressDock("Not now"));
  });

  it("TALK-18 Going to another note while recording: the pill follows, names the note, and Stop ends the take", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(false);
    const embeds = count(await noteText(), "![[Recordings/");
    ok(await pressRecord());
    await browser.waitUntil(async () => (await dockText()).includes("Stop"), {
      timeout: 5_000,
      timeoutMsg: `recording never started: ${await dockText()}`,
    });
    await openNote("Welcome");
    const pill = () =>
      browser.execute(() =>
        [...document.querySelectorAll(".tab-column:not([data-hidden]) .talk-dock")]
          .map((d) => d.textContent)
          .join(" | "),
      );
    await browser
      .waitUntil(async () => /in Talk note.*Stop/.test(await pill()), {
        timeout: 5_000,
        timeoutMsg: `no recording pill on Welcome: ${await pill()}`,
      })
      .catch(async (e) => {
        // Don't leave the take running into the next journey.
        await pressDock("Stop");
        throw e;
      });
    ok(await browser.execute(() => window.__talkMic?.size === 1), "the take stopped on leaving");
    ok(await pressDock("Stop"));
    await browser.waitUntil(() => browser.execute(() => (window.__talkMic?.size ?? 0) === 0), {
      timeout: 10_000,
      timeoutMsg: "the microphone stayed on after Stop",
    });
    // The talk went into Talk note's file, though Welcome is in front.
    await browser.waitUntil(async () => count(await noteText(), "![[Recordings/") === embeds + 1, {
      timeout: 10_000,
      timeoutMsg: "the note you'd left didn't get the take",
    });
    await browser.waitUntil(async () => /Whisper Small/.test(await pill()), { timeout: 10_000 });
    ok(await pressDock("Not now"));
  });

  it("TALK-19 A microphone that sends only silence: an error card above the pill says it hears nothing and where to allow it", async () => {
    await openNote("Talk note");
    await fakeMicrophone(true, { silent: true });
    setWhisper(false);
    ok(await pressRecord());
    await browser.waitUntil(async () => /No sound from the microphone/.test(await dockText()), {
      timeout: 10_000,
      timeoutMsg: `no word about the silent microphone: ${await dockText()}`,
    });
    ok((await dockText()).includes("Privacy & Security → Microphone"), await dockText());
    // Its own error card above the pill, not text inside it.
    const place = await browser.execute(() => {
      const alert = document.querySelector(".talk-dock-alert[role='alert']");
      const pill = document.querySelector(".talk-dock-pill");
      if (!alert || !pill) return null;
      return {
        above: alert.getBoundingClientRect().bottom <= pill.getBoundingClientRect().top,
        inPill: pill.textContent.includes("No sound"),
      };
    });
    ok(
      place?.above && !place.inPill,
      `the warning isn't a card above the pill: ${JSON.stringify(place)}`,
    );
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => /Whisper Small/.test(await dockText()), {
      timeout: 10_000,
    });
    ok(await pressDock("Not now"));
  });

  it("TALK-20 A brainstorm is drawn as a mind map board; a click opens it in the board editor; Stop puts a summary and the board in the note, its nodes without play badges", async function () {
    // Real Claude draws the plan: longer than the 60s default.
    this.timeout(240_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(true, [
      { start: 0, end: 4, text: "Let me brainstorm where new users could come from." },
      {
        start: 4,
        end: 9,
        text: "Maybe Reddit, the Obsidian subreddit, and Hacker News for a launch post.",
      },
      { start: 9, end: 14, text: "Or YouTube shorts showing the talk feature, and TikTok." },
      { start: 14, end: 19, text: "Writers on Substack too, and a weekly newsletter of my own." },
    ]);
    ok(await pressRecord());
    const stopOnFail = async (e) => {
      // Don't leave the take running into the next journey.
      await browser.keys("Escape");
      await pressDock("Stop");
      throw e;
    };
    await browser
      .waitUntil(() => browser.execute(() => !!document.querySelector(".talk-board svg")), {
        timeout: 100_000,
        timeoutMsg: "the brainstorm wasn't drawn as a board",
      })
      .catch(stopOnFail);
    // A brainstorm is a mind map: arrange it right in the box.
    const arrange = (go) =>
      browser.execute((drop) => {
        const nodes = [
          ...document.querySelectorAll('.talk-board-surface [data-type="mind"][data-parent]'),
        ];
        const parentOf = new Map(nodes.map((n) => [n.getAttribute("data-el"), n.dataset.parent]));
        const under = (id, of) => {
          for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (p === of) return true;
          return false;
        };
        // A topic, and somewhere it can go: not into its own branch, not where it already is.
        for (const a of nodes)
          for (const b of nodes) {
            const ia = a.getAttribute("data-el");
            const ib = b.getAttribute("data-el");
            if (ia === ib || under(ib, ia) || a.dataset.parent === ib) continue;
            if (!drop) return { id: ia, to: ib };
            const at = (el) => {
              const r = el.querySelector("rect").getBoundingClientRect();
              return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            };
            const opts = {
              bubbles: true,
              cancelable: true,
              pointerId: 7,
              isPrimary: true,
              button: 0,
            };
            a.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...at(a) }));
            const button = document.querySelector(".talk-board");
            button.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...at(b) }));
            button.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...at(b) }));
            button.dispatchEvent(new MouseEvent("click", { bubbles: true, ...at(b) }));
            return { id: ia, to: ib };
          }
        return null;
      }, go);
    // Room to arrange appears as the talk goes on.
    await browser
      .waitUntil(async () => Boolean(await arrange(false)), {
        timeout: 60_000,
        timeoutMsg: "the brainstorm wasn't drawn as a mind map with a topic to move",
      })
      .catch(stopOnFail);
    const moved = await arrange(true);
    await browser
      .waitUntil(
        () =>
          browser.execute(
            ({ id, to }) =>
              document.querySelector(`.talk-board-surface [data-el="${id}"]`)?.dataset.parent ===
              to,
            moved,
          ),
        { timeout: 10_000, timeoutMsg: "dragging a topic onto another didn't move it there" },
      )
      .catch(stopOnFail);
    await browser.execute(() => document.querySelector(".talk-board").click());
    await browser
      .waitUntil(
        () =>
          browser.execute(() => !!document.querySelector(".wr-board-fullscreen svg.wr-board-svg")),
        { timeout: 10_000, timeoutMsg: "the board editor didn't open" },
      )
      .catch(stopOnFail);
    ok(
      /waits until you close it/.test(
        await browser.execute(() => document.querySelector(".talk-board-hint")?.textContent ?? ""),
      ),
    );
    await browser.execute(() => document.querySelector(".wr-board-close")?.click());
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            !/waits until you close it/.test(
              document.querySelector(".talk-board-hint")?.textContent ?? "",
            ),
        ),
      { timeout: 10_000, timeoutMsg: "the board editor didn't close" },
    );
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 100_000,
    });
    const note = await readSettled(`${root}/Notes/Talk note.md`);
    const embed = /!\[[^\]]*\]\(<?([^)>]*\.board\.svg)>?\)/.exec(note);
    ok(embed, `no board in the note: ${JSON.stringify(note)}`);
    const file = decodeURI(embed[1]);
    const absolute = file.startsWith("/") ? file : `${root}/Notes/${file}`;
    ok(await fileExists(absolute), `${file} isn't on disk`);
    // A short summary above the board, and no list of lines under it.
    const section = note.slice(note.lastIndexOf("\n### ", embed.index));
    ok(
      /^\n### [^\n]+\n\n[^\n!#-][^\n]*\n\n!\[/.test(section),
      `no summary above the board: ${JSON.stringify(section)}`,
    );
    ok(
      !/^### [^\n]+\n(?:(?!\n### )[\s\S])*\n- .*\[\d+:\d\d\]/.test(
        section.slice(1).split("\n### Said in passing")[0],
      ),
      `the lines are still listed: ${JSON.stringify(section)}`,
    );
    // Its nodes carry no play badges: the take is above, in the note.
    ok(
      !/Recordings\/[^"#]+#t=/.test((await invoke("read_file", { path: absolute })).value.content),
      "the board's nodes still hold clips",
    );
  });

  it("TALK-25 A plan told step by step is drawn as rounded cards left to right in that order; the as a mind map button redraws it", async function () {
    // Real Claude draws it, twice: longer than the 60s default.
    this.timeout(240_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(true, [
      { start: 0, end: 4, text: "Here's my plan for a business idea." },
      { start: 4, end: 9, text: "First I scan keywords from what I read." },
      { start: 9, end: 14, text: "Then I check the pull of each idea with Rob's skills." },
      { start: 14, end: 19, text: "Once that's done, I test it with Facebook ads and Google ads." },
    ]);
    ok(await pressRecord());
    const stopOnFail = async (e) => {
      await pressDock("Stop");
      throw e;
    };
    // Each step's card, where it sits along the flow.
    const steps = () =>
      browser.execute(() => {
        const surface = document.querySelector(".talk-board-surface");
        if (!surface || surface.querySelector('[data-type="mind"]')) return null;
        const cards = [...surface.querySelectorAll("g[data-el]")].filter(
          (g) => !/^(arrow|line)$/.test(g.dataset.type) && g.textContent.trim(),
        );
        const at = (word) => {
          const card = cards.find((g) => g.textContent.toLowerCase().includes(word));
          if (!card) return null;
          const r = card.getBoundingClientRect();
          return { x: r.left, y: r.top };
        };
        const arrows = surface.querySelectorAll('[data-type="arrow"]').length;
        const shapes = [...new Set(cards.map((g) => g.dataset.type))];
        return { keywords: at("keyword"), rob: at("rob"), ads: at("ads"), arrows, shapes };
      });
    await browser
      .waitUntil(
        async () => {
          const s = await steps();
          return s && s.keywords && s.rob && s.ads && s.arrows >= 2;
        },
        { timeout: 120_000, timeoutMsg: "the plan wasn't drawn as linked steps" },
      )
      .catch(stopOnFail);
    const { keywords, rob, ads, shapes } = await steps();
    // Left to right, as the board's rounded cards.
    const along = (a, b) => b.x > a.x + 1;
    ok(
      along(keywords, rob) && along(rob, ads),
      `steps out of order: ${JSON.stringify({ keywords, rob, ads })}`,
    );
    ok(shapes.join() === "roundRect", `steps aren't the board's rounded cards: ${shapes}`);
    const pressed = () =>
      browser.execute(
        () => document.querySelector('.talk-box-picture[aria-pressed="true"]')?.textContent ?? "",
      );
    ok((await pressed()) === "as steps", `as steps isn't shown as the picture: ${await pressed()}`);
    // Hovering a picture button previews its picture, with a made-up example.
    await browser.execute(() => {
      const button = [...document.querySelectorAll(".talk-box-picture")].find(
        (b) => b.textContent === "as a matrix",
      );
      const trigger = button.closest(".picture-preview-trigger");
      const r = trigger.getBoundingClientRect();
      for (const dx of [2, 4, 6])
        trigger.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
            clientX: r.left + dx,
            clientY: r.top + r.height / 2,
          }),
        );
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const card = document.querySelector(".picture-preview");
          return (
            !!card?.querySelector(".picture-preview-drawing svg") &&
            card.querySelector(".picture-preview-title")?.textContent === "as a matrix"
          );
        }),
      { timeout: 5_000, timeoutMsg: "hovering as a matrix showed no preview" },
    );
    await browser.execute(() =>
      document
        .querySelector(".picture-preview-trigger")
        ?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, pointerType: "mouse" })),
    );
    await browser.execute(() =>
      [...document.querySelectorAll(".talk-box-picture")]
        .find((b) => b.textContent === "as a mind map")
        .click(),
    );
    ok((await pressed()) === "as a mind map");
    await browser
      .waitUntil(
        () =>
          browser.execute(() => !!document.querySelector('.talk-board-surface [data-type="mind"]')),
        { timeout: 100_000, timeoutMsg: "as a mind map didn't redraw the topic" },
      )
      .catch(stopOnFail);
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector(".talk-box-picture[data-pending]")),
      { timeout: 10_000, timeoutMsg: "the button kept waiting after the redraw" },
    );
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 100_000,
    });
  });

  it("TALK-26 The next topic button opens a tab now; what you say next goes in it and titles it, with no card", async function () {
    this.timeout(240_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    const plan = [
      { start: 0, end: 4, text: "Let me think about the launch week." },
      { start: 4, end: 9, text: "Monday the post goes out, Tuesday I answer comments." },
    ];
    setWhisper(true, plan);
    ok(await pressRecord());
    const stopOnFail = async (e) => {
      await pressDock("Stop");
      throw e;
    };
    const tabs = () =>
      browser.execute(() =>
        [...document.querySelectorAll(".talk-box-tab")].map((t) => ({
          text: t.textContent,
          selected: t.getAttribute("aria-selected") === "true",
        })),
      );
    await browser
      .waitUntil(async () => (await tabs()).length === 1, {
        timeout: 80_000,
        timeoutMsg: "the first topic never got a tab",
      })
      .catch(stopOnFail);
    await browser.execute(() => document.querySelector(".talk-box-next").click());
    const opened = await tabs();
    ok(
      opened.length === 2 && opened[1].selected && opened[1].text.startsWith("New topic"),
      `next topic didn't open a tab: ${JSON.stringify(opened)}`,
    );
    ok(
      await browser.execute(() => document.querySelector(".talk-box-next").disabled),
      "next topic should wait for words in the empty tab",
    );
    setWhisper(true, [
      ...plan,
      { start: 9, end: 14, text: "We need to hire a designer and a support person." },
      { start: 14, end: 19, text: "The designer comes first, part-time." },
    ]);
    await browser
      .waitUntil(
        async () => {
          const t = await tabs();
          return t.length === 2 && t[1].selected && !t[1].text.startsWith("New topic");
        },
        { timeout: 80_000, timeoutMsg: "what was said after next topic didn't title its tab" },
      )
      .catch(stopOnFail);
    ok(
      await browser.execute(() => !document.querySelector(".talk-box-card")),
      "the button's topic was offered as a New topic? card",
    );
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 100_000,
    });
  });

  it("TALK-27 Every picture is a board: as a matrix gives tinted sections with the ideas as cards; as a chart gives a chart card", async function () {
    // Real Claude draws it three times: longer than the 60s default.
    this.timeout(300_000);
    await openNote("Talk note");
    await fakeMicrophone(true);
    setWhisper(true, [
      { start: 0, end: 4, text: "I have three ideas and I'm weighing effort against value." },
      { start: 4, end: 9, text: "Voice notes are little effort and a lot of value." },
      {
        start: 9,
        end: 14,
        text: "Sync is a lot of effort for little value, and export is easy but small.",
      },
    ]);
    ok(await pressRecord());
    const stopOnFail = async (e) => {
      await pressDock("Stop");
      throw e;
    };
    const surface = (selector) =>
      browser.execute(
        (q) => document.querySelectorAll(`.talk-board-surface ${q}`).length,
        selector,
      );
    const click = (says) =>
      browser.execute(
        (w) =>
          [...document.querySelectorAll(".talk-box-picture")]
            .find((b) => b.textContent === w)
            .click(),
        says,
      );
    // Some board first, whatever the AI picked.
    await browser
      .waitUntil(async () => (await surface("[data-el]")) > 0, {
        timeout: 120_000,
        timeoutMsg: "the topic wasn't drawn as a board",
      })
      .catch(stopOnFail);
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector(".talk-box-picture:disabled")),
      { timeout: 10_000 },
    );
    if ((await surface('[data-type="frame"]')) !== 4) {
      await click("as a matrix");
      await browser
        .waitUntil(async () => (await surface('[data-type="frame"]')) === 4, {
          timeout: 100_000,
          timeoutMsg: "as a matrix didn't draw four sections",
        })
        .catch(stopOnFail);
    }
    // Its ideas are the board's cards (how many the AI places is up to it).
    await browser
      .waitUntil(async () => (await surface('[data-type="roundRect"]')) >= 1, {
        timeout: 30_000,
        timeoutMsg: "the matrix placed no ideas as cards",
      })
      .catch(stopOnFail);
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector(".talk-box-picture[data-pending]")),
      { timeout: 10_000 },
    );
    await click("as a chart");
    await browser
      .waitUntil(async () => (await surface('[data-type="chart"] .wr-board-chart svg')) === 1, {
        timeout: 100_000,
        timeoutMsg: "as a chart didn't draw a chart card",
      })
      .catch(stopOnFail);
    ok(await pressDock("Stop"));
    await browser.waitUntil(async () => (await dockText()).includes("Saved to Recordings/"), {
      timeout: 100_000,
    });
    // The note holds the chart's board, not a Mermaid block.
    const note = await invoke("read_file", { path: `${root}/Notes/Talk note.md` });
    const text = note.value?.content ?? "";
    const last = text.slice(text.lastIndexOf("## Talk"));
    ok(/\.board\.svg/.test(last), "the note doesn't embed the topic's board");
    ok(!/```mermaid/.test(last), "the note still holds a Mermaid block");
  });

  it("TALK-16 In columns after a pinch, the pill and the live box fit inside the note's column", async () => {
    // Five columns: Pinch hub and the four notes it opens beside, then Talk
    // note in the last one, so the take lands where the other journeys look.
    await openNote("Pinch hub");
    for (const name of ["Long essay", "Outline tour", "On writing", "Welcome"]) {
      await $(`.cm-wiki-link*=${name}`).waitForExist({ timeout: 10_000 });
      await browser.execute((text) => {
        const link = [...document.querySelectorAll(".cm-wiki-link")].find(
          (el) => el.textContent === text,
        );
        const r = link.getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, button: 0, clientX: r.left + 4 };
        for (const type of ["mousedown", "mouseup", "click"]) {
          link.dispatchEvent(new MouseEvent(type, { ...at, clientY: r.top + r.height / 2 }));
        }
      }, name);
      await waitForTitle(name);
    }
    await openNote("Talk note");
    // A pinch in, as Ctrl-wheel steps, if opening beside didn't already show columns.
    const pinch = (deltaY) =>
      browser.execute((dy) => {
        // Over Talk note's column (it has the pill), so a pinch out shows that note.
        const column =
          document.querySelector(".talk-dock")?.closest(".tab-column") ??
          document.querySelector(".tab-column:not([data-hidden])");
        const content = column.querySelector(".cm-content");
        const box = content.getBoundingClientRect();
        for (let i = 0; i < 3; i++) {
          content.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              deltaY: dy,
              clientX: box.left + 40,
              clientY: box.top + 40,
            }),
          );
        }
        return document.querySelector(".tab-columns").hasAttribute("data-columns");
      }, deltaY);
    const columns = () =>
      browser.execute(() => document.querySelector(".tab-columns").hasAttribute("data-columns"));
    if (!(await columns())) ok(await pinch(5), "the pinch didn't show the columns");

    await fakeMicrophone(true);
    setWhisper(false);
    const fit = () =>
      browser.execute(() => {
        const dock = document.querySelector(".talk-dock");
        const column = dock.closest(".tab-column");
        const c = column.getBoundingClientRect();
        const out = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.left < c.left - 1 || r.right > c.right + 1 || el.scrollWidth > el.clientWidth + 1
            ? `${el.className} at ${Math.round(r.left)}–${Math.round(r.right)} (content ${el.scrollWidth}px in ${el.clientWidth}px), column at ${Math.round(c.left)}–${Math.round(c.right)}`
            : null;
        };
        return [".talk-dock-pill", ".talk-box"]
          .map((s) => out(document.querySelector(s)))
          .filter(Boolean);
      });
    const idle = await fit();
    ok(idle.length === 0, `Record doesn't fit its column: ${idle.join("; ")}`);
    ok(await pressRecord());
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector(".talk-box"))),
      { timeout: 10_000, timeoutMsg: `the live box never showed: ${await dockText()}` },
    );
    const live = await fit();
    ok(
      await browser.execute(() => document.querySelectorAll("[data-talk-meter] span").length > 8),
      "no level trace in the pill",
    );
    ok(await pressDock("Stop"));
    ok(live.length === 0, `while recording, the pill or box spills out: ${live.join("; ")}`);
    await browser.waitUntil(async () => /Whisper Small/.test(await dockText()), {
      timeout: 10_000,
    });
    ok(await pressDock("Not now"));
    // Back to one tab, as the other journeys expect: there the note runs under
    // the footer, and Record must sit above it.
    if (await columns()) await pinch(-5);
    const clear = await browser.execute(() => {
      const pill = document
        .querySelector(".tab-column:not([data-hidden]) .talk-dock-pill")
        ?.getBoundingClientRect();
      const footer = document.querySelector("[data-document-footer]")?.getBoundingClientRect();
      return !pill || !footer
        ? `pill ${Boolean(pill)}, footer ${Boolean(footer)}`
        : pill.bottom <= footer.top
          ? null
          : `pill ends at ${Math.round(pill.bottom)}, footer starts at ${Math.round(footer.top)}`;
    });
    ok(clear === null, `Record is under the footer in one tab: ${clear}`);
  });
});
