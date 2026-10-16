// Boards (BRD in docs/qa/user-journeys.md). The QA vault seeds
// `Notes/Dock board.md`: a legacy board fence with two cards far apart,
// "Thinking" (a1) and "Writing" (b1). Opening its preview writes the
// `.board.svg` and opens the board full screen.
import { ok } from "node:assert/strict";
import { invoke, waitForTitle, workspaceRoot } from "./_helpers.js";

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

/** In-page pointer driving for the board. The WebDriver plugin sends no
 *  pointer events, and a synthetic pointer can't be captured, so capture is
 *  stubbed on the board's svg. */
function installBoardDrag() {
  const svg = () => document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
  const rect = (id) =>
    document.querySelector(`.wr-board-fullscreen [data-el="${id}"]`).getBoundingClientRect();
  const send = (type, x, y) =>
    svg().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
  window.__board = {
    rect,
    send,
    /** Presses on `from` and moves it in one step to rest `gap` (scene units)
     *  under `onto`; resolves with the pointer position. One move: the board
     *  handles the first move of a gesture at once and coalesces later ones
     *  to animation frames, which the hidden e2e window barely runs (its
     *  pointerup applies the last one). */
    dragNear(from, onto, gap) {
      const el = svg();
      el.setPointerCapture = () => {};
      el.releasePointerCapture = () => {};
      const a = rect(onto);
      const b = rect(from);
      const zoom = a.width / 180;
      const start = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const end = { x: a.left + a.width / 2, y: a.bottom + gap * zoom + b.height / 2 };
      send("pointerdown", start.x, start.y);
      send("pointermove", end.x, end.y);
      return end;
    },
  };
}

async function openDockBoard() {
  await openBoard("Dock board", "a1", "b1");
}

/** Opens `note`'s board full screen and waits for it to settle; `last` is an
 *  element that shows once the scene is drawn, `still` one that stops moving
 *  once the board has fitted itself to the window. */
async function openBoard(note, still, last) {
  // A board left open full screen covers the note: close it first (Escape
  // clears a selection, then closes the board).
  await browser.execute(() => {
    const host = document.querySelector(".wr-board-fullscreen .wr-board-host");
    for (let i = 0; i < 3 && host?.isConnected; i++) {
      host.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    }
  });
  await $(".wr-board-fullscreen").waitForExist({ timeout: 5_000, reverse: true });
  await openNote(note);
  // A board not yet opened previews as its fence (a card to click); once
  // opened it is a `.board.svg` image with an **Open board** button.
  const card = await $(".wr-board-card, .wr-board-image");
  await card.waitForExist({ timeout: 10_000 });
  if ((await card.getAttribute("class")).includes("wr-board-image")) {
    await browser.execute(() => {
      const open = [...document.querySelectorAll(".wr-board-image-open")].find(
        (b) => b.textContent === "Open board",
      );
      open.click();
    });
  } else await card.click();
  await $(`.wr-board-fullscreen [data-el="${last}"]`).waitForExist({ timeout: 10_000 });
  // The board fits itself to the window as it opens (its is-open class waits
  // on an animation frame, which the hidden window doesn't run): wait until
  // the cards stop moving.
  let fitted = "";
  await browser.waitUntil(
    async () => {
      const now = await browser.execute(
        (id) =>
          JSON.stringify(
            document
              .querySelector(`.wr-board-fullscreen [data-el="${id}"]`)
              .getBoundingClientRect(),
          ),
        still,
      );
      const settled = now === fitted;
      fitted = now;
      return settled;
    },
    { timeout: 10_000, interval: 250, timeoutMsg: "the board never settled after opening" },
  );
  await browser.execute(installBoardDrag);
}

/** The board file behind a note's board line, with its scene unescaped. */
async function boardFile(root, note) {
  const text = await invoke("read_file", { path: `${root}/Notes/${note}.md` });
  // A path with spaces is written in <…>.
  const rel = /\]\(<?([^)>]+\.board\.svg)>?\)/.exec(text.value?.content ?? "")?.[1];
  if (!rel) return "";
  const file = await invoke("read_file", { path: `${root}/Notes/${decodeURI(rel)}` });
  return (file.value?.content ?? "").replaceAll("&quot;", '"');
}

/** Where the section's title strip is on screen: just above its box. */
function sectionTitlePoint(id) {
  const box = document
    .querySelector(`.wr-board-fullscreen [data-el="${id}"] rect`)
    .getBoundingClientRect();
  return { x: box.left + 12, y: box.top - 8 };
}

async function openSectionBoard() {
  await openBoard("Section board", "s1", "f1");
  await browser.execute(() => {
    const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
    svg.setPointerCapture = () => {};
    svg.releasePointerCapture = () => {};
  });
}

