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
  mouseClick,
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

/** A 1×1 PNG: the episode page's artwork. */
const ARTWORK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** An episode's own page, naming its audio, title, show and artwork. */
const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Episode 12: Quiet rooms">
<meta property="og:site_name" content="The Silence Show">
<meta property="og:image" content="/art.png">
<meta property="og:audio" content="/episode.wav">
</head><body></body></html>`;

/** Serves the episode with byte ranges, which WebKit's media loader needs,
 *  and the page and artwork that name it. */
function serve(req, res) {
  if (req.url.startsWith("/page")) {
    res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    return;
  }
  if (req.url.startsWith("/art.png")) {
    res.writeHead(200, { "Content-Type": "image/png" }).end(ARTWORK);
    return;
  }
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

/** The player of the note in front: the focused column's when tabs show as
 *  columns (another podcast note may sit beside it). Runs in the page. */
const FRONT_BAND = () => {
  const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
  return [...scope.querySelectorAll(".podcast-band")].find((el) => el.checkVisibility()) ?? null;
};

/** The front player's audio element, as numbers WebDriver can return. */
const audioState = () =>
  browser.execute(`
    const audio = (${FRONT_BAND.toString()})()?.querySelector("audio");
    return audio
      ? { paused: audio.paused, time: audio.currentTime, ready: audio.readyState }
      : null;
  `);

/** Add `address` from Library → Podcasts → +, with ⌘↵. */
async function addPodcast(address) {
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
  await fillField(title, address);
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
}

/** The front player's card, as WebDriver can return it. */
const cardState = () =>
  browser.execute(`
    const card = (${FRONT_BAND.toString()})()?.querySelector(".podcast-card");
    if (!card) return null;
    const art = card.querySelector(".podcast-artwork img:not(.podcast-artwork-backdrop)");
    return {
      title: card.querySelector(".podcast-title")?.textContent ?? null,
      show: card.querySelector(".podcast-show")?.textContent ?? null,
      artwork: art?.hasAttribute("data-loaded") ? art.getAttribute("src") : null,
      // The whole picture shows, over a blurred copy of itself.
      artworkFit: art ? getComputedStyle(art).objectFit : null,
      backdrop: card.querySelector(".podcast-artwork-backdrop")?.getAttribute("src") ?? null,
      speedKeys: card.querySelector(".podcast-speed kbd")?.textContent ?? null,
    };
  `);

describe("Podcast notes", function () {
  let server;
  let link;
  let origin;
  let root;

  before(async function () {
    server = http.createServer(serve);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    link = `${origin}/episode.wav`;
    root = await workspaceRoot();
  });

  after(function () {
    server?.close();
  });

  it("POD-01 Library → Podcasts → +, a link, ⌘↵ opens the note with its player", async function () {
    await addPodcast(link);
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

  it("POD-04 An episode's page: the card shows its artwork, title and show; skip moves the playhead", async function () {
    await addPodcast(`${origin}/page`);
    await browser.waitUntil(async () => (await cardState())?.artwork, {
      timeout: 10_000,
      timeoutMsg: "the episode's artwork never showed",
    });
    const card = await cardState();
    ok(card.artwork === `${origin}/art.png`, `the page's artwork (${card.artwork})`);
    ok(card.title === "Episode 12: Quiet rooms", `the episode's title (${card.title})`);
    ok(card.show === "The Silence Show", `the show (${card.show})`);
    ok(card.artworkFit === "contain", `the artwork isn't cropped (${card.artworkFit})`);
    ok(card.backdrop === card.artwork, `a blurred copy fills the square (${card.backdrop})`);
    ok(card.speedKeys === "< >", `the speed shows its keys (${card.speedKeys})`);
    // A look at the card, when the run asks for one.
    if (process.env.PENSEE_QA_SHOT) {
      await browser.execute(() => {
        const style = document.createElement("style");
        style.textContent = "*{transition:none!important}";
        document.head.append(style);
      });
      await browser.saveScreenshot(process.env.PENSEE_QA_SHOT.replace(/(\.png)?$/, "-card.png"));
      console.log(
        "[qa] card boxes",
        JSON.stringify(
          await browser.execute(`
            const card = (${FRONT_BAND.toString()})()?.querySelector(".podcast-card");
            if (!card) return null;
            const box = (sel) => {
              const r = card.querySelector(sel)?.getBoundingClientRect();
              return r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
            };
            return Object.fromEntries(
              [".podcast-card", ".podcast-artwork", ".podcast-title", ".podcast-show",
               ".podcast-transport", ".podcast-timeline", ".podcast-tools", ".podcast-speed",
               ".podcast-mute", ".podcast-pin"].map((s) => [s, box(s)]),
            );
          `),
        ),
      );
    }

    await browser.execute(`
      const band = (${FRONT_BAND.toString()})();
      band.querySelector("audio").currentTime = 20;
      document.querySelectorAll("[data-qa-back]").forEach((el) => el.removeAttribute("data-qa-back"));
      band.querySelector('button[aria-label="Back 15 seconds"]').setAttribute("data-qa-back", "");
    `);
    await browser.waitUntil(async () => (await audioState())?.time >= 19.5, { timeout: 3_000 });
    const back = await $("[data-qa-back]");
    await browser.waitUntil(async () => !(await back.getProperty("disabled")), {
      timeout: 3_000,
      timeoutMsg: "Back 15 stayed disabled with the episode loaded",
    });
    await mouseClick(back);
    await browser.waitUntil(
      async () => {
        const time = (await audioState())?.time ?? 0;
        return time >= 4.5 && time <= 6;
      },
      { timeout: 3_000, timeoutMsg: "Back 15 didn't move the playhead to 0:05" },
    );
  });
});
