# Worksheet: HTML File Embed

## Task

- User request: "can i embed a html file in one of the block? is it possible? if not, make one. use prd skill though for this"
- Spec (PRD form): `SPECs/html-file-embed-spec.md`
- TODO: `HTML file embed`

## Reviewed

- `CLAUDE.md`, `docs/editor.md`, `docs/workflows/agent-loop.md`, `docs/consolidation.md`
- `SPECs/obsidian-image-embed-spec.md`, `SPECs/inline-media-preview-spec.md`
- `apps/desktop/src/components/editor-area/html-block-decorations.ts` — inline HTML blocks are sanitized with DOMPurify; `iframe` is not in the allow list, so `<iframe src="x.html">` is stripped.
- `apps/desktop/src/components/editor-area/wiki-link-extension.ts` — `![[...]]` handling; only image extensions render as embeds, everything else falls back to a link widget with a stray `!`.
- `apps/desktop/src/lib/wiki-links.ts` — embed target parsing and resolution.
- `apps/desktop/src/components/editor-area/mermaid-decorations.ts`, `mermaid-canvas.css` — framed fixed-height widget pattern, `ignoreEvent`, `updateDOM` keep-DOM pattern, button styling.
- `apps/desktop/src/components/editor-area/slash-menu.ts` — item shape, `insertRun`.
- `apps/desktop/src-tauri/tauri.conf.json` — CSP has no `frame-src`, so `default-src 'self'` blocks `asset://` frames. Asset scope is `**`.
- `apps/desktop/src-tauri/src/watcher.rs` — `fs:file-changed` is emitted for any file path, not only `.md`, so an HTML file save can drive a reload.
- `apps/desktop/src/lib/tauri.ts` — `pickFile` was hard-wired to markdown filters.

## Findings

- Embedding an HTML file is not possible today by either route (inline `<iframe>`, `![[file.html]]`).
- The wiki-link decorations are a `ViewPlugin`, which cannot emit block decorations, so the frame has to be an inline-replace widget (inline-block span at 100% width), the shape the image embed already uses.
- A sandboxed frame without `allow-same-origin` runs with an opaque origin: it cannot touch the parent document and fails Tauri's IPC origin check. This is the security boundary; auto-height measurement is not possible across it, hence the `|N` height modifier plus a drag handle.

## Plan

- `lib/wiki-links.ts`: `parseWikiHtmlEmbedTarget`, `withWikiEmbedHeight`, `findWikiLinkAt` (the token regex moves here so the extension and the widget share one scanner), rename `resolveWikiImage` → `resolveWikiEmbed`.
- New `wiki-embed-resolver.ts`: the positive-only resolution cache, shared by image and HTML widgets.
- New `html-embed-widget.ts` + `html-embed.css`: frame, header buttons, sandboxed iframe, drag-to-resize writing the modifier back, live reload from `fs:file-changed`, placeholder for unresolved targets.
- `wiki-link-extension.ts`: route HTML targets to the new widget.
- `slash-menu.ts`: `/html` picks a file and inserts the embed.
- `tauri.conf.json`: `frame-src asset: https://asset.localhost`.
- Tests in `tests/wiki-links.test.ts` for parsing, rewrite, and token lookup.

## Results

- Implemented as planned; `vp check` and `vp test` (745 tests) pass.
- Verified in the built app (`scripts/ship-local.sh`, compact window on a scratch vault): the frame renders with header and page, `|150` sets the height, `|abc` falls back to the default, a missing file shows the raw text plus "file not found", an embed inside a fenced code block stays raw, and an inline `<iframe>` still renders as source. The embedded page logged `parent blocked: SecurityError`, `tauri internals: undefined` and `top nav blocked`, confirming the sandbox.
- Not exercised by hand (no input automation available in this session): the drag-to-resize write-back, the header buttons, `/html` file picking, and the HTML-file live reload. Their pure parts are unit-tested (`withWikiEmbedHeight`, `findWikiLinkAt`).
