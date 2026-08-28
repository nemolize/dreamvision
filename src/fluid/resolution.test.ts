import { describe, expect, it } from "vitest";

import {
  clampResolution,
  DEFAULT_RESOLUTION,
  normaliseResolution,
  RESOLUTION_DESCRIPTORS,
} from "./resolution";

describe("RESOLUTION_DESCRIPTORS", () => {
  it("brackets every default, so the panel opens on a reachable value", () => {
    for (const { key, min, max } of RESOLUTION_DESCRIPTORS) {
      expect(DEFAULT_RESOLUTION[key]).toBeGreaterThanOrEqual(min);
      expect(DEFAULT_RESOLUTION[key]).toBeLessThanOrEqual(max);
    }
  });

  it("places every default on a step, so the slider can return to it", () => {
    for (const { key, min, step } of RESOLUTION_DESCRIPTORS) {
      expect((DEFAULT_RESOLUTION[key] - min) % step).toBe(0);
    }
  });
});

describe("clampResolution", () => {
  it("holds a value inside the descriptor's range", () => {
    expect(clampResolution("simResolution", 8192)).toBe(512);
    expect(clampResolution("dyeResolution", 1)).toBe(256);
  });

  it("rounds to a whole cell count, which fitGrid and the dispatch both index", () => {
    expect(clampResolution("simResolution", 200.6)).toBe(201);
  });

  it("falls back to the default rather than passing NaN to a grid size", () => {
    expect(clampResolution("simResolution", Number.NaN)).toBe(
      DEFAULT_RESOLUTION.simResolution,
    );
  });
});

describe("normaliseResolution", () => {
  it("returns the defaults for a blob that predates the resolution channel", () => {
    expect(normaliseResolution(null)).toEqual(DEFAULT_RESOLUTION);
    expect(normaliseResolution({})).toEqual(DEFAULT_RESOLUTION);
  });

  it("keeps the defaults for keys the stored blob omits", () => {
    expect(normaliseResolution({ simResolution: 128 })).toEqual({
      simResolution: 128,
      dyeResolution: DEFAULT_RESOLUTION.dyeResolution,
    });
  });

  it("clamps a stored value the current build no longer offers", () => {
    expect(normaliseResolution({ dyeResolution: 99999 }).dyeResolution).toBe(
      2048,
    );
  });

  it("never returns the defaults object itself, so a caller cannot mutate it", () => {
    expect(normaliseResolution({})).not.toBe(DEFAULT_RESOLUTION);
  });
});
