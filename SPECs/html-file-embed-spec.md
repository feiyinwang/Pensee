# PRD: HTML File Embed

> Stage: ready to build
> Last updated: 2026-09-02
> Format: PRD (why → how → notes for the coding agent), kept in `SPECs/` like every other feature spec.

## 1. Why

### Who this is for

People who keep a local-first vault (Obsidian, a docs repo, a personal wiki) and who also produce small HTML files: a chart exported from a notebook, a d3 or Observable snippet, a hand-written interactive demo, a report someone sent them, a design mock. They want that file to show up _inside_ the note that talks about it, not as a link they have to leave the editor to follow.

### Scenario

I write up an experiment in `notes/latency.md`. The plotting script drops `notes/assets/latency.html` (a Plotly page). Today I type `![[assets/latency.html]]` and Pensée shows me a bare link with a stray `!` in front of it. If I paste `<iframe src="assets/latency.html">` the sanitizer deletes the tag and I get an empty gap. Either way I open the file in a browser next to the editor and alt-tab between them.

### Need

- Put an HTML file in a note the same way I put an image in.
- See it rendered and interactive (its own scripts run: hover on a chart, click a button in a demo).
- Keep the note plain markdown that Obsidian and git still read.
- Not let a random HTML file reach into the editor, the workspace, or the Tauri backend.

### Evidence

🟡 Own observation plus the user's request. No survey. The existing image embed spec proves the `![[file]]` mental model is already in the product, and the Mermaid canvas and board widgets prove readers accept a fixed-height framed block in the flow of the note.

### What success looks like

- A `.html` file next to a note renders inside the note in one keystroke sequence (`/html` or typing `![[...]]`).
- Editing the HTML file in another app updates the embed without touching the note.
- Nothing in the embedded page can read the note, call an IPC command, or navigate the editor window.

## 2. How

### Scope (v1)

In:

- `![[page.html]]`, `![[page.htm]]`, `![[folder/page.html]]`, resolved with the same rules as image embeds (workspace-relative first for paths with `/`, then note-relative, bare basenames fall back to the workspace basename search).
- `![[page.html|480]]` sets the frame height in pixels. No modifier means the default height.
- A framed block: thin header with the file name and three buttons (Reload, Open in browser, Edit source), a sandboxed `<iframe>` under it, and a drag handle on the bottom edge to change the height. Dragging writes the new height back into the source text as the `|N` modifier.
- Caret on the embed shows the raw `![[...]]` text, same as image embeds. Leaving it re-renders.
- Unresolved target renders a muted placeholder with the raw text and "file not found".
- `/html` in the slash menu opens a file picker filtered to `.html`/`.htm` and inserts the embed with a path relative to the workspace (or the note, when the file is outside the workspace).
- The embed reloads itself when the file watcher reports the HTML file changed.

Out (explicitly not doing now):

- `<iframe src>` inside inline HTML blocks. One write path: `![[...]]` is how a file gets embedded. Allowing `iframe` through the sanitizer would also allow remote URLs, which is a different feature with different risks.
- Remote URLs (`![[https://...]]`).
- Auto-sizing the frame to its content. A sandboxed cross-origin frame cannot be measured from outside, and a postMessage protocol would require the HTML file to cooperate.
- Width modifiers, alignment, captions.
- Rendering the embed in the block handle menu as its own block type (it is inline replace, like images).
- Windows path handling beyond what the image embed already does.

### Core flow

1. User types `/html`, picks `assets/latency.html`. The editor inserts `![[assets/latency.html]]` on its own line and the caret lands after it.
2. Because the caret is outside the `![[...]]` range, the extension replaces it with the frame. The frame header shows `latency.html`. The iframe loads the file through the Tauri asset protocol.
3. User drags the bottom edge to make it taller. On release the source becomes `![[assets/latency.html|620]]`. One `Cmd+Z` restores the old height.
4. User regenerates the file from their notebook. The watcher fires, the frame reloads, the note is untouched.
5. User clicks Edit source. The whole `![[...]]` is range-selected, the raw text shows, and they can retype the path.

### Interaction detail

**Frame**

- Header: file name (basename), muted, 12px UI font. Buttons on the right: Reload (↻), Open in browser (↗, uses the system opener), Edit source (`</>`).
- Body: `<iframe>` filling the width of the editor column. Default height 400px. Minimum 120px, maximum 2000px.
- Resize handle: 6px strip on the bottom edge, `cursor: ns-resize`. While dragging, the iframe gets `pointer-events: none` so the page under it cannot steal the pointer. Height is applied live; the source is rewritten once on pointer up, and only if the height changed.
- The frame never places the caret. Clicks inside it are swallowed (`ignoreEvent` returns true), matching the Mermaid canvas.

**States**

- Resolving: the frame shows immediately at the expected height with an empty body, so the height map does not jump when the path resolves.
- Loaded: iframe visible.
- Unresolved (file missing, or the path escapes the sandbox rules): placeholder line with the raw source text and "file not found" in muted text. No frame.
- Widget identity is `(rawText, target, height, workspaceRoot, currentFilePath)`. A height change through the drag rewrites the source, which rebuilds the widget with the new height. Widgets that are `eq` keep their DOM, so the iframe is not reloaded by unrelated typing above it.

**Security model**

- `sandbox="allow-scripts allow-forms"`. Deliberately no `allow-same-origin`, so the page runs with an opaque origin: it cannot read the parent document, cannot reach `localStorage` shared with the app, and Tauri's IPC origin check rejects it. No `allow-top-navigation`, so the page cannot redirect the editor window. No `allow-popups`; links with `target=_blank` are inert.
- CSP gains `frame-src asset: https://asset.localhost`. Without it `default-src 'self'` blocks the frame. Nothing else in the CSP changes.
- The asset protocol scope is already `**`, so any local file the user names can load. Same trust boundary as images today.

