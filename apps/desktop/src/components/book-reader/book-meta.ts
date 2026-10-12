import { convertFileSrc } from "@tauri-apps/api/core";

// A book's author from the file itself, for matching it to its page on import
// (SPECs/book-reader-spec.md): an EPUB's `dc:creator`s, a PDF's Author field.
// Reads only what it needs — two small files out of the EPUB's zip, the PDF's
// document info. Null when the book doesn't say.

async function epubAuthor(data: Uint8Array): Promise<string | null> {
  const { unzip } = await import("fflate");
  const unzipped = (filter: (name: string) => boolean) =>
    new Promise<Record<string, Uint8Array>>((resolve, reject) =>
      unzip(data, { filter: (file) => filter(file.name) }, (error, files) =>
        error ? reject(error) : resolve(files),
      ),
    );
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parse = (text: string) => new DOMParser().parseFromString(text, "application/xml");

  const container = (await unzipped((name) => name === "META-INF/container.xml"))[
    "META-INF/container.xml"
  ];
  const opfPath =
    container && parse(decode(container)).querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) return null;
  const opf = (await unzipped((name) => name === opfPath))[opfPath];
  if (!opf) return null;
  const creators = [...parse(decode(opf)).getElementsByTagNameNS("*", "creator")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
  return creators.length ? [...new Set(creators)].join(", ") : null;
}

async function pdfAuthor(data: Uint8Array): Promise<string | null> {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const { info } = await doc.getMetadata();
    const author = (info as { Author?: unknown } | null)?.Author;
    return typeof author === "string" && author.trim() ? author.trim() : null;
  } finally {
    void task.destroy();
  }
}

/** The author in a book's bytes. */
export function authorFromBytes(data: Uint8Array, kind: "epub" | "pdf"): Promise<string | null> {
  return kind === "epub" ? epubAuthor(data) : pdfAuthor(data);
}

export async function readBookAuthor(path: string): Promise<string | null> {
  try {
    const response = await fetch(convertFileSrc(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    return await authorFromBytes(data, path.toLowerCase().endsWith(".epub") ? "epub" : "pdf");
  } catch (error) {
    // A book without readable metadata still imports; its file name may say.
    console.error(`[book] Couldn't read the author of ${path}:`, error);
    return null;
  }
}
