import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  AUTO_PIN_LEAD_SECONDS,
  AUTO_PIN_WINDOW_MS,
  armAutoPin,
  autoPinFor,
  disarmAutoPin,
} from "../src/lib/video-players";

describe("auto pin after a pause", () => {
  afterEach(() => disarmAutoPin());

  test("pins a few seconds before the pause, in the paused note only", () => {
    armAutoPin("a.md", 100, 0);
    expect(autoPinFor("a.md", 1000)).toBe(100 - AUTO_PIN_LEAD_SECONDS);
    expect(autoPinFor("b.md", 1000)).toBeNull();
  });

  test("never before the start", () => {
    armAutoPin("a.md", 2, 0);
    expect(autoPinFor("a.md", 0)).toBe(0);
  });

  test("expires once the pause is no longer recent", () => {
    armAutoPin("a.md", 100, 0);
    expect(autoPinFor("a.md", AUTO_PIN_WINDOW_MS + 1)).toBeNull();
    expect(autoPinFor("a.md", 0)).toBeNull();
  });

  test("disarmed by playing again", () => {
    armAutoPin("a.md", 100, 0);
    disarmAutoPin();
    expect(autoPinFor("a.md", 0)).toBeNull();
  });
});
