import { describe, expect, it } from "vitest";

import {
  ambientSources,
  IdleSplatter,
  randomSplat,
  seedSplats,
} from "./ambient";
import {
  AMBIENT_SPLAT_FORCE,
  IDLE_DELAY_SECONDS,
  IDLE_INTERVAL_SECONDS,
  MAX_SPLATS_PER_FRAME,
  SEED_SPLATS_MAX,
  SEED_SPLATS_MIN,
  TIME_STEP,
} from "./config";

/** Draws the given values in order, then repeats the last one — enough for a
 * generator whose exact number of draws is not the thing under test. */
const sequence = (...values: number[]): (() => number) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
};

describe("ambientSources", () => {
  it("runs both sources unless the page asked otherwise", () => {
    const both = { seed: true, idle: true };
    expect(ambientSources("")).toEqual(both);
    expect(ambientSources("?other=off")).toEqual(both);
    // An unrecognised value must not silently disable a source: a typo would
    // otherwise leave a test measuring the wrong thing and still passing.
    expect(ambientSources("?ambient=yes")).toEqual(both);
  });

  it("isolates each source for the e2e suite", () => {
    expect(ambientSources("?ambient=off")).toEqual({
      seed: false,
      idle: false,
    });
    expect(ambientSources("?ambient=seed")).toEqual({
      seed: true,
      idle: false,
    });
    expect(ambientSources("?foo=1&ambient=idle")).toEqual({
      seed: false,
      idle: true,
    });
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
      expect(Math.hypot(splat.dx, splat.dy)).toBeCloseTo(
        AMBIENT_SPLAT_FORCE,
        6,
      );
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

describe("IdleSplatter", () => {
  const run = (splatter: IdleSplatter, seconds: number): number => {
    let count = 0;
    for (let elapsed = 0; elapsed < seconds; elapsed += TIME_STEP) {
      if (splatter.step(TIME_STEP, Math.random) !== null) count += 1;
    }
    return count;
  };

  it("stays quiet until the delay has passed", () => {
    const splatter = new IdleSplatter();
    expect(run(splatter, IDLE_DELAY_SECONDS - TIME_STEP * 2)).toBe(0);
  });

  it("splats once the delay passes", () => {
    const splatter = new IdleSplatter();
    expect(run(splatter, IDLE_DELAY_SECONDS + TIME_STEP)).toBe(1);
  });

  it("then keeps splatting at the interval, not the delay", () => {
    const splatter = new IdleSplatter();
    run(splatter, IDLE_DELAY_SECONDS + TIME_STEP);

    // A further two intervals: the initial delay must not apply again.
    const later = run(splatter, IDLE_INTERVAL_SECONDS * 2 + TIME_STEP);
    expect(later).toBe(2);
  });

  it("restarts the countdown when the pointer is used", () => {
    const splatter = new IdleSplatter();
    run(splatter, IDLE_DELAY_SECONDS - TIME_STEP * 2);
    splatter.notifyActivity();

    expect(run(splatter, IDLE_DELAY_SECONDS - TIME_STEP * 2)).toBe(0);
  });

  it("never splats more than once per step", () => {
    const splatter = new IdleSplatter();
    // A step far longer than the interval must still yield a single splat.
    splatter.step(IDLE_DELAY_SECONDS * 10, Math.random);
    expect(splatter.step(0, Math.random)).toBeNull();
  });
});
