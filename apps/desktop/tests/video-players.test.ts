import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  type VideoPlayer,
  currentVideoPlayer,
  hoveredVideoPlayer,
  markVideoUsed,
  registerVideoPlayer,
  setVideoHovered,
  videoPlayerFor,
} from "../src/lib/video-players";

const cleanups: (() => void)[] = [];

function mount(notePath: string, shown: boolean): VideoPlayer & { visible: boolean } {
  const player = {
    notePath,
    visible: shown,
    time: () => 0,
    seek: () => {},
    toggle: () => {},
    playing: () => false,
    speed: () => {},
    rect: () => new DOMRect(),
    shown: () => player.visible,
  };
  cleanups.push(registerVideoPlayer(player));
  return player;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("the player the shortcuts mean", () => {
  test("the note on screen wins over a last-used video in a hidden tab", () => {
    mount("a.md", false);
    const b = mount("b.md", true);
    markVideoUsed("a.md");
    expect(currentVideoPlayer()).toBe(b);
  });

  test("the last used, when it is on screen beside another", () => {
    const a = mount("a.md", true);
    mount("b.md", true);
    markVideoUsed("a.md");
    expect(currentVideoPlayer()).toBe(a);
  });

  test("the last used, in a hidden tab, when none is on screen", () => {
    const a = mount("a.md", false);
    mount("b.md", false);
    markVideoUsed("a.md");
    expect(currentVideoPlayer()).toBe(a);
  });

  test("a note open in two tabs keeps both players; the shown one answers", () => {
    const hidden = mount("a.md", false);
    const shown = mount("a.md", true);
    expect(videoPlayerFor("a.md")).toBe(shown);
    shown.visible = false;
    hidden.visible = true;
    expect(videoPlayerFor("a.md")).toBe(hidden);
    cleanups.pop()!();
    expect(videoPlayerFor("a.md")).toBe(hidden);
  });
});

describe("the player the arrow keys skip", () => {
  test("the one under the pointer, until it leaves", () => {
    const a = mount("a.md", true);
    const b = mount("b.md", true);
    setVideoHovered(a, true);
    expect(hoveredVideoPlayer()).toBe(a);
    setVideoHovered(b, true);
    // a's leave arriving after b's enter must not clear b.
    setVideoHovered(a, false);
    expect(hoveredVideoPlayer()).toBe(b);
    setVideoHovered(b, false);
    expect(hoveredVideoPlayer()).toBeNull();
  });

  test("none once it is hidden or unmounted", () => {
    const a = mount("a.md", true);
    setVideoHovered(a, true);
    a.visible = false;
    expect(hoveredVideoPlayer()).toBeNull();
    a.visible = true;
    cleanups.pop()!();
    expect(hoveredVideoPlayer()).toBeNull();
  });
});
