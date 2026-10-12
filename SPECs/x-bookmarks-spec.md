# X Bookmarks Spec

## Summary

Posts you bookmark on X show up in **Library → Bookmarks** on their own, each as a markdown note holding the author's whole thread, with its photos, videos and GIFs saved in the note's assets folder. Opening one reads the thread as one piece, media in place. Design mock (approved 2026-10-12): https://claude.ai/artifact/NCmAK8d4RBFZjpXmDwYsBB

Why: the user saves threads on X to read and think about later. On X they sit in a list that can't be searched well, can't be annotated, and disappear when the author deletes them.

## Decisions (user, 2026-10-12)

- **Capture:** X's official API (pay-per-use), with the user's own X developer app. Not pasting links, not Readwise.
- **Folder:** `Bookmarks/` at the vault root, changeable in Settings.
- **Media:** everything is saved into the vault, videos included.

## Connecting

The user makes an X developer app once (Native App, OAuth 2.0, type "public client") with the callback `http://127.0.0.1:47863/x/callback`, and pastes its **Client ID** into **Settings → X Bookmarks**. **Connect X** runs the OAuth 2.0 authorization-code flow with PKCE (S256):

1. Rust binds `127.0.0.1:47863`, opens `https://x.com/i/oauth2/authorize` in the browser with scopes `tweet.read users.read bookmark.read offline.access`, and waits up to 5 minutes for the redirect. The `state` must match.
2. The code is exchanged at `https://api.x.com/2/oauth2/token` (form body with `client_id`, no secret).
3. `GET /2/users/me` names the account.

Tokens (access, refresh, expiry, user id, username) are kept in the macOS Keychain (service `Writer X Bookmarks`), never in the vault or the settings file. Access tokens last two hours; a call refreshes first when the token has under a minute left, and X rotates refresh tokens, so the new pair is saved before anything else happens. All X calls go through one lock, so two refreshes never race with the same refresh token. **Disconnect** deletes the Keychain item.

## Sync

While connected, Writer syncs on launch, every 15 minutes while it is open, and on **Sync now**. One sync runs at a time.

1. `GET /2/users/{me}/bookmarks`, newest first, 20 per page, with the author, media and referenced posts expanded. Paging stops at the first post already known, or after 800 (the most X returns).
2. "Known" means a note in the vault has its `ID`, or it was saved before (a list of saved IDs in the app's own settings), so deleting a bookmark note does not bring it back on the next sync.
3. For each new post, oldest first, Rust gathers the thread (below), then the frontend writes the note and Rust downloads its media.

Cost on pay-per-use: X charges each post or user returned once per UTC day, so the 15-minute checks of the same first page cost nothing after the first. The first sync of a few hundred bookmarks is about $1–3.

### Threads

A thread is the author's own chain of replies to themselves.

- The bookmarked post is the root (its `id` is its `conversation_id`) and it has replies → search `conversation_id:<id> from:<author> to:<author>`.
- It is part of someone's conversation (`id` ≠ `conversation_id`) → fetch the root. If the root's author is the same person, search as above; otherwise save just the bookmarked post.
- From the root, keep each post that replies to a post already in the chain, in id order, up to 50 posts.
- Search uses `/2/tweets/search/all` (any age) and falls back to `/2/tweets/search/recent` (last 7 days) when the account can't use it. If both fail, the post is saved alone.

### Text

- Long posts use `note_post` (the full text), else `text`.
- `t.co` links become their real URL; links that only point at the post's own media are removed.
- `&amp;`, `&lt;`, `&gt;` are decoded. A line that would turn into markdown structure (`#`, `>`, `-`, `1.` at its start) is escaped.
- A quoted post becomes a blockquote with its author, text and link.

## The note

`Bookmarks/<Author> – <first words of the post>.md`, a name made the same way as other new pages (`safePageName`; a taken name gets ` 2`).

```markdown
---
Type: Tweet
Author: Lena Park
Handle: lenawrites
URL: https://x.com/lenawrites/status/1844…
ID: "1844…"
Posted: 2026-10-08
Saved: 2026-10-10
Posts: 7
Cover: Lena Park – I wrote…-assets/1-1.jpg
Media: video
---

First post text.

---

Second post text.

![[Lena Park – I wrote…-assets/3-1.mp4]]
```

- Posts are separated by `---` with blank lines around them.
- Media: `![[<stem>-assets/<post>-<n>.<ext>]]`. Photos keep their format; videos and GIFs (which X serves as MP4) save the highest-bitrate MP4. A video's poster is saved too, and the first photo or poster is the note's `Cover`.
- `Media` is `video`, `gif` or `photos` (the kind of the thread's first saved media), with `Duration` (seconds) for a video and `Photos` when a post has several, so the card can label it without reading the body.
- A media file that fails to download is left out of `Cover` and written as a link to the post instead, so the note is still complete.
- Nothing is written into the note after it is created. The user's own notes go below the thread.

## Library

A **Bookmarks** tab after Papers shows `Type: Tweet`, cover kind `tweet` (4:5), on the page's own surface instead of a printed cover colour. The card shows the note's first paragraph (the `excerpt` from `list_typed_notes`, which is now the first paragraph with its line breaks, up to 400 characters, markdown escapes shown as text). With a `Cover` the text stops at 4 lines and the picture sits at the bottom with its label (video length from `Duration`, GIF, or "N photos"); without, the text runs to 11 lines, and a post of 140 characters or less is set large like a quote. Under the card: an initial avatar and the author, then `@handle · Thread · N posts` or `@handle · Post`.

The tab's top line (the same bar as "Get covers") says "Synced with X <time>" with **Sync now**, "Saving bookmarks · 38 of 214" while syncing, the last error when a sync failed, or "Not connected to X" with **Connect X**. The empty tab says "Bring in your X bookmarks" with **Connect X**, which signs in straight away when a Client ID is set and opens Settings otherwise.

Not built yet: the "new since your last visit" dot from the mock. It needs a record of which bookmarks were seen, and Writer keeps none.

## Reading

Built: `![[*.mp4]]` (and `.mov`, `.m4v`, `.webm`) embeds play in every note (`video-embed-widget.ts`), with controls. A `*-gif.mp4` plays like a GIF: looping, muted, no controls, a GIF label, paused under Reduce Motion, click to pause or play. GIFs are saved under that name for this reason. The widget keeps every pointer event, so using the controls never drops the caret into the embed and swaps it for its source. The CSP has a `media-src` for `asset:`; without it every video failed with "source not supported".

Not built yet: the thread view. A `Type: Tweet` note should open with an author header from the properties with **Open on X**, and the posts on one thin line instead of separated by rules.

## States

| State | Shown |
|---|---|
| No Client ID or not connected | Bookmarks tab: "Bring in your X bookmarks" with **Connect X** (opens Settings → X Bookmarks) |
| Syncing | "Saving bookmarks · 38 of 214"; cards appear as each finishes |
| Sign-in expired or revoked | "Not synced since <date>" and **Reconnect X**; saved notes stay |
| Post deleted on X | Nothing changes; the note keeps what was saved |
| Removed from X bookmarks | Nothing changes; Writer never deletes a note |
| Callback port busy | "Another Writer window is connecting to X. Finish there first." |

## Build order

1. Rust: OAuth + Keychain, bookmarks and thread fetch, media download (`commands/x_bookmarks.rs`).
2. Frontend: note writing, sync loop and state, Settings → X Bookmarks.
3. Library Bookmarks tab and card.
4. Editor: `![[*.mp4]]` embeds and the thread view.
