import { describe, expect, test } from "vite-plus/test";
import {
  coverToGet,
  liveCoverSrc,
  noteLink,
  webAddressIn,
  withCover,
  youtubeThumbnail,
  youtubeVideoId,
} from "../src/lib/covers";
import type { TypedNote } from "../src/lib/tauri";

function note(properties: Record<string, string>, note_type = "YouTube"): TypedNote {
  return {
    path: "/vault/Video.md",
    relative_path: "Video.md",
    name: "Video",
    title: null,
    note_type,
    modified_at: 0,
    properties,
    excerpt: null,
  };
}

describe("youtubeVideoId", () => {
  test.each([
    ["https://www.youtube.com/watch?v=k4dVgbuxBAw", "k4dVgbuxBAw"],
    ["https://www.youtube.com/watch?v=wAZn9dF3XTo&t=735s", "wAZn9dF3XTo"],
    [
      "https://www.youtube.com/watch?v=T8ktpayOBWE&list=PLlu3VssJh_pjJUp348TznLXnAHmI1hztV&index=2",
      "T8ktpayOBWE",
    ],
    ["https://youtu.be/WUq8Pun28FI", "WUq8Pun28FI"],
    ["https://youtu.be/WUq8Pun28FI?si=abc&t=10", "WUq8Pun28FI"],
    ["https://m.youtube.com/watch?v=IW472-d_8bs", "IW472-d_8bs"],
    ["https://youtube.com/shorts/Zztm9Ei3E4I", "Zztm9Ei3E4I"],
    ["https://www.youtube.com/embed/Hjlu-jIY9Ao", "Hjlu-jIY9Ao"],
    ["https://www.youtube.com/live/OvAEueQAs00?feature=share", "OvAEueQAs00"],
    ["https://www.youtube-nocookie.com/embed/Hjlu-jIY9Ao", "Hjlu-jIY9Ao"],
  ])("%s → %s", (url, id) => {
    expect(youtubeVideoId(url)).toBe(id);
  });

  test.each([
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PLo-kPya_Ww2wLc0USlqpuN_OAtJjc6qoP",
    "https://www.youtube.com/watch?v=short",
    "https://vimeo.com/123456789",
    "https://notyoutube.com/watch?v=k4dVgbuxBAw",
    "not a url",
  ])("%s → null", (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });
});

describe("webAddressIn", () => {
  test("reads a bare, bracketed or markdown-linked address", () => {
    expect(webAddressIn("https://youtu.be/E5osPgtcqbw")).toBe("https://youtu.be/E5osPgtcqbw");
    expect(webAddressIn("<https://youtu.be/E5osPgtcqbw>")).toBe("https://youtu.be/E5osPgtcqbw");
    expect(webAddressIn("[Talk](https://youtu.be/E5osPgtcqbw)")).toBe(
      "https://youtu.be/E5osPgtcqbw",
    );
  });

  test("adds https to an address written without a scheme", () => {
    expect(webAddressIn("youtube.com/watch?v=zCmW5bLcE9s")).toBe(
      "https://youtube.com/watch?v=zCmW5bLcE9s",
    );
  });

  test("blank and null values say nothing", () => {
    for (const value of [undefined, "", "  ", "null", "~", "just words"]) {
      expect(webAddressIn(value)).toBeNull();
    }
  });
});

describe("noteLink", () => {
  test("takes url, then link, then source, skipping blanks", () => {
    expect(
      noteLink(note({ url: "", link: "https://a.example/x", source: "https://b.example/y" })),
    ).toBe("https://a.example/x");
    expect(noteLink(note({ link: "null", source: "https://b.example/y" }))).toBe(
      "https://b.example/y",
    );
    expect(noteLink(note({}))).toBeNull();
  });
});

describe("liveCoverSrc and coverToGet", () => {
  const video = note({ link: "https://www.youtube.com/watch?v=k4dVgbuxBAw&t=1s" });

  test("a YouTube video shows and gets its hqdefault thumbnail", () => {
    expect(youtubeThumbnail("k4dVgbuxBAw")).toBe(
      "https://i.ytimg.com/vi/k4dVgbuxBAw/hqdefault.jpg",
    );
    expect(liveCoverSrc(video, "video")).toBe(youtubeThumbnail("k4dVgbuxBAw"));
    expect(coverToGet(video, "video")).toBe(youtubeThumbnail("k4dVgbuxBAw"));
  });

  test("a note with a Cover has nothing to get", () => {
    expect(
      coverToGet({ ...video, properties: { ...video.properties, cover: "a.jpg" } }, "video"),
    ).toBeNull();
    expect(
      coverToGet({ ...video, properties: { ...video.properties, cover: "null" } }, "video"),
    ).toBe(youtubeThumbnail("k4dVgbuxBAw"));
  });

  test("a podcast gets the cover of its page; nothing shows before that", () => {
    const podcast = note({ url: "https://podcasts.example/show/42" }, "Podcast");
    expect(liveCoverSrc(podcast, "podcast")).toBeNull();
    expect(coverToGet(podcast, "podcast")).toBe("https://podcasts.example/show/42");
  });

  test("a podcast on YouTube shows the video's thumbnail", () => {
    const podcast = note({ url: "https://youtu.be/k4dVgbuxBAw" }, "Podcast");
    expect(liveCoverSrc(podcast, "podcast")).toBe(youtubeThumbnail("k4dVgbuxBAw"));
    expect(coverToGet(podcast, "podcast")).toBe(youtubeThumbnail("k4dVgbuxBAw"));
  });

  test("a non-YouTube video and other kinds have nothing to get", () => {
    expect(coverToGet(note({ link: "https://vimeo.com/1" }), "video")).toBeNull();
    expect(coverToGet(note({ link: "https://a.example" }, "Book"), "book")).toBeNull();
  });
});

describe("withCover", () => {
  test("fills the template's blank Cover line in place", () => {
    const fm = "Type: YouTube\nCover: \nLink: https://youtu.be/E5osPgtcqbw\nStar: ⭐️⭐️⭐️";
    expect(withCover(fm, "Video-assets/cover.jpg")).toBe(
      "Type: YouTube\nCover: Video-assets/cover.jpg\nLink: https://youtu.be/E5osPgtcqbw\nStar: ⭐️⭐️⭐️",
    );
  });

  test("fills a null Cover", () => {
    expect(withCover("Type: YouTube\nCover: null", "a/cover.jpg")).toBe(
      "Type: YouTube\nCover: a/cover.jpg",
    );
  });

  test("adds Cover after Type when there is none", () => {
    expect(withCover("Type: Podcast\nAuthor: Huberman", "Show-assets/cover.png")).toBe(
      "Type: Podcast\nCover: Show-assets/cover.png\nAuthor: Huberman",
    );
    expect(withCover("", "x/cover.jpg")).toBe("Cover: x/cover.jpg");
    expect(withCover(null, "x/cover.jpg")).toBe("Cover: x/cover.jpg");
  });

  test("never replaces a cover the note already has", () => {
    const fm = "Type: YouTube\nCover: https://img.youtube.com/vi/lU-LLtrOpKM/sddefault.jpg";
    expect(withCover(fm, "Video-assets/cover.jpg")).toBe(fm);
  });

  test("quotes a path YAML would misread", () => {
    expect(withCover("Type: YouTube\nCover:", "A: B #1-assets/cover.jpg")).toBe(
      'Type: YouTube\nCover: "A: B #1-assets/cover.jpg"',
    );
  });
});
