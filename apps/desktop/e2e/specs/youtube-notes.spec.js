import { equal, ok } from "node:assert/strict";

// YouTube notes (SPECs/youtube-notes-spec.md): a note with a YouTube link
// plays it in a sticky player, ⌘⇧M stamps the caret's block with a hidden
// `^yt-<seconds>` pin, and with a board open beside it the pin lands on the
// board as a rectangle (or a child of the selected mind-map node).
//
// Needs network access (YouTube) and a restorable workspace; self-skips
// without one (see latex-math.spec.js). SHOTS=<dir> saves screenshots.

const shots = process.env.SHOTS ?? null;
const VIDEO = "yt-e2e-video";
const BOARD = "yt-e2e-board";
const HEADER = '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}';
const ROOT_TOPIC = '{"id":"m1","t":"mind","x":-60,"y":-20,"w":120,"h":40,"tx":"Ideas"}';
const PAGES = {
  [VIDEO]: [
    "---",
    "Type: Video",
    "Url: https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    "---",
    "First thought",
    "",
    "",
    `See [[${BOARD}]]`,
    "",
    "Known moment ^yt-42",
    "",
  ].join("\n"),
  [BOARD]: ["# Board beside", "", "```board", HEADER, ROOT_TOPIC, "```", ""].join("\n"),
};

