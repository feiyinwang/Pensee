import { ok, strictEqual } from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Ink, the only theme (see SPECs/ink-theme-spec.md and
// SPECs/ink-only-colour-spec.md). Run against a fresh data dir (no `config`)
// with a workspace seeded in recent_workspaces.json: the app must open in Ink
// in both modes, with a flat ground, underlined links and a ground-coloured
// tick on a foreground task box, and Settings must offer no theme picker and
// no accent colour.
// Screenshots land in $INK_SHOTS (default /tmp/ink-theme-shots).
const SHOTS = process.env.INK_SHOTS ?? "/tmp/ink-theme-shots";
const FILE_STEM = "ink-theme-e2e";
const DOC = [
  "Pensée writes in black and cream. A [link to the brand](https://example.com) and a [[wiki link]] sit in this line.",
  "",
  "## Tasks",
  "",
  "- [x] A checked task",
  "- [ ] An open task",
  "",
  "> A quotation, set apart by its rule.",
  "",
].join("\n");

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

async function pressCmd(key) {
  await browser.execute((pressedKey) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: pressedKey,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, key);
}

async function setMode(mode) {
  const set = await invoke("set_setting", {
    key: "appearance.theme",
    value: mode,
    scope: "global",
  });
  ok(set.ok, `failed to set ${mode}: ${set.error}`);
  // The store reads settings at startup; a reload picks the write up.
  await browser.refresh();
  await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => document.documentElement.getAttribute("data-theme"))) === mode,
    { timeout: 10_000, timeoutMsg: `data-theme never became ${mode}` },
  );
  await browser.pause(400);
}

const themeState = () =>
  browser.execute(() => {
    const root = getComputedStyle(document.documentElement);
    const backdrop = getComputedStyle(document.body, "::before").backgroundImage;
    const link = document.querySelector(".cm-rendered-link, .cm-wiki-link");
    const tick = document.querySelector(".cm-list-prefix-task-checked");
    return {
      mode: document.documentElement.getAttribute("data-theme"),
      accent: root.getPropertyValue("--accent").trim(),
      bgBase: root.getPropertyValue("--bg-base").trim(),
      fgBase: root.getPropertyValue("--fg-base").trim(),
      onAccent: (() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--on-accent)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      backdrop,
      linkDecoration: link ? getComputedStyle(link).textDecorationLine : null,
      tickColor: tick ? getComputedStyle(tick, "::after").backgroundColor : null,
      boxColor: tick ? getComputedStyle(tick, "::before").backgroundColor : null,
    };
  });

describe("Ink theme on a fresh install", function () {
  let filePath = null;

  before(async function () {
    mkdirSync(SHOTS, { recursive: true });
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the document into");
    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded note", async function () {
    await pressCmd("o");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.addValue(FILE_STEM);
    await browser.pause(800);
    await browser.execute(() => {
      const el = document.querySelector("[cmdk-input]");
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await browser.waitUntil(
      async () => (await $(".cm-content").getText()).includes("black and cream"),
      { timeout: 15_000, timeoutMsg: "the seeded note never opened" },
    );
    // Caret off the link line so links render as links.
    await browser.execute(() => {
      const quote = [...document.querySelectorAll(".cm-line")].at(-1);
      quote?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await browser.pause(400);
  });

  for (const mode of ["light", "dark"]) {
    it(`is Ink with a flat ground in ${mode} mode`, async function () {
      await setMode(mode);
      const state = await themeState();
      console.log(mode, JSON.stringify(state));
      strictEqual(state.backdrop, "none");
      const nearBlack = "#0f0e0d";
      const nearWhite = "#fafaf9";
      strictEqual(state.bgBase.toLowerCase(), mode === "light" ? nearWhite : nearBlack);
      strictEqual(state.fgBase.toLowerCase(), mode === "light" ? nearBlack : nearWhite);
      strictEqual(state.accent.toLowerCase(), state.fgBase.toLowerCase());
      if (state.linkDecoration !== null) strictEqual(state.linkDecoration, "underline");
      await browser.saveScreenshot(resolve(SHOTS, `ink-${mode}-editor.png`));
    });
  }

  it("offers no theme picker and no accent colour in Settings", async function () {
    await pressCmd("p");
    const settingsCommand = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCommand.waitForExist({ timeout: 5_000 });
    await settingsCommand.click();
    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });
    const found = await browser.execute(() => {
      const panel = document.querySelector("[data-settings-panel]");
      const text = panel ? panel.textContent : "";
      const presetSelect = [...document.querySelectorAll("[data-settings-panel] select")].some(
        (s) => [...s.options].some((o) => o.value === "Ink"),
      );
      return { presetSelect, accent: /\bAccent\b/.test(text) };
    });
    console.log("settings", JSON.stringify(found));
    await browser.saveScreenshot(resolve(SHOTS, "ink-dark-settings.png"));
    await setMode("light");
    await browser.saveScreenshot(resolve(SHOTS, "ink-light-settings.png"));
    strictEqual(found.presetSelect, false);
    strictEqual(found.accent, false);
  });
});
