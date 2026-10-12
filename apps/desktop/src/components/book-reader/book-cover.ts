import { convertFileSrc } from "@tauri-apps/api/core";

// A picture of a book for its page's card (SPECs/book-reader-spec.md): the
// EPUB's own cover image, or the PDF's first page drawn small. Read once per
// book per session and cached as an object URL; loaded only when a card that
// has no `Cover` property shows.

const THUMB_WIDTH = 96; // CSS px; drawn at device pixels.
const covers = new Map<string, Promise<string | null>>();

function xml(text: string) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function resolve(base: string, href: string): string {
  const out: string[] = [];
  for (const part of (base + decodeURIComponent(href)).split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

async function epubCover(data: Uint8Array): Promise<string | null> {
  const { unzip } = await import("fflate");
  const take = (name: string) =>
    new Promise<Uint8Array | undefined>((done, fail) =>
      unzip(data, { filter: (f) => f.name === name }, (error, files) =>
        error ? fail(error) : done(files[name]),
      ),
    );
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const container = await take("META-INF/container.xml");
  const opfPath =
    container && xml(decode(container)).querySelector("rootfile")?.getAttribute("full-path");
  const opfBytes = opfPath ? await take(opfPath) : undefined;
  if (!opfPath || !opfBytes) return null;
  const opf = xml(decode(opfBytes));
  const items = [...opf.getElementsByTagNameNS("*", "item")];
  // EPUB 3 marks it; EPUB 2 names it in a <meta name="cover">; else the
  // first picture, which is the cover in most books.
  const coverId = [...opf.getElementsByTagNameNS("*", "meta")]
    .find((m) => m.getAttribute("name") === "cover")
    ?.getAttribute("content");
  const item =
    items.find((i) => /\bcover-image\b/.test(i.getAttribute("properties") ?? "")) ??
    items.find((i) => coverId && i.getAttribute("id") === coverId) ??
    items.find((i) => (i.getAttribute("media-type") ?? "").startsWith("image/"));
  const href = item?.getAttribute("href");
  if (!href) return null;
  const bytes = await take(resolve(opfPath.slice(0, opfPath.lastIndexOf("/") + 1), href));
  if (!bytes) return null;
  return URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: item?.getAttribute("media-type") ?? "" }),
  );
}

async function pdfCover(data: Uint8Array): Promise<string | null> {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data });
  try {
    const page = await (await task.promise).getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: (THUMB_WIDTH * (window.devicePixelRatio || 1)) / base.width,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    void task.destroy();
  }
}

/** The bytes' cover as an object URL, or null when the book has none. */
export function coverFromBytes(data: Uint8Array, kind: "epub" | "pdf"): Promise<string | null> {
  return kind === "epub" ? epubCover(data) : pdfCover(data);
}

export function bookCoverUrl(path: string): Promise<string | null> {
  let cover = covers.get(path);
  if (!cover) {
    cover = fetch(convertFileSrc(path))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) =>
        coverFromBytes(
          new Uint8Array(buffer),
          path.toLowerCase().endsWith(".epub") ? "epub" : "pdf",
        ),
      )
      .catch((error) => {
        console.error(`[book] Couldn't read the cover of ${path}:`, error);
        covers.delete(path); // Try again next time the card shows.
        return null;
      });
    covers.set(path, cover);
  }
  return cover;
}
