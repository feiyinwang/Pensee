import { ok, strictEqual } from "node:assert/strict";

// Library covers from the web (SPECs/spaces-spec.md, "Covers from the web").
// Needs a workspace seeded with the notes made in `before` and network access.

async function invoke(command, args) {
  return browser.executeAsync(
    (cmd, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmd, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args ?? {},
  );
}

const VIDEO = (link, cover = "") =>
  `---\nType: YouTube\nCover: ${cover}\nLink: ${link}\n---\nbody\n`;

describe("Library covers", function () {
  let root;

  before(async function () {
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    const recents = await invoke("get_recent_workspaces");
    ok(recents.ok, `recent workspaces failed: ${recents.error}`);
    root = typeof recents.value[0] === "string" ? recents.value[0] : recents.value[0].path;
    const files = {
      "Covers/Linked video.md": VIDEO("https://www.youtube.com/watch?v=k4dVgbuxBAw&t=735s"),
      "Covers/Short link.md": VIDEO("https://youtu.be/WUq8Pun28FI"),
      "Covers/Has cover.md": VIDEO(
        "https://www.youtube.com/watch?v=lU-LLtrOpKM",
        "https://img.youtube.com/vi/lU-LLtrOpKM/sddefault.jpg",
      ),
      "Covers/No link.md": VIDEO(""),
      "Covers/Huberman Lab.md":
        "---\nType: Podcast\nurl: https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110\n---\n",
    };
    const stale = await invoke("file_exists", { path: `${root}/Covers` });
    if (stale.ok && stale.value) await invoke("delete_entry", { path: `${root}/Covers` });
    await invoke("create_directory", { path: `${root}/Covers` });
    for (const [name, text] of Object.entries(files)) {
      const r = await invoke("write_file", { path: `${root}/${name}`, content: text });
      ok(r.ok, `write ${name}: ${r.error}`);
    }
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
  });

  it("shows YouTube thumbnails live and saves them on Get cover", async function () {
    await $('[data-space-key="library"]').click();
    await $('button[data-value="videos"]').click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('[data-cover="video"] img').length,
        )) === 3,
      { timeout: 10_000, timeoutMsg: "expected three video cover images" },
    );
    const srcs = await browser.execute(() =>
      [...document.querySelectorAll('[data-cover="video"] img')].map((img) => img.src).sort(),
    );
    ok(srcs.includes("https://i.ytimg.com/vi/k4dVgbuxBAw/hqdefault.jpg"), srcs.join("\n"));
    ok(srcs.includes("https://i.ytimg.com/vi/WUq8Pun28FI/hqdefault.jpg"), srcs.join("\n"));
    // Only the two linked notes without a Cover can get one.
    strictEqual((await $$('button[aria-label="Get cover"]')).length, 2);
    await browser.saveScreenshot(process.env.COVER_SHOT ?? "/tmp/library-videos.png");

    // Nothing was written by showing them.
    const before = await invoke("read_file", { path: `${root}/Covers/Linked video.md` });
    ok(before.value.content.includes("Cover: \n"), before.value.content);

    await $("button=Get covers").click();
    await browser.waitUntil(
      async () => {
        const r = await invoke("read_file", { path: `${root}/Covers/Short link.md` });
        return r.ok && r.value.content.includes("Cover: Short link-assets/cover.jpg");
      },
      { timeout: 20_000, timeoutMsg: "Short link.md never got its Cover" },
    );
    const linked = await invoke("read_file", { path: `${root}/Covers/Linked video.md` });
    strictEqual(
      linked.value.content,
      VIDEO("https://www.youtube.com/watch?v=k4dVgbuxBAw&t=735s", "Linked video-assets/cover.jpg"),
    );
    const saved = await invoke("file_exists", {
      path: `${root}/Covers/Linked video-assets/cover.jpg`,
    });
    ok(saved.ok && saved.value, "cover.jpg was not saved");
    const kept = await invoke("read_file", { path: `${root}/Covers/Has cover.md` });
    ok(kept.value.content.includes("sddefault.jpg"), "an existing cover was replaced");
  });

  it("gets a podcast's artwork from its page", async function () {
    await $('button[data-value="podcasts"]').click();
    const button = await $('button[aria-label="Get cover"]');
    await button.waitForExist({ timeout: 10_000 });
    await button.click();
    await browser.waitUntil(
      async () => {
        const r = await invoke("read_file", { path: `${root}/Covers/Huberman Lab.md` });
        return r.ok && r.value.content.includes("Cover: Huberman Lab-assets/cover.jpg");
      },
      { timeout: 20_000, timeoutMsg: "the podcast never got its Cover" },
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('[data-cover="podcast"] img').length,
        )) === 1,
      { timeout: 10_000, timeoutMsg: "the saved podcast cover is not shown" },
    );
    await browser.saveScreenshot(process.env.PODCAST_SHOT ?? "/tmp/library-podcasts.png");
  });
});
