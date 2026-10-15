import { describe, expect, test } from "vite-plus/test";
import {
  formatSpeed,
  nextPodcastPreset,
  podcastLinkOf,
  stepPodcastSpeed,
} from "../src/lib/podcast-player";
import { opensWhenAdded } from "../src/lib/library-add";

describe("podcastLinkOf", () => {
  test("a Podcast note's link, whatever the site", () => {
    expect(podcastLinkOf("Type: Podcast\nLink: https://example.com/show/ep-12")).toBe(
      "https://example.com/show/ep-12",
    );
  });

  test("a podcast app's episode or an audio file in any note", () => {
    expect(podcastLinkOf("Link: https://podcasts.apple.com/us/podcast/x/id1?i=2")).toBe(
      "https://podcasts.apple.com/us/podcast/x/id1?i=2",
    );
    expect(podcastLinkOf("Source: https://open.spotify.com/episode/abc")).toBe(
      "https://open.spotify.com/episode/abc",
    );
    expect(podcastLinkOf("url: https://cdn.example.com/ep.MP3")).toBe(
      "https://cdn.example.com/ep.MP3",
    );
  });

  test("nothing for other notes, or a YouTube link", () => {
    expect(podcastLinkOf(null)).toBeNull();
    expect(podcastLinkOf("Type: Book\nLink: https://example.com/a")).toBeNull();
    expect(podcastLinkOf("Link: https://open.spotify.com/track/abc")).toBeNull();
    expect(podcastLinkOf("Type: Podcast\nLink: https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(podcastLinkOf("Type: Podcast")).toBeNull();
  });
});

describe("speeds", () => {
  test("< and > step and hold at the ends", () => {
    expect(stepPodcastSpeed(1, 1)).toBe(1.25);
    expect(stepPodcastSpeed(1, -1)).toBe(0.75);
    expect(stepPodcastSpeed(3, 1)).toBe(3);
    expect(stepPodcastSpeed(0.5, -1)).toBe(0.5);
    expect(stepPodcastSpeed(1.1, 1)).toBe(1.25);
  });

  test("a click cycles the presets back to 1×", () => {
    expect(nextPodcastPreset(1)).toBe(1.25);
    expect(nextPodcastPreset(2)).toBe(1);
    expect(nextPodcastPreset(2.5)).toBe(1);
    expect(nextPodcastPreset(0.75)).toBe(1);
  });

  test("labels", () => {
    expect(formatSpeed(1)).toBe("1×");
    expect(formatSpeed(1.25)).toBe("1.25×");
  });
});

test("a podcast opens when added; other kinds don't", () => {
  expect(opensWhenAdded("podcast")).toBe(true);
  expect(opensWhenAdded("video")).toBe(false);
  expect(opensWhenAdded(null)).toBe(false);
});
