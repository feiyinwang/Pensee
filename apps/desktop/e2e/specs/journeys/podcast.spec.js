// Podcast notes (docs/qa/user-journeys.md § Podcast notes — POD): adding a
// podcast opens its note with the player, and ⌘⇧J / ⌘⇧M work on it as on a
// video. The episode is a silent WAV served from this process, so the
// journeys need no network.
import { ok } from "node:assert/strict";
import http from "node:http";
import {
  activeTitle,
  fillField,
  invoke,
  pressCmd,
  typeInEditor,
  workspaceRoot,
} from "./_helpers.js";

/** `seconds` of 8 kHz 8-bit mono silence. */
function silentWav(seconds) {
  const samples = 8000 * seconds;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}

const EPISODE = silentWav(30);

/** Serves the episode with byte ranges, which WebKit's media loader needs. */
function serve(req, res) {
  if (!req.url.startsWith("/episode.wav")) {
    res.writeHead(404).end();
    return;
  }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  if (!range) {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": EPISODE.length,
      "Accept-Ranges": "bytes",
    });
    res.end(req.method === "HEAD" ? undefined : EPISODE);
    return;
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), EPISODE.length - 1) : EPISODE.length - 1;
  res.writeHead(206, {
    "Content-Type": "audio/wav",
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${EPISODE.length}`,
    "Accept-Ranges": "bytes",
  });
  res.end(EPISODE.subarray(start, end + 1));
}

/** The front pane's audio element, as numbers WebDriver can return. */
const audioState = () =>
  browser.execute(() => {
    const audio = [...document.querySelectorAll(".podcast-band audio")].find((el) =>
      el.closest(".podcast-band")?.checkVisibility(),
    );
    return audio
      ? { paused: audio.paused, time: audio.currentTime, ready: audio.readyState }
      : null;
  });

describe("Podcast notes", function () {
  let server;
  let link;
  let root;

  before(async function () {
    server = http.createServer(serve);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    link = `http://127.0.0.1:${server.address().port}/episode.wav`;
    root = await workspaceRoot();
  });

  after(function () {
    server?.close();
  });

  it("POD-01 Library → Podcasts → +, a link, ⌘↵ opens the note with its player", async function () {
    await $('button[data-space-key="library"]').click();
    const tab = await $(
      '//*[@aria-label="Library types"]//*[normalize-space(.)="Podcasts" or starts-with(normalize-space(.), "Podcasts")]',
    );
    await tab.waitForExist({ timeout: 10_000 });
    await tab.click();
    const add = await $('button[aria-label="Add podcast"]');
    await add.waitForClickable({ timeout: 5_000 });
    await add.click();
    const title = '[role="dialog"] input[aria-label="Title"]';
    await $(title).waitForExist({ timeout: 5_000 });
    await fillField(title, link);
    // ⌘↵ alone: other kinds stay on the page; a podcast opens.
    await browser.execute((sel) => {
      document.querySelector(sel).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, title);
    await browser.waitUntil(async () => (await audioState())?.ready >= 1, {
      timeout: 20_000,
      timeoutMsg: "the podcast note never opened with a loaded player",
    });
    // The link has no page title, so the note is named from it.
    const name = await activeTitle();
    ok(name?.startsWith("127.0.0.1"), `the new note is in front (got "${name}")`);
    const note = await invoke("read_file", { path: `${root}/${name}.md` });
    ok(note.ok && /Type: Podcast/.test(note.value.content), "it is a Podcast note");
    ok((await audioState()).paused, "it doesn't play on its own");
  });

  it("POD-02 ★ ⌘⇧J plays, ⌘⇧M pins the moment on the line, ⌘⇧J pauses", async function () {
    await typeInEditor("A thought on this");
    await pressCmd("j", { shift: true });
    await browser.waitUntil(async () => (await audioState())?.time > 1.2, {
      timeout: 10_000,
      timeoutMsg: "⌘⇧J didn't play the episode",
    });
    await pressCmd("m", { shift: true });
    // A look at the playing bar, when the run asks for one.
    // The hidden e2e window freezes animations: settle them first.
    if (process.env.PENSEE_QA_SHOT) {
      await browser.execute(() => {
        const style = document.createElement("style");
        style.textContent = "*{transition:none!important}";
        document.head.append(style);
        document.getAnimations({ subtree: true }).forEach((a) => a.finish());
      });
      await browser.saveScreenshot(process.env.PENSEE_QA_SHOT);
    }
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll(".cm-video-pin")].some((pin) => pin.checkVisibility()),
        ),
      { timeout: 5_000, timeoutMsg: "⌘⇧M didn't pin the line" },
    );
    await pressCmd("j", { shift: true });
    await browser.waitUntil(async () => (await audioState())?.paused === true, {
      timeout: 5_000,
      timeoutMsg: "⌘⇧J didn't pause",
    });
    const pinned = await browser.execute(
      () =>
        [...document.querySelectorAll(".cm-video-pin")].find((pin) => pin.checkVisibility())
          ?.title ?? null,
    );
    ok(/^Play from 0:0[1-9]$/.test(pinned ?? ""), `pinned at the playing time (${pinned})`);
  });
});
