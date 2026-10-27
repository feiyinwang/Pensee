import { describe, expect, test } from "vite-plus/test";
import { audioClipLink, parseAudioClip } from "../src/lib/audio-clips";
import { audioClipAt } from "../src/components/editor-area/board/board-audio-links";
import { emptyScene, type MindEl } from "../src/components/editor-area/board/board-model";

describe("audio clips", () => {
  test("a clip link names the take and the part to play", () => {
    const link = audioClipLink("Recordings/2026-10-27 11.32.m4a", 6, 17.34);
    expect(link).toBe("Recordings/2026-10-27 11.32.m4a#t=6,17.3");
    expect(parseAudioClip(link)).toEqual({
      path: "Recordings/2026-10-27 11.32.m4a",
      start: 6,
      end: 17.3,
    });
  });

  test("a single moment, a video pin or a backwards span isn't a clip", () => {
    expect(parseAudioClip("Recordings/a.m4a#t=6")).toBeNull();
    expect(parseAudioClip("Video note#^yt-754")).toBeNull();
    expect(parseAudioClip("Recordings/a.m4a#t=9,4")).toBeNull();
  });

  test("a click on a node's top-right corner finds its clip", () => {
    const scene = emptyScene();
    const node = {
      id: "n1",
      t: "mind",
      x: 100,
      y: 50,
      w: 120,
      h: 36,
      a: 0,
      op: 1,
      tx: "Keywords",
      pa: "r",
      ln: "Recordings/a.m4a#t=6,17",
    } as MindEl;
    scene.els.push(node);
    expect(audioClipAt(scene, 222, 48)).toBe("Recordings/a.m4a#t=6,17");
    expect(audioClipAt(scene, 150, 60)).toBeNull();
  });
});
