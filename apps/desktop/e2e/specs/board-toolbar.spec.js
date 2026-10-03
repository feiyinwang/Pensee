import { ok } from "node:assert/strict";

// Selection toolbar (SPECs/board-lark-parity-spec.md): selecting a shape on a
// board shows a floating Arc toolbar under it; picking a fill from its popover
// restyles the shape and saves to the .board.svg.
//
// Seed the note before launch (see board-file.spec.js); self-skips without a
// restorable workspace.
describe("Board selection toolbar", function () {
  const FILE_STEM = "board-toolbar-e2e";
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

  async function boardText() {
    const note = await invoke("read_file", { path: `${root}/${FILE_STEM}.md` });
    const m = /\]\(([^)]+\.board\.svg)\)/.exec(note.ok ? note.value.content : "");
    if (!m) return "";
    const file = await invoke("read_file", { path: `${root}/${m[1]}` });
    return file.ok ? file.value.content : "";
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    const recents = await invoke("get_recent_workspaces", {});
    root = recents.ok ? recents.value[0] : null;
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (!root) return;
    await invoke("delete_entry", { path: `${root}/${FILE_STEM}.md` });
    await invoke("delete_entry", { path: `${root}/${FILE_STEM}-assets` });
  });

  it("shows the toolbar under a selected shape", async function () {
    const row = await $("span*=Toolbar check");
    await row.waitForExist({ timeout: 15_000 });
    await row.click();
    const card = await $(".wr-board-card");
    await card.waitForExist({ timeout: 10_000 });
    await card.click();
    await $(".wr-board-fullscreen").waitForExist({ timeout: 10_000 });

    const shape = await $('.wr-board-fullscreen [data-el="r1"]');
    await shape.waitForExist({ timeout: 10_000 });
    // The driver can neither click SVG groups nor deliver pointer actions to
    // the canvas, so press the shape with synthetic pointer events.
    await browser.execute(() => {
      const r = document
        .querySelector('.wr-board-fullscreen [data-el="r1"]')
        .getBoundingClientRect();
      const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
      const at = {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        isPrimary: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      };
      svg.dispatchEvent(new PointerEvent("pointerdown", at));
      svg.dispatchEvent(new PointerEvent("pointerup", at));
    });

    const bar = await $('.wr-board-seltb [role="toolbar"]');
    // Exist, not displayed: a hidden test window gets no animation frames, so
    // the entrance spring can sit at its first frame (opacity 0).
    await bar.waitForExist({ timeout: 10_000 });
    const [shapeRect, barRect] = await browser.execute(() => {
      const r = (el) => el.getBoundingClientRect().toJSON();
      return [
        r(document.querySelector('.wr-board-fullscreen [data-el="r1"]')),
        r(document.querySelector('.wr-board-seltb [role="toolbar"]')),
      ];
    });
    ok(
      barRect.top > shapeRect.bottom,
      `toolbar is not below the shape: bar ${JSON.stringify(barRect)} shape ${JSON.stringify(shapeRect)}`,
    );
    const shapeMid = shapeRect.left + shapeRect.width / 2;
    const barMid = barRect.left + barRect.width / 2;
    ok(Math.abs(shapeMid - barMid) < 4, `toolbar not centred (${shapeMid} vs ${barMid})`);
    for (const label of ["Shape", "Fill", "Border", "Text colour", "Text size", "Align", "More"]) {
      ok(
        await $(`.wr-board-seltb button[aria-label="${label}"]`).isExisting(),
        `no ${label} button`,
      );
    }
  });

  it("restyles the shape from the Fill popover and saves it", async function () {
    await browser.execute(() =>
      document.querySelector('.wr-board-seltb button[aria-label="Fill"]').click(),
    );
    await $('[role="radio"][aria-label="Fill: red"]').waitForExist({ timeout: 5_000 });
    await browser.execute(() =>
      document.querySelector('[role="radio"][aria-label="Fill: red"]').click(),
    );

    await browser.waitUntil(async () => (await boardText()).includes('"f":"red"'), {
      timeout: 10_000,
      timeoutMsg: "fill change was not saved to the board file",
    });
    const fill = await browser.execute(() =>
      document.querySelector('.wr-board-fullscreen [data-el="r1"] rect')?.getAttribute("fill"),
    );
    ok(fill === "var(--wr-board-red)", `shape fill is ${fill}`);
  });

  it("keeps Writer's own theme tokens and focus rings intact", async function () {
    const [accentHtml, accentBody, focusRule] = await browser.execute(() => {
      const html = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const body = getComputedStyle(document.body).getPropertyValue("--accent").trim();
      const sheet = document.getElementById("wr-arc-tokens")?.textContent ?? "";
      return [html, body, sheet.includes("*:focus-visible")];
    });
    ok(accentHtml && accentHtml === accentBody, `--accent changed: ${accentHtml} → ${accentBody}`);
    ok(!focusRule, "Arc's global no-focus rule was injected");
  });
});
