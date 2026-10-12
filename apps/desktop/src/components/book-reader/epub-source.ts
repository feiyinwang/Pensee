import DOMPurify from "dompurify";
import { unzip, type Unzipped } from "fflate";

import {
  MAX_PASSAGE_CHARS,
  textOffset,
  type BookSource,
  type BookSourceHooks,
} from "./book-source";

// An EPUB as one scrolling column: every spine item is rendered once, in
// order, into a `content-visibility: auto` section, so the browser skips
// layout and paint for chapters off screen. The book's own stylesheets and
// scripts are dropped; its text takes the editor's typography. Pictures come
// out of the zip as blob URLs. SPECs/book-reader-spec.md.

const decoder = new TextDecoder();

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) =>
    unzip(data, (error, files) => (error ? reject(error) : resolve(files))),
  );
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** `href` resolved against the zip directory `base` ("OEBPS/text/"). */
function resolveHref(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split("#")[0] ?? "")).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

export async function openEpub(
  data: ArrayBuffer,
  scroller: HTMLElement,
  host: HTMLElement,
  hooks: BookSourceHooks,
): Promise<BookSource> {
  const files = await unzipAsync(new Uint8Array(data));
  const read = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`The book is missing ${path}`);
    return decoder.decode(file);
  };

  const container = parseXml(read("META-INF/container.xml"));
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB has no package file");
  const opf = parseXml(read(opfPath));
  const opfDir = dirOf(opfPath);
  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of opf.querySelectorAll("manifest > item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href)
      manifest.set(id, {
        href: resolveHref(opfDir, href),
        type: item.getAttribute("media-type") ?? "",
      });
  }
  const spine = [...opf.querySelectorAll("spine > itemref")]
    .map((ref) => manifest.get(ref.getAttribute("idref") ?? ""))
    .filter((item): item is { href: string; type: string } => !!item && item.type.includes("html"));

  const blobUrls = new Map<string, string>();
  const blobUrl = (path: string) => {
    let url = blobUrls.get(path);
    if (!url && files[path]) {
      url = URL.createObjectURL(new Blob([files[path]]));
      blobUrls.set(path, url);
    }
    return url ?? null;
  };

  const sectionByPath = new Map(spine.map((item, i) => [item.href, i]));
  const sections: HTMLElement[] = [];
  const titles: string[] = [];
  spine.forEach((item, index) => {
    const doc = new DOMParser().parseFromString(read(item.href), "application/xhtml+xml");
    const body = doc.querySelector("parsererror")
      ? new DOMParser().parseFromString(read(item.href), "text/html").body
      : doc.body;
    const base = dirOf(item.href);
    const fragment = DOMPurify.sanitize(body?.innerHTML ?? "", {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ["style", "link", "script", "iframe", "form", "input", "button"],
      FORBID_ATTR: ["style", "class"],
    });
    for (const img of fragment.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      const url = src ? blobUrl(resolveHref(base, src)) : null;
      if (url) img.src = url;
      else img.remove();
      img.loading = "lazy";
    }
    for (const image of fragment.querySelectorAll("image")) {
      const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
      const url = href ? blobUrl(resolveHref(base, href)) : null;
      if (url) image.setAttribute("href", url);
    }
    for (const link of fragment.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href")!;
      if (/^[a-z]+:/i.test(href)) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noreferrer");
        continue;
      }
      const path = href.startsWith("#") ? item.href : resolveHref(base, href);
      const anchor = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
      link.setAttribute("data-section-link", String(sectionByPath.get(path) ?? ""));
      link.setAttribute("data-anchor", anchor);
      link.setAttribute("href", "#");
    }
    const section = document.createElement("section");
    section.className = "book-epub-section";
    section.dataset.section = String(index);
    section.append(fragment);
    host.append(section);
    sections.push(section);
    titles.push(section.querySelector("h1, h2, h3")?.textContent?.trim() || `section ${index + 1}`);
  });

  // In-book links (a table of contents, footnotes) scroll within the reader.
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.("a[data-section-link]");
    if (!link) return;
    event.preventDefault();
    const section = sections[Number(link.getAttribute("data-section-link"))];
    const anchor = link.getAttribute("data-anchor");
    const target = (anchor && section?.querySelector(`[id="${CSS.escape(anchor)}"]`)) || section;
    target?.scrollIntoView({ block: "start" });
  };
  host.addEventListener("click", onClick);

  for (let i = 0; i < sections.length; i++) hooks.onSectionShown(i);

  const currentSection = () => {
    const middle = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
    const index = sections.findIndex((section) => section.getBoundingClientRect().bottom > middle);
    return index === -1 ? Math.max(0, sections.length - 1) : index;
  };

  // A chapter off screen is skipped (`content-visibility: auto`) at a
  // placeholder height until the browser gets to it, which can be frames
  // after a jump. Measuring then would place the reader by the placeholder.
  const laidOut = new Set<HTMLElement>();
  const layOutInView = () => {
    const from = scroller.scrollTop - scroller.clientHeight;
    const to = scroller.scrollTop + scroller.clientHeight * 2;
    let any = false;
    for (const section of sections) {
      if (laidOut.has(section)) continue;
      const top = section.offsetTop;
      if (top > to) break;
      if (top + section.offsetHeight < from) continue;
      section.style.contentVisibility = "visible";
      laidOut.add(section);
      any = true;
    }
    return any;
  };

  return {
    unit: "s",
    textRoot: (section) => sections[section] ?? null,
    sectionElement: (section) => sections[section] ?? null,
    sectionOf: (node) => {
      const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
        ".book-epub-section",
      );
      return el && host.contains(el) ? Number(el.dataset.section) : null;
    },
    scrollToSection: async (section) => {
      sections[section]?.scrollIntoView({ block: "start" });
    },
    currentSection,
    layOutInView,
    passage: async () => {
      const index = currentSection();
      const section = sections[index]!;
      const text = section.textContent ?? "";
      // The part of the chapter around the middle of the viewport.
      const rect = scroller.getBoundingClientRect();
      const caret = document.caretRangeFromPoint?.(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      const at =
        caret && section.contains(caret.startContainer)
          ? textOffset(section, caret.startContainer, caret.startOffset)
          : 0;
      const from = Math.max(0, at - MAX_PASSAGE_CHARS / 2);
      return { where: titles[index]!, text: text.slice(from, from + MAX_PASSAGE_CHARS) };
    },
    destroy: () => {
      host.removeEventListener("click", onClick);
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    },
  };
}
