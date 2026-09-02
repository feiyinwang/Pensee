import { ok, strictEqual } from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Window zoom verification (SPECs/window-zoom-spec.md): Cmd+= steps the
// persisted `appearance.zoom` setting along the browser ladder and the webview
// page zoom follows, so the effective viewport halves at 200% and the chrome
// reflows without horizontal overflow. Cmd+0 returns to 100%.
//
// Needs a restorable workspace (seed recent_workspaces.json); self-skips on
// the welcome screen.
const SHOTS = resolve(process.env.ZOOM_SHOT_DIR ?? "/tmp", "writer-zoom-shots");

async function invoke(cmd, args) {
  const result = await browser.executeAsync(
    (cmdName, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmdName, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) =>
          done({ ok: false, error: error && error.message ? error.message : String(error) }),
        );
    },
    cmd,
    args,
  );
  if (!result.ok) throw new Error(`${cmd} failed: ${result.error}`);
  return result.value;
}

async function zoomSetting() {
  const settings = await invoke("get_settings", {});
  return settings["appearance.zoom"];
}

function pressCmd(key, times = 1) {
  return browser.execute(
    (k, n) => {
      for (let i = 0; i < n; i++) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true, cancelable: true }),
        );
      }
    },
    key,
    times,
  );
}

async function waitForZoom(expected) {
  await browser.waitUntil(async () => (await zoomSetting()) === expected, {
    timeout: 10_000,
    timeoutMsg: `appearance.zoom did not reach ${expected}`,
  });
}

function viewport() {
  return browser.execute(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

function chromeBoxes() {
  return browser.execute(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    return {
      sidebar: pick("[data-sidebar-surface]"),
      toggle: pick('button[aria-label="Hide sidebar"]'),
      footer: pick("[data-document-footer]"),
      editor: pick(".cm-editor"),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

describe("window zoom", function () {
  let workspaceRestored = false;
  let base = null;

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    mkdirSync(SHOTS, { recursive: true });
    await invoke("reset_setting", { key: "appearance.zoom", scope: "global" });
    const row = await $('[data-tree-path$="/note.md"]');
    await row.waitForExist({ timeout: 10_000 });
    await row.click();
    await $("[data-document-footer]").waitForExist({ timeout: 10_000 });
    await browser.pause(300);
    base = await viewport();
    await browser.saveScreenshot(resolve(SHOTS, "zoom-100.png"));
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (workspaceRestored)
      await invoke("reset_setting", { key: "appearance.zoom", scope: "global" });
  });

  it("starts at 100% with the setting default", async function () {
    strictEqual(await zoomSetting(), 100);
    strictEqual(base.scrollWidth, base.clientWidth, "no horizontal overflow at 100%");
  });

  it("Cmd+= five times reaches 200% and halves the effective viewport", async function () {
    await pressCmd("=", 5);
    await waitForZoom(200);
    await browser.waitUntil(
      async () => Math.abs((await viewport()).innerWidth - base.innerWidth / 2) <= 2,
      { timeout: 10_000, timeoutMsg: "innerWidth did not halve at 200%" },
    );
    await browser.pause(400);
    const v = await viewport();
    strictEqual(v.scrollWidth, v.clientWidth, "no horizontal overflow at 200%");
    const boxes = await chromeBoxes();
    await browser.saveScreenshot(resolve(SHOTS, "zoom-200.png"));
    for (const [name, box] of Object.entries(boxes)) {
      if (name === "vw" || name === "vh") continue;
      ok(box, `${name} is missing at 200%`);
      ok(
        box.left >= -1 && box.right <= boxes.vw + 1,
        `${name} overflows horizontally: ${JSON.stringify(box)}`,
      );
      // The editor is the scrolled document, so its box legitimately runs
      // past the bottom edge; the chrome pieces must stay fully on screen.
      if (name !== "editor") {
        ok(
          box.top >= -1 && box.bottom <= boxes.vh + 1,
          `${name} overflows vertically: ${JSON.stringify(box)}`,
        );
      }
    }
    ok(boxes.editor.width > 200, `editor too narrow at 200%: ${boxes.editor.width}`);
  });

  it("Cmd+- steps back down the ladder", async function () {
    await pressCmd("-");
    await waitForZoom(175);
  });

  it("Cmd+0 returns to actual size", async function () {
    await pressCmd("0");
    await waitForZoom(100);
    await browser.waitUntil(async () => (await viewport()).innerWidth === base.innerWidth, {
      timeout: 10_000,
      timeoutMsg: "innerWidth did not return to the 100% width",
    });
  });
});
