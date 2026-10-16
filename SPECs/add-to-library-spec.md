# Add to Library Spec

## Summary

One way to put a book, video (courses included), podcast or paper into Library from a
link, a title or a file. Since 2026-10-12 it happens in the composer
(SPECs/composer-spec.md): its type chip is the Library kind, and a pasted link
sets it. A link pasted in ⌘F still offers rows there. The result is an ordinary note whose `Type:` puts it in its Library
tab (SPECs/spaces-spec.md).

## Ways in

| Way in                                                                  | What it does                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Paste a link in ⌘F                                                      | An **Add to Library** group goes on top of the results, the guess selected       |
| **⌘⇧L** anywhere, or **Add to Library…** in ⌘F                         | The composer, type chip on Book until a link says otherwise                     |
| **Add <noun>** in an empty Library tab, and **+** in the Library header | The composer with that tab's kind picked; not on Bookmarks, which X sync fills  |
| Drop a PDF or EPUB on the window                                        | As before (SPECs/book-reader-spec.md); attached to the composer when it's open |
| Import Book…, Import Apple Books Highlights                             | Unchanged palette commands                                                       |

## The palette rows (⌘F, a pasted link)

- Rows come from the query alone, never the network, so they don't change
  under the cursor and work offline.
- **A link:** one row per kind, `<Kind>: <host>`, in Library's tab order with
  the guess first. The guess's second line says
  "Guessed from the link". Hosts: YouTube, Vimeo → Video; Spotify episodes
  and shows, Apple Podcasts, Overcast, Pocket Casts → Podcast; arXiv, DOI,
  ACM, IEEE, OpenReview, Semantic Scholar, bioRxiv, SSRN → Paper; Coursera,
  Udemy, edX, Maven, Skillshare, Khan Academy, Teachable, Domestika → Video
  (courses are videos; there is no Course kind);
  Goodreads, Open Library, Google Books, Bookshop, Amazon product pages →
  Book. Another site has no guess and lists Book first.
- **A link already in Library:** a single **Already in your Library** row
  opens that note instead. Matched by source: the YouTube id, the arXiv id
  without its version, a DOI in the link or in a `DOI:` property, else the
  address without scheme, `www.`, tracking parameters or trailing slash.
- Titles and files are added from the composer: a Library kind with a title
  makes a note by that title, nothing looked up, so no author or cover is
  made up; the paperclip (or a drop) attaches a PDF or EPUB.

## The note

- Named by the page's Open Graph title, with the site's name and arXiv's
  `[id]` trimmed. A YouTube video's title comes from YouTube's oEmbed
  (`fetch_link_preview` asks it for any YouTube link): the watch page is
  about 1.5 MB with its `<title>` past the preview's 512 KB read. The title is read only after a row is picked ("Adding
  youtube.com…"); after 5 seconds or offline the note is named from its link
  (`youtu.be dQw4w9WgXcQ`). A taken name gets ` 2`, ` 3`, ….
- Written at the vault root with properties only, no heading:
  `Type` (`YouTube` for YouTube links, `Video` for other videos, else the
  kind) and `Link` (the key the vault's video and course notes use). It
  opens at once; covers come from Library's Get cover. A podcast's note
  opens even from the composer's ⌘↵, with its player
  ([podcast-notes-spec.md](podcast-notes-spec.md)).

## A dropped PDF: book or paper

A new page for a PDF is checked against its first four pages:

- an ISBN, or more than 150 pages → Book;
- an arXiv id, or an abstract in 50 pages or fewer → Paper (the page is
  retyped and loses its `Book` tag);
- otherwise it stays a Book, the commoner kind in the vault, and the notice
  "Added <name> as a book" offers **Change to paper** for eight seconds.

A DOI alone decides nothing: books carry them too. EPUBs are always books,
and an existing page keeps its type.

## Files

- `lib/library-add.ts`: link parsing, source keys, PDF verdict, note content,
  retyping (pure, `tests/library-add.test.ts`).
- `hooks/use-library-add.ts`: writing the note (with the composer's text and
  Keep open), and `openLibraryAdd`, which opens the composer.
- `components/command-palette/library-add-rows.tsx`: ⌘F's link rows.
- `lib/book-import.ts` (`settlePdfType`), `book-reader/book-meta.ts`
  (`readPdfClues`), the editor notice's optional action.

## Follow-ups

- Look up a title-only book on Open Library (author, cover, ISBN), as its own row.
- Fill author, channel or venue from the page (YouTube oEmbed, arXiv API, Crossref).
- Sentence case for palette commands, once decided for all of them.