**Slash menu item**

- Label "HTML file", aliases `html`, `iframe`, `embed`, `web`. Section "Insert".
- Opens the native file dialog filtered to `html, htm`. Cancel leaves the note unchanged except that the `/html` query is removed (same as picking the item and typing nothing).
- Inserted path: workspace-relative when the file is under the workspace root, otherwise note-relative (`../shared/demo.html`). In a compact window with no workspace, note-relative.

**Live reload**

- One module-level listener on `fs:file-changed`, registered lazily when the first embed mounts. A registry maps absolute path → mounted iframes. On `modified` or `created` for a path in the registry, the frame reloads by reassigning `src`. Entries are removed in the widget's `destroy`.

### Files that change

- `apps/desktop/src/lib/wiki-links.ts` — `parseWikiHtmlEmbedTarget` (path + height), `withWikiEmbedHeight` (rewrite the modifier), `resolveWikiImage` renamed to `resolveWikiEmbed` since it is not image-specific.
- `apps/desktop/src/components/editor-area/html-embed-widget.ts` (new) — widget, frame DOM, resize, reload registry, CSS.
- `apps/desktop/src/components/editor-area/wiki-link-extension.ts` — route `![[x.html]]` to the new widget; share the match-at-position helper for Edit source.
- `apps/desktop/src/components/editor-area/slash-menu.ts` — `/html` item.
- `apps/desktop/src/lib/tauri.ts` — `pickFile` takes an optional filter list; `openPath` for Open in browser if not already present.
- `apps/desktop/src-tauri/tauri.conf.json` — `frame-src`.
- `apps/desktop/tests/wiki-links.test.ts` — parse and rewrite tests.
- `docs/editor.md` — a short note on sandboxed frames and the CSP line.

## 3. Notes for the coding agent

### Technical assumptions

- The wiki-link decorations are a `ViewPlugin`, which may not emit block decorations. The frame is therefore an inline-replace widget whose root is a `span` with `display: inline-block; width: 100%`, exactly the shape the image embed uses. It sits alone on its line in practice.
- Positions are never stored on the widget. Edit source and the resize write-back find the `![[...]]` range live from `view.posAtDOM(wrapper)` and a regex scan of that line.
- `convertFileSrc` produces an `asset://localhost/...` URL on macOS. Relative sub-resources in the HTML file (`./style.css`, `./data.json`) resolve against that URL and load through the same protocol. `fetch()` from inside the page is subject to the frame's opaque origin and may fail; that is accepted for v1.
- Do not add `iframe` to the inline-HTML sanitizer allow list.

### Data model

There is no new state. The whole feature is a function of the note text:

```
![[<path>]]             → height = 400
![[<path>|<height>]]    → height = clamp(int, 120, 2000)
```

Anything after the height (a second `|` segment) is ignored, not rejected, so a future alias slot does not break old notes.

### Acceptance criteria

```
HTML embed
──────────────────────────────
Rendering
✅ `![[demo.html]]` with demo.html next to the note → framed iframe, header shows "demo.html", height 400px
✅ `![[assets/demo.html|600]]` → frame height 600px
✅ `![[demo.html|abc]]` → default height, no error
✅ `![[missing.html]]` → muted placeholder with the raw text and "file not found"
✅ `![[demo.html]]` inside a fenced code block → raw text, no frame
✅ `![[Some Note]]`, `![[image.png]]` → unchanged behaviour

Editing
✅ Caret moved into the range → raw source text, frame gone; caret moved out → frame back
✅ Edit source button → whole `![[...]]` range-selected and shown as source
✅ Drag bottom edge from 400 to ~620 and release → source reads `![[demo.html|620]]`; Cmd+Z restores `![[demo.html]]`
✅ Drag and release without moving → source unchanged, no history entry

Slash menu
✅ `/html` → item "HTML file" listed; Enter opens a file dialog filtered to html/htm
✅ Pick a file under the workspace → `![[<relative path>]]` inserted, caret after it
✅ Cancel the dialog → `/html` query removed, nothing inserted

Safety
✅ Embedded page running `window.parent.document` → throws (cross-origin), editor unaffected
✅ Embedded page calling `window.__TAURI_INTERNALS__.invoke` → undefined or rejected
✅ Embedded page setting `top.location` → blocked by sandbox
✅ Inline `<iframe src="x.html">` in the note body → still stripped

Live reload
✅ Overwrite demo.html on disk while the note is open → frame reloads within the watcher's debounce, note text unchanged
```

## 4. Decisions

- 2026-09-02 — Syntax is `![[file.html]]`, not `<iframe>`. Reason: one write path for local file embeds, matches images, keeps the sanitizer closed to frames of any origin.
- 2026-09-02 — Fixed height with a `|N` modifier and a drag handle, not auto-height. Reason: opaque-origin frames cannot be measured; a cooperative postMessage protocol would only work for files the user authored.
- 2026-09-02 — `sandbox` without `allow-same-origin`. Reason: this is the property that keeps the page out of the app's origin and off the Tauri IPC bridge. Pages that need same-origin (rare) are out of scope.

## 5. Change log

### 2026-09-02

Created. Ready-to-build depth for the whole feature since it is small and the user asked to build it in the same pass.

## 6. Terms

- **Embed**: the `![[...]]` form of a wiki link. The `!` means "show the file here" rather than "link to it".
- **Asset protocol**: Tauri's `asset://` URL scheme that serves local files to the webview under the scope in `tauri.conf.json`.
- **Opaque origin**: the origin a sandboxed frame gets when `allow-same-origin` is absent. It matches nothing, so same-origin checks all fail.
