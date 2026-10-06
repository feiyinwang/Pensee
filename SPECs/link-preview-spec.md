# Link Preview Spec

## Summary

Pasting a link onto a line of its own shows the linked page itself, live, in a frame in the editor. The markdown stays a plain URL, so the file reads the same in any other editor.

## Rules

- A preview appears for any line in a top-level paragraph whose whole text is an `http(s)` URL, bare or in `<…>`. That is what pasting a link onto an empty line gives, and it also covers links already in a document.
- A URL with other text on its line, a `[text](url)` link, and URLs inside list items or block quotes keep rendering as links.
- The frame is the column's width and a fixed 480px tall plus a 32px header (favicon, page title, host, Reload, Open in browser). The size never changes as the page loads, so the text below does not jump. The page scrolls and works inside the frame.
- With the caret elsewhere the frame replaces the line. Clicking the header selects the line, which shows the URL source with the frame beneath it, the same unfold images use.
- Sites that forbid framing (`X-Frame-Options`, or a CSP `frame-ancestors` list without `*` — GitHub, Google, X and many others) would show a blank box. For those the frame shows the site's own summary instead: preview image, title, description, a line saying the site doesn't allow being shown inside other apps, and an Open in browser button.
- If the header check itself fails (offline, bot wall, error status), the frame tries to load the page anyway; the engine's own error page is the honest answer.

## Implementation

- `fetch_link_preview` (`src-tauri/src/commands/link_preview.rs`) fetches the page in Rust (the webview's CSP blocks cross-origin `fetch`), decides `embeddable` from the response headers (`frame_allowed`), reads at most 512 KB or up to `</head>`, and parses Open Graph → Twitter → plain `<title>` / `description` tags plus the icon link. Only `http` and `https` are accepted.
- `link-preview.ts` registers a `foldableSyntaxFacet` spec on `Document/Paragraph` that decides per line, and caches one request per URL for the life of the app (failures included).
- The CSP's `frame-src` now allows `https:` and `http:`.
- The iframe is sandboxed `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox` with `referrerpolicy="no-referrer"`. The page keeps its own origin so logins and scripts work; that origin is never the editor's, so it cannot reach the editor document or Tauri IPC (remote origins have no capabilities). No `allow-top-navigation`, so it cannot navigate the Writer window.

## Privacy

Showing a preview means Writer loads the linked page (and its image and favicon) from that site, as a browser would, including the site's own scripts and cookies inside the frame. Nothing else is sent.

## Follow-ups

- A setting to turn previews off, or per-link "show as plain link".
- Drag to resize the frame (needs somewhere portable to store the height for a bare URL).
- Previews inside list items.
- Moving the caret onto the line rebuilds the widget, which reloads the page.
