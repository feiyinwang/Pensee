import { ok } from "node:assert/strict";

// Clicking a pin (`^yt-<seconds>`) plays the video from that moment
// (SPECs/youtube-notes-spec.md). A real press is pointerdown, mousedown,
// pointerup, mouseup, click, in that order: the editor's drag gate acts on
// pointerdown/up, so a click made of mousedown + click alone proves less.
//
// Needs network access (YouTube) and a restorable workspace; self-skips
// without one. SHOTS=<dir> saves screenshots.

const shots = process.env.SHOTS ?? null;
const VIDEO = "yt-e2e-pin-click";
const PAGE = [
  "---",
  "Type: Video",
  "Url: https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  "---",
  "",
  "- early idea ^yt-42",
  "- later idea ^yt-300",
  "",
].join("\n");

describe("YouTube pin click", function () {
  let workspaceRestored = false;
  let root = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
      },
      cmd,
      args,
    );
  }

  async function shot(name) {
    if (shots) await browser.saveScreenshot(`${shots}/${name}.png`);
  }

  /** Presses the pin titled `title` like a mouse does; returns what the
   *  pin saw. */
  async function pressPin(title) {
    return browser.execute((label) => {
      window.__ytReports = [];
      const pin = [...document.querySelectorAll(".cm-video-pin")].find((p) => p.title === label);
      if (!pin) return { found: false };
      // Clear of the word-count footer, below the (tall, sticky) video.
      pin.scrollIntoView({ block: "end" });
      let scroller = pin.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight)
        scroller = scroller.parentElement;
      scroller?.scrollBy(0, 80);
      const seen = [];
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        document.addEventListener(
          type,
          (e) =>
            seen.push(
              `${type}:${e.target.closest?.(".cm-video-pin") ? "cm-video-pin" : e.target.tagName}`,
            ),
          {
            capture: true,
            once: true,
          },
        );
      }
      const r = pin.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        isPrimary: true,
        pointerType: "mouse",
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      };
      let target = pin;
      target.dispatchEvent(new PointerEvent("pointerdown", at));
      target.dispatchEvent(new MouseEvent("mousedown", at));
      const connectedAfterDown = pin.isConnected;
      // The release lands on whatever is under the pointer now.
      target = document.elementFromPoint(at.clientX, at.clientY) ?? pin;
      const up = { ...at, buttons: 0 };
      target.dispatchEvent(new PointerEvent("pointerup", up));
      target.dispatchEvent(new MouseEvent("mouseup", up));
      const sameTarget = target === pin || pin.contains(target);
      // A browser fires click only when down and up hit the same element.
      if (sameTarget) target.dispatchEvent(new MouseEvent("click", up));
      return {
        found: true,
        connectedAfterDown,
        connectedAfterUp: pin.isConnected,
        upTarget: `${target.tagName}.${target.className}`,
        sameTarget,
        seen,
      };
    }, title);
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    const recents = await invoke("get_recent_workspaces", {});
    root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed pages into");
    const wrote = await invoke("write_file", { path: `${root}/${VIDEO}.md`, content: PAGE });
    ok(wrote.ok, `failed to seed: ${wrote.error}`);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (root) await invoke("delete_entry", { path: `${root}/${VIDEO}.md` });
  });

  // The first pin hits a video that hasn't started (the note just opened):
  // the case that used to do nothing. The second hits a playing one.
  it("plays from each pin's moment on a real press", async function () {
    await browser.execute(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }),
      ),
    );
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 10_000 });
    await input.addValue(VIDEO);
    const item = await $(`[cmdk-item][data-value$="/${VIDEO}.md"]`);
    await item.waitForExist({ timeout: 15_000 }).catch(async (error) => {
      const items = await browser.execute(() =>
        [...document.querySelectorAll("[cmdk-item]")].map((el) => el.dataset.value),
      );
      await shot("pin-00-palette");
      throw new Error(`${error.message}; root ${root}; palette had ${JSON.stringify(items)}`);
    });
    await item.click();
    await $(".video-band iframe").waitForExist({ timeout: 15_000 });
    await browser.execute(() => {
      window.__ytReports = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt") window.__ytReports.push(e.data);
      });
    });
    await browser.waitUntil(
      async () => browser.execute(() => window.__ytReports.some((r) => r.type === "state")),
      { timeout: 30_000, timeoutMsg: "the player page never reported" },
    );
    await browser.pause(1000);
    await shot("pin-01-open");

    for (const [title, seconds] of [
      ["Play from 0:42", 42],
      ["Play from 5:00", 300],
    ]) {
      const press = await pressPin(title);
      ok(press.found, `no pin titled ${title}`);
      ok(
        press.seen.includes("click:cm-video-pin"),
        `the click never reached the pin: ${JSON.stringify(press)}`,
      );
      const reached = await browser
        .waitUntil(
          async () =>
            browser.execute(
              (s) =>
                window.__ytReports.some(
                  (r) => r.type === "state" && r.playing && Math.abs(r.t - s) < 3,
                ),
              seconds,
            ),
          { timeout: 15_000 },
        )
        .catch(() => false);
      await shot(`pin-02-${seconds}`);
      ok(reached, `${title}: never playing at ${seconds}s`);
    }
  });

  it("steps the speed with > and < in the video's note, and remembers it", async function () {
    // Typing in the note: the caret is in its text.
    await browser.execute(() => {
      const view = document.querySelector(".cm-video-pin").closest(".cm-content").cmTile.root.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    const before = await browser.execute(
      () => document.querySelector(".cm-video-pin").closest(".cm-content").textContent,
    );
    const press = (code, key) =>
      browser.execute(
        (c, k) =>
          document.activeElement.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: k,
              code: c,
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        code,
        key,
      );
    const saved = () =>
      browser.execute(() => JSON.parse(localStorage.getItem("writer.video-player") ?? "{}").rate);
    await press("Period", ">");
    await press("Period", ">");
    await browser.waitUntil(async () => (await saved()) === 1.5, {
      timeout: 5_000,
      timeoutMsg: "> twice didn't reach 1.5×",
    });
    await shot("pin-03-speed");
    await press("Comma", "<");
    await browser.waitUntil(async () => (await saved()) === 1.25, {
      timeout: 5_000,
      timeoutMsg: "< didn't step back to 1.25×",
    });
    const after = await browser.execute(
      () => document.querySelector(".cm-video-pin").closest(".cm-content").textContent,
    );
    ok(after === before, "< or > was typed into the note");
    // Back to normal for the next run.
    await press("Comma", "<");
  });
});
