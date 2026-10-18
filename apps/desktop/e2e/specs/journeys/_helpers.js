// Shared helpers for the user-journey specs (docs/qa/user-journeys.md).
// Journeys act the way a user does: real WebDriver clicks on what is on
// screen. IPC (`invoke`) is only for arranging and checking files on disk.

export async function invoke(command, args) {
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

/** A key press with modifiers, dispatched to the document like the global
 *  hook expects. `inFocus` sends it to the focused element instead, so the
 *  editor's own keymap sees it first, as a real press would. `code` is the
 *  physical key, which the go key (⌘G) matches on. */
export async function pressKey(
  key,
  { meta = false, ctrl = false, shift = false, alt = false, code, inFocus = false } = {},
) {
  await browser.execute(
    (pressedKey, mods, keyCode, inFocus) => {
      (inFocus ? (document.activeElement ?? document) : document).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressedKey,
          ...(keyCode ? { code: keyCode } : {}),
          metaKey: mods.meta,
          ctrlKey: mods.ctrl,
          shiftKey: mods.shift,
          altKey: mods.alt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    { meta, ctrl, shift, alt },
    code ?? null,
    inFocus,
  );
}

/** A Cmd+key shortcut (see `pressKey`). */
export async function pressCmd(key, { shift = false, alt = false, inFocus = false } = {}) {
  await pressKey(key, { meta: true, shift, alt, inFocus });
}

/** Wait for the restored QA vault and return its root. */
export async function workspaceRoot() {
  await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 20_000 });
  const recents = await invoke("get_recent_workspaces");
  if (!recents.ok) throw new Error(`get_recent_workspaces failed: ${recents.error}`);
  const first = recents.value[0];
  return typeof first === "string" ? first : first.path;
}

export async function fileExists(path) {
  return (await invoke("file_exists", { path })).value === true;
}

export async function waitForFile(path, timeout = 5_000) {
  await browser.waitUntil(() => fileExists(path), {
    timeout,
    timeoutMsg: `expected ${path} to exist`,
  });
}

const FRONT_TITLE = () => {
  const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
  return [...scope.querySelectorAll("[data-page-title]")].find((el) => el.offsetParent) ?? null;
};

/** The title field of the note in front (the focused column when tabs show
 *  as columns), tagged so WebDriver can address it. */
export async function frontTitleField() {
  await browser.execute(`
    document.querySelectorAll("[data-qa-front-title]").forEach((el) => el.removeAttribute("data-qa-front-title"));
    (${FRONT_TITLE.toString()})()?.setAttribute("data-qa-front-title", "");
  `);
  return $("[data-qa-front-title]");
}

/** The page title (file stem) of the note in front. */
export async function activeTitle() {
  return browser.execute(`return (${FRONT_TITLE.toString()})()?.value ?? null;`);
}

export async function waitForTitle(title, timeout = 5_000) {
  await browser.waitUntil(async () => (await activeTitle()) === title, {
    timeout,
    timeoutMsg: `expected the note in front to be "${title}" (got "${await activeTitle()}")`,
  });
}

/** Local `YYYY-MM-DD`, matching formatDailyNoteDate. */
export function dayStamp(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Type into a React-controlled input or textarea: the native value setter
 *  plus an `input` event, which is what React listens for. */
export async function fillField(selector, text) {
  await browser.execute(
    (sel, value) => {
      const field = document.querySelector(sel);
      if (!field) throw new Error(`no field ${sel}`);
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    text,
  );
}

/** Type text at the caret of the editor in front, as the keyboard would
 *  (CodeMirror reads it from the input event). */
export async function typeInEditor(text, { atEnd = true } = {}) {
  await browser.execute(
    (value, toEnd) => {
      const editor = [
        ...(document.querySelector("[data-column-tab][data-focused]") ?? document).querySelectorAll(
          ".cm-content",
        ),
      ].find((el) => el.offsetParent);
      if (!editor) throw new Error("no editor in front");
      editor.focus();
      if (toEnd) {
        const range = document.createRange();
        range.selectNodeContents(editor.lastElementChild ?? editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand("insertText", false, value);
    },
    text,
    atEnd,
  );
}

/** Click the way a mouse does: pointer/mouse down, up and click at the
 *  element's centre. The plugin's own click carries no coordinates, and
 *  CodeMirror handlers (links) resolve their target from them. */
export async function mouseClick(element, { metaKey = false } = {}) {
  await browser.execute(
    (el, meta) => {
      el.scrollIntoView({ block: "center" });
      const box = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        metaKey: meta,
      };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mousedown", at));
      el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mouseup", at));
      el.dispatchEvent(new MouseEvent("click", at));
    },
    element,
    metaKey,
  );
}

/** Put the caret right after `text` in the front editor with a real mouse
 *  click at its coordinates (the e2e window is never focused, so CodeMirror
 *  ignores a scripted DOM selection). Same as pen.spec.js's. */
export async function caretAfter(text) {
  await browser.execute((needle) => {
    const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    const line = [...editor.querySelectorAll(".cm-line")].find((l) =>
      l.textContent.includes(needle),
    );
    if (!line) throw new Error(`no line with "${needle}"`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + needle.length - 1);
      range.setEnd(node, at + needle.length);
      // Low in the window: a video note's sticky player covers the top, the
      // bottom bar the last few lines.
      let scroller = line.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      // Somewhere the click lands on the line itself, not under a sticky
      // video at the top or the bottom bar.
      const hits = () => {
        const r = range.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right - 1, r.top + r.height / 2);
        return !!hit && line.contains(hit);
      };
      for (const ratio of [0.75, 0.5, 0.6, 0.4]) {
        if (!scroller) break;
        const lineTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += lineTop - scroller.clientHeight * ratio;
        if (hits()) break;
      }
      const box = range.getBoundingClientRect();
      const point = {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        clientX: box.right - 1,
        clientY: box.top + box.height / 2,
      };
      const target = document.elementFromPoint(point.clientX, point.clientY) ?? line;
      target.dispatchEvent(new MouseEvent("mousedown", point));
      target.dispatchEvent(new MouseEvent("mouseup", point));
      target.dispatchEvent(new MouseEvent("click", point));
      return;
    }
    throw new Error(`"${needle}" is split across nodes`);
  }, text);
  await browser.pause(150);
}
