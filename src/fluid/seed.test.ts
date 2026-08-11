import { describe, expect, it } from "vitest";

import {
  MAX_SPLATS_PER_FRAME,
  SEED_SPLAT_FORCE,
  SEED_SPLATS_MAX,
  SEED_SPLATS_MIN,
} from "./config";
import { randomSplat, seedEnabled, seedSplats } from "./seed";

/** Draws the given values in order, then repeats the last one — enough for a
 * generator whose exact number of draws is not the thing under test. */
const sequence = (...values: number[]): (() => number) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
};

describe("seedEnabled", () => {
  it("seeds unless the page asked otherwise", () => {
    expect(seedEnabled("")).toBe(true);
    expect(seedEnabled("?other=off")).toBe(true);
    // An unrecognised value must not silently disable the burst: a typo would
    // otherwise leave the e2e drag case measuring a canvas nobody seeded and
    // still passing.
    expect(seedEnabled("?seed=yes")).toBe(true);
  });

  it("is off for the exact opt-out the e2e suite passes", () => {
    expect(seedEnabled("?seed=off")).toBe(false);
    expect(seedEnabled("?foo=1&seed=off")).toBe(false);
  });
});

describe("randomSplat", () => {
  it("lands inside the canvas", () => {
    const random = sequence(0.25, 0.75, 0.5, 0.1);
    const splat = randomSplat(random);
    expect(splat.x).toBeGreaterThanOrEqual(0);
    expect(splat.x).toBeLessThanOrEqual(1);
    expect(splat.y).toBeGreaterThanOrEqual(0);
    expect(splat.y).toBeLessThanOrEqual(1);
  });

  it("throws at the configured force, in some direction", () => {
    for (let i = 0; i < 16; i++) {
      const splat = randomSplat(sequence(i / 16, 0.5, 0.5, 0.3));
      expect(Math.hypot(splat.dx, splat.dy)).toBeCloseTo(SEED_SPLAT_FORCE, 6);
    }
  });

  it("varies the direction with the draw", () => {
    const first = randomSplat(sequence(0, 0.5, 0.5, 0.2));
    const second = randomSplat(sequence(0.5, 0.5, 0.5, 0.2));
    expect(first.dx).not.toBeCloseTo(second.dx, 3);
  });
});

describe("seedSplats", () => {
  it("stays within the configured range at both extremes of the draw", () => {
    expect(seedSplats(() => 0)).toHaveLength(SEED_SPLATS_MIN);
    // Just under 1: `Math.random` never returns 1, so this is the real ceiling.
    expect(seedSplats(sequence(0.999999)).length).toBe(SEED_SPLATS_MAX);
  });

  it("fits in one frame, so the opening burst is never truncated", () => {
    expect(SEED_SPLATS_MAX).toBeLessThanOrEqual(MAX_SPLATS_PER_FRAME);
  });

  it("scatters the burst rather than stacking it on one point", () => {
    let draw = 0;
    const splats = seedSplats(() => {
      draw += 1;
      return (draw % 7) / 7;
    });
    const points = new Set(splats.map((splat) => [splat.x, splat.y].join(",")));
    expect(points.size).toBeGreaterThan(1);
  });
});