describe("YouTube notes", function () {
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

  async function saved(stem) {
    const file = await invoke("read_file", { path: `${root}/${stem}.md` });
    return file.ok ? file.value.content : "";
  }

  // Driver keystrokes don't reliably reach CodeMirror on WKWebView, so the
  // caret and typing go through the video note's view (found the way
  // `EditorView.findFromDOM` does; CSP forbids passing code as a string).

  /** Caret at the end of line `n` (1-based), focused. */
  async function caretAtLine(n) {
    await browser.execute((line) => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((p) =>
        p.querySelector(".video-band"),
      );
      const view = pane.querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
      view.focus();
    }, n);
    await browser.pause(150);
  }

  async function type(text) {
    await browser.execute((value) => {
      const view = document.activeElement.closest(".cm-editor").querySelector(".cm-content").cmTile
        .root.view;
      view.dispatch(view.state.replaceSelection(value), { userEvent: "input.type" });
    }, text);
  }

  async function pressPin() {
    await browser.execute(() =>
      (document.activeElement ?? document).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "M",
          code: "KeyM",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await browser.pause(300);
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    await browser.execute(() => {
      const style = document.createElement("style");
      style.textContent = "*, *::before, *::after { transition: none !important; }";
      document.head.append(style);
    });
    const recents = await invoke("get_recent_workspaces", {});
    root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed pages into");
    for (const [stem, content] of Object.entries(PAGES)) {
      const wrote = await invoke("write_file", { path: `${root}/${stem}.md`, content });
      ok(wrote.ok, `failed to seed ${stem}: ${wrote.error}`);
    }
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (!root) return;
    for (const stem of Object.keys(PAGES)) {
      await invoke("delete_entry", { path: `${root}/${stem}.md` });
    }
    // Only there once the fence became a .board.svg.
    await invoke("delete_entry", { path: `${root}/${BOARD}-assets` }).catch(() => {});
  });

  it("plays the video under the properties", async function () {
    for (let i = 0; i < 20; i++) {
      const closed = await browser.execute(() => {
        const close = document.querySelector(".tab-columns[data-columns] .tab-column-close");
        close?.click();
        return Boolean(close);
      });
      if (!closed) break;
      await browser.pause(100);
    }
    await browser.execute(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "o", metaKey: true, bubbles: true, cancelable: true }),
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
      throw new Error(`${error.message}; palette had ${JSON.stringify(items)}`);
    });
    await item.click();
    const frame = await $(".video-band iframe");
    await frame.waitForExist({ timeout: 15_000 });
    const src = await frame.getAttribute("src");
    ok(/^http:\/\/127\.0\.0\.1:\d+\/youtube-player\.html\?v=aqz-KE-bpKQ&/.test(src), src);

    // The page reports once YouTube's player is ready: no Error 153 from a
    // tauri:// referrer.
    await browser.execute(() => {
      window.__ytReports = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt") window.__ytReports.push(e.data);
      });
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          window.__ytReports.some((r) => r.type === "state" || r.type === "error"),
        ),
      { timeout: 30_000, timeoutMsg: "the player page never reported" },
    );
    const reports = await browser.execute(() => window.__ytReports);
    ok(!reports.some((r) => r.type === "error"), `player error: ${JSON.stringify(reports)}`);
    await browser.pause(1500);
    await shot("yt-01-player");
  });

  it("pins a moment on an empty line and stamps a written one", async function () {
    await caretAtLine(2);
    await pressPin();
    await type("a pin");
    await caretAtLine(1);
    await pressPin();
    const text = await browser.waitUntil(
      async () => {
        const t = await saved(VIDEO);
        return /^- a pin \^yt-\d+$/m.test(t) && /^First thought \^yt-\d+(-2)?$/m.test(t)
          ? t
          : false;
      },
      { timeout: 10_000, timeoutMsg: `pins not written: ${await saved(VIDEO)}` },
    );
    ok(text, "pins written");
    const pins = await browser.execute(() => document.querySelectorAll(".cm-video-pin").length);
    equal(pins, 3, "two new pins and the seeded one");
    const ids = await browser.execute(() =>
      [...document.querySelectorAll(".cm-content")].some((el) => el.textContent.includes("^yt-")),
    );
    equal(ids, false, "a pin id shows as text");
    await shot("yt-02-pins");
  });

  it("puts a pin from a pinned line on a new bullet below", async function () {
    await caretAtLine(1);
    await pressPin();
    const text = await browser.waitUntil(
      async () => {
        const t = await saved(VIDEO);
        return /^First thought \^yt-\S+\n-  \^yt-\S+$/m.test(t) ? t : false;
      },
      { timeout: 10_000, timeoutMsg: `no new bullet: ${await saved(VIDEO)}` },
    );
    ok(text);
  });

  it("plays from a pin when it is clicked", async function () {
    await browser.execute(() => {
      window.__ytReports = [];
      const pins = [...document.querySelectorAll(".cm-video-pin")];
      const pin = pins.find((p) => p.title === "Play from 0:42");
      pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          window.__ytReports.some((r) => r.type === "state" && r.playing && Math.abs(r.t - 42) < 3),
        ),
      { timeout: 15_000, timeoutMsg: "the player never played from 0:42" },
    );
    await shot("yt-02b-seeked");
  });

  it("adds pins to a board open beside the video", async function () {
    const link = await $(`.cm-wiki-link*=${BOARD}`);
    await link.waitForExist({ timeout: 10_000 });
    await browser.execute((el) => {
      // The video is tall: bring the link out from under it first.
      el.scrollIntoView({ block: "end" });
      const r = el.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: r.left + 4,
        clientY: r.top + r.height / 2,
      };
      for (const type of ["mousedown", "mouseup", "click"])
        el.dispatchEvent(new MouseEvent(type, init));
    }, link);
    // The fence converts to a .board.svg on first open (full screen); close
    // it, then open the board over its page.
    const card = await $(".wr-board-card");
    await card.waitForExist({ timeout: 15_000 }).catch(async (error) => {
      await shot("yt-03-no-card");
      throw error;
    });
    await card.click();
    await $(".wr-board-fullscreen").waitForExist({ timeout: 10_000 });
    await browser.execute(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await browser.execute(() => {
      const el = document.querySelector(".wr-board-fullscreen");
      if (el) el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const editHere = await $("button.wr-board-image-open=Edit here");
    await editHere.waitForExist({ timeout: 15_000 });
    await browser.execute((el) => el.click(), editHere);
    await $(".wr-board-inline").waitForExist({ timeout: 10_000 });
    await browser.pause(500);

    // A rectangle by default…
    await browser.execute(() => document.querySelector(".wr-board-inline").focus());
    await pressPin();
    await browser.keys(["o", "n", "e"]);
    await browser.execute(() => document.querySelector(".wr-board-inline").focus());
    await browser.pause(300);
    const rects = await browser.execute(
      () => document.querySelectorAll(".wr-board-inline .wr-board-pin").length,
    );
    equal(rects, 1, "no pin badge on the board");
    await shot("yt-03-board-rect");

    // …a child under a selected mind-map node.
    await browser.execute(() => {
      const topic = [...document.querySelectorAll(".wr-board-inline text")].find((t) =>
        t.textContent.includes("Ideas"),
      );
      const r = topic.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        isPrimary: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      };
      topic.dispatchEvent(new PointerEvent("pointerdown", at));
      window.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
    });
    await pressPin();
    await browser.keys(["t", "w", "o"]);
    await browser.execute(() => document.querySelector(".wr-board-inline").focus());
    await browser.pause(300);
    await shot("yt-04-board-mind");
    // Close the board: it writes the file back.
    await browser.execute(() =>
      document
        .querySelector(".wr-board-inline")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await browser.pause(800);
    const boardText = await saved(BOARD);
    const svgPath = /\]\(([^)]+\.board\.svg)\)/.exec(boardText)?.[1];
    ok(svgPath, `no board file in ${boardText}`);
    const svg = await invoke("read_file", { path: `${root}/${svgPath}` });
    ok(svg.ok, svg.error);
    const lines = svg.value.content.split("\n").filter((l) => l.includes(`${VIDEO}#^yt-`));
    ok(
      lines.some((l) => l.includes('"t":"rect"')),
      `no pinned rectangle: ${svg.value.content}`,
    );
    ok(
      lines.some((l) => l.includes('"t":"mind"') && l.includes('"pa":"m1"')),
      `no pinned child node: ${svg.value.content}`,
    );
  });

  it("keeps the video as a mini player over a board on its own note", async function () {
    const boardLine = (await saved(BOARD)).split("\n").find((l) => l.includes(".board.svg"));
    ok(boardLine, "the board note has no board line");
    await caretAtLine(1);
    await type(`\n\n${boardLine}\n`);
    await browser.pause(500);
    const opened = await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((p) =>
        p.querySelector(".video-band"),
      );
      const button = [...pane.querySelectorAll("button.wr-board-image-open")].find(
        (b) => b.textContent === "Edit here",
      );
      button?.click();
      return Boolean(button);
    });
    ok(opened, "no Edit here on the video note's board");
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          [...document.querySelectorAll("[data-pane]")].some(
            (p) => p.querySelector(".video-band") && p.querySelector(":scope > .wr-board-inline"),
          ),
        ),
      { timeout: 10_000, timeoutMsg: "the board never opened over the video note" },
    );
    await browser.pause(400);
    const mini = await browser.execute(() => {
      const band = document.querySelector("[data-pane]:has(> .wr-board-inline) .video-band");
      const pane = band.closest("[data-pane]").getBoundingClientRect();
      const r = band.getBoundingClientRect();
      const style = getComputedStyle(band);
      return {
        visibility: style.visibility,
        position: style.position,
        width: Math.round(r.width),
        right: Math.round(pane.right - r.right),
        top: Math.round(r.top - pane.top),
        onTop: document.elementFromPoint(r.left + r.width / 2, r.top + 20)?.tagName,
      };
    });
    equal(mini.visibility, "visible");
    equal(mini.position, "absolute");
    equal(mini.width, 320);
    equal(mini.onTop, "IFRAME", `the board covers the mini player: ${JSON.stringify(mini)}`);
    await shot("yt-05-mini-player");
  });
});