describe("Journeys: boards", function () {
  let root;

  before(async function () {
    root = await workspaceRoot();
    await $("[data-sidebar-surface-content] [data-sidebar-search-button]").waitForExist({
      timeout: 10_000,
    });
    await $(".app-splash").waitForExist({ timeout: 10_000, reverse: true });
  });

  it("BRD-07 dragging a card near another offers the dock, and dropping docks it", async function () {
    await openDockBoard();
    const end = await browser.execute(() => window.__board.dragNear("b1", "a1", 60));

    // Offered: the card's imprint where it lands, the arrow it will get, and
    // the lit card glowing with its port.
    const offered = await browser.execute(() => {
      const g = document.querySelector(".wr-board-fullscreen .wr-board-glow.is-offer");
      if (!g) return null;
      return {
        imprints: g.querySelectorAll(".wr-board-imprint").length,
        arrows: g.querySelectorAll(".wr-board-glow-preview .wr-board-glow-line").length,
        halos: g.querySelectorAll(".wr-board-glow-halo").length,
        ports: g.querySelectorAll(".wr-board-glow-dot").length,
        bolt: document.querySelectorAll(".wr-board-spark").length,
      };
    });
    ok(offered, "no dock was offered");
    ok(offered.imprints === 1, `expected 1 imprint, got ${offered.imprints}`);
    ok(offered.arrows === 1, `expected 1 previewed arrow, got ${offered.arrows}`);
    ok(offered.halos === 2, `expected halos on the lit card and the imprint, got ${offered.halos}`);
    ok(offered.ports === 1, `expected 1 port, got ${offered.ports}`);
    ok(offered.bolt === 0, "the old docking bolt is still drawn");

    // Dropped: one arrow, the offer gone, and in the file the card sits in the
    // slot after the lit one (Thinking is 180 wide at 0,0; the slot is 80
    // past it, centred on it), joined by the arrow from Thinking into Writing.
    // The glide onto the slot is drawn on animation frames, which the hidden
    // window doesn't run, so the place is read from the file.
    await browser.execute((p) => window.__board.send("pointerup", p.x, p.y), end);
    const after = await browser.execute(() => ({
      arrows: document.querySelectorAll('.wr-board-fullscreen [data-type="arrow"]').length,
      offer: !!document.querySelector(".wr-board-fullscreen .wr-board-glow.is-offer"),
    }));
    ok(after.arrows === 1, `expected 1 arrow after the drop, got ${after.arrows}`);
    ok(!after.offer, "the offered dock is still drawn after the drop");

    const note = await invoke("read_file", { path: `${root}/Notes/Dock board.md` });
    // A path with spaces is written in <…>.
    const rel = /\]\(<?([^)>]+\.board\.svg)>?\)/.exec(note.value?.content ?? "")?.[1];
    ok(rel, "the note has no board image line");
    await browser.waitUntil(
      async () => {
        const file = await invoke("read_file", { path: `${root}/Notes/${decodeURI(rel)}` });
        // The scene sits XML-escaped in the file's <metadata>.
        const svg = (file.value?.content ?? "").replaceAll("&quot;", '"');
        return (
          /"id":"b1","t":"roundRect","x":260,"y":0\b/.test(svg) &&
          /"b1":\{"el":"a1"/.test(svg) &&
          /"b2":\{"el":"b1"/.test(svg)
        );
      },
      { timeout: 10_000, timeoutMsg: "the docked card and its arrow never reached the board file" },
    );
  });

  it("BRD-08 a board offers no sticky note or mind map tool, and N and M do nothing", async function () {
    if (!(await $(".wr-board-fullscreen").isExisting())) await openDockBoard();
    // The tools' labels, from the Dock (or the plain rail while it loads).
    const labels = () =>
      browser.execute(() =>
        [
          ...document.querySelectorAll(
            ".wr-board-fullscreen [aria-label], .wr-board-fullscreen [title]",
          ),
        ]
          .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("title"))
          .filter(Boolean),
      );
    await browser.waitUntil(async () => (await labels()).some((l) => /^Pen\b/.test(l)), {
      timeout: 10_000,
      timeoutMsg: "the board's tools never showed",
    });
    const offered = (await labels()).filter((l) => /sticky|mind map/i.test(l));
    ok(offered.length === 0, `still offered: ${offered.join("; ")}`);

    // T still picks Text (the keys are live); N and M pick nothing. With a
    // card selected, a letter types into it instead, so clear the selection
    // first (Escape clears it; with nothing selected it would close the board).
    const tools = await browser.execute(() => {
      const host = document.querySelector(".wr-board-fullscreen .wr-board-host");
      for (let i = 0; i < 2 && host.querySelector(".wr-board-selbox"); i++) {
        host.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      }
      const press = (key) => {
        host.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        return host.dataset.tool;
      };
      const out = { t: press("t"), v: press("v"), n: press("n"), m: press("m") };
      return out;
    });
    ok(tools.t === "text", `T picked ${tools.t}, not Text`);
    ok(tools.n === "select" && tools.m === "select", `N and M picked ${tools.n} and ${tools.m}`);
  });

  it("BRD-09 double-clicking a section's name renames it in place", async function () {
    await openSectionBoard();
    const field = await browser.execute(
      (p) => {
        document
          .querySelector(".wr-board-fullscreen svg.wr-board-svg")
          .dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true, clientX: p.x, clientY: p.y, detail: 2 }),
          );
        const area = document.querySelector(".wr-board-fullscreen .wr-board-text-editor");
        return area ? { value: area.value, top: area.getBoundingClientRect().top } : null;
      },
      await browser.execute(sectionTitlePoint, "f1"),
    );
    ok(field, "no field opened on the section's name");
    ok(field.value === "Plan", `the field holds "${field.value}", not the name`);

    const title = await browser.execute(() => {
      const area = document.querySelector(".wr-board-fullscreen .wr-board-text-editor");
      area.value = "Launch";
      area.dispatchEvent(new Event("input", { bubbles: true }));
      area.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      return {
        open: !!document.querySelector(".wr-board-fullscreen .wr-board-text-editor"),
        text: document.querySelector('.wr-board-fullscreen [data-el="f1"] [data-frame-title]')
          ?.textContent,
      };
    });
    ok(!title.open, "Enter left the field open");
    ok(title.text === "Launch", `the section reads "${title.text}"`);
    await browser.waitUntil(
      async () => /"id":"f1"[^}]*"name":"Launch"/.test(await boardFile(root, "Section board")),
      {
        timeout: 10_000,
        timeoutMsg: "the new name never reached the board file",
      },
    );
  });

  it("BRD-10 a selected section takes a colour from the toolbar", async function () {
    if (!(await $('.wr-board-fullscreen [data-el="f1"]').isExisting())) await openSectionBoard();
    await browser.execute(
      (p) => {
        const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
        for (const type of ["pointerdown", "pointerup"]) {
          svg.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: p.x,
              clientY: p.y,
            }),
          );
        }
      },
      await browser.execute(sectionTitlePoint, "f1"),
    );
    const trigger = await $('.wr-board-fullscreen button[aria-label="Section colour"]');
    await trigger.waitForExist({ timeout: 5_000 });
    // Radix's popover (unlike its menus) opens on click.
    await browser.execute(() =>
      document.querySelector('.wr-board-fullscreen button[aria-label="Section colour"]').click(),
    );
    const green = await $('[aria-label="Fill: Green"]');
    await green.waitForExist({ timeout: 5_000 });
    await green.click();
    const fill = await browser.execute(
      () =>
        document.querySelector('.wr-board-fullscreen [data-el="f1"] rect')?.getAttribute("fill") ??
        "",
    );
    ok(/wr-board-green/.test(fill), `the section is filled with ${fill}, not green`);
    // Close the colour popover (Radix listens for Escape on the document).
    await browser.execute(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await browser.waitUntil(
      async () => /"id":"f1"[^}]*"c":"green-soft"/.test(await boardFile(root, "Section board")),
      {
        timeout: 10_000,
        timeoutMsg: "the section's colour never reached the board file",
      },
    );
  });

  it("BRD-11 dragging a section by its name carries everything inside it", async function () {
    await openSectionBoard();
    const moved = await browser.execute(
      (p) => {
        const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
        const where = (id) =>
          document.querySelector(`.wr-board-fullscreen [data-el="${id}"]`).getBoundingClientRect();
        const before = Object.fromEntries(["f1", "s1", "s2", "out"].map((id) => [id, where(id)]));
        const send = (type, x, y) =>
          svg.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: x,
              clientY: y,
            }),
          );
        send("pointerdown", p.x, p.y);
        send("pointermove", p.x + 120, p.y + 90);
        send("pointerup", p.x + 120, p.y + 90);
        const shift = (id) => {
          const now = where(id);
          return [Math.round(now.left - before[id].left), Math.round(now.top - before[id].top)];
        };
        return { f1: shift("f1"), s1: shift("s1"), s2: shift("s2"), out: shift("out") };
      },
      await browser.execute(sectionTitlePoint, "f1"),
    );
    ok(moved.f1[0] !== 0 || moved.f1[1] !== 0, "the section did not move");
    for (const id of ["s1", "s2"]) {
      ok(
        Math.abs(moved[id][0] - moved.f1[0]) <= 1 && Math.abs(moved[id][1] - moved.f1[1]) <= 1,
        `${id} moved ${moved[id]} while the section moved ${moved.f1}`,
      );
    }
    ok(moved.out[0] === 0 && moved.out[1] === 0, `the card outside moved ${moved.out}`);
    await browser.waitUntil(
      async () => {
        const svg = await boardFile(root, "Section board");
        return (
          /"id":"s1"[^}]*"fr":"f1"/.test(svg) &&
          !/"id":"s1","t":"roundRect","x":60,"y":100/.test(svg)
        );
      },
      { timeout: 10_000, timeoutMsg: "the moved cards never reached the board file" },
    );
  });
});
