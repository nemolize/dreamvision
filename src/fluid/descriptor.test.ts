import { describe, expect, it } from "vitest";

import {
  formatSetting,
  fromTrackPosition,
  LOG_TRACK_STEPS,
  toTrackPosition,
} from "./descriptor";
import { DEFAULT_SETTINGS, SETTING_DESCRIPTORS } from "./settings";

const scale = SETTING_DESCRIPTORS.find(({ key }) => key === "sceneWidth");
if (scale === undefined) throw new Error("expected a sceneWidth descriptor");

describe("a log track", () => {
  it("puts the range's ends on the track's ends, exactly", () => {
    expect(fromTrackPosition(scale, 0)).toBe(scale.min);
    expect(fromTrackPosition(scale, LOG_TRACK_STEPS)).toBe(scale.max);
    expect(toTrackPosition(scale, scale.min)).toBe(0);
    expect(toTrackPosition(scale, scale.max)).toBe(LOG_TRACK_STEPS);
  });

  it("gives each factor of ten an equal share of the track", () => {
    const share = (from: number, to: number): number =>
      (toTrackPosition(scale, to) - toTrackPosition(scale, from)) /
      LOG_TRACK_STEPS;

    expect(share(0.01, 0.1)).toBeCloseTo(0.25, 3);
    expect(share(0.1, 1)).toBeCloseTo(0.25, 3);
    expect(share(1, 10)).toBeCloseTo(0.25, 3);
    expect(share(10, 100)).toBeCloseTo(0.25, 3);
  });

  it("leaves the default away from both ends of the track", () => {
    const share =
      toTrackPosition(scale, DEFAULT_SETTINGS.sceneWidth) / LOG_TRACK_STEPS;

    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.75);
  });

  it("gives the small widths a tenth of the track or more", () => {
    expect(toTrackPosition(scale, 0.3)).toBeGreaterThan(LOG_TRACK_STEPS / 10);
  });

  it("round-trips every position, so a keypress always moves the value", () => {
    for (let position = 0; position <= LOG_TRACK_STEPS; position++) {
      expect(toTrackPosition(scale, fromTrackPosition(scale, position))).toBe(
        position,
      );
    }
  });

  it("holds a value outside the range to the track's ends", () => {
    expect(toTrackPosition(scale, 1e6)).toBe(LOG_TRACK_STEPS);
    expect(toTrackPosition(scale, 1e-6)).toBe(0);
  });

  it("reads differently at every position, so a keypress shows", () => {
    const readouts = new Set<string>();
    for (let position = 0; position <= LOG_TRACK_STEPS; position++) {
      readouts.add(formatSetting(scale, fromTrackPosition(scale, position)));
    }

    expect(readouts.size).toBe(LOG_TRACK_STEPS + 1);
  });
});
