import { describe, expect, it } from "vitest";

import { GRAVITY_SMOOTHING_SECONDS } from "./config";
import {
  DEFAULT_UP,
  easeDirection,
  GravityTracker,
  upFromReading,
} from "./gravity";

const G = 9.8;

const close = (x: number, y: number): unknown[] => [
  expect.closeTo(x, 6),
  expect.closeTo(y, 6),
];

describe("upFromReading", () => {
  it("points up the screen for a device held upright", () => {
    expect(upFromReading({ x: 0, y: G }, 0)).toEqual(close(0, -1));
  });

  it("points toward the right edge when the device's right side is raised", () => {
    expect(upFromReading({ x: G, y: 0 }, 0)).toEqual(close(1, 0));
  });

  it("keeps the flame rising away from the ground after a turn to landscape", () => {
    expect(upFromReading({ x: G, y: 0 }, 90)).toEqual(close(0, -1));
    expect(upFromReading({ x: 0, y: G }, 90)).toEqual(close(-1, 0));
    expect(upFromReading({ x: 0, y: G }, 180)).toEqual(close(0, 1));
    expect(upFromReading({ x: 0, y: G }, 270)).toEqual(close(1, 0));
  });

  it("returns a unit vector whatever the reading's magnitude", () => {
    const [x, y] = upFromReading({ x: 3, y: 4 }, 0) ?? [0, 0];
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
  });

  it("has no direction for a device lying flat", () => {
    expect(upFromReading({ x: 0, y: 0 }, 0)).toBeNull();
    expect(upFromReading({ x: 0.5, y: 0.5 }, 0)).toBeNull();
  });

  it("has no direction for a reading that is missing or not a finite number", () => {
    expect(upFromReading(null, 0)).toBeNull();
    expect(upFromReading({ x: null, y: 5 }, 0)).toBeNull();
    expect(upFromReading({ x: 5, y: null }, 0)).toBeNull();
    expect(upFromReading({ x: Number.NaN, y: 5 }, 0)).toBeNull();
    expect(upFromReading({ x: 5, y: Infinity }, 0)).toBeNull();
  });
});

describe("easeDirection", () => {
  it("stays where it is for no elapsed time and never steps backwards", () => {
    expect(easeDirection([0, -1], [1, 0], 0)).toStrictEqual([0, -1]);
    expect(easeDirection([0, -1], [1, 0], -1)).toStrictEqual([0, -1]);
  });

  it("closes the share of the gap one time constant implies", () => {
    const [x] = easeDirection([0, -1], [1, 0], GRAVITY_SMOOTHING_SECONDS);
    const [unnormalisedX, unnormalisedY] = [1 - Math.exp(-1), -Math.exp(-1)];
    expect(x).toBeCloseTo(
      unnormalisedX / Math.hypot(unnormalisedX, unnormalisedY),
      6,
    );
  });

  it("converges onto the target", () => {
    expect(easeDirection([0, -1], [1, 0], 100)).toEqual(close(1, 0));
  });

  it("stays a unit vector part-way", () => {
    const [x, y] = easeDirection([0, -1], [1, 0], 0.05);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
  });

  it("snaps to the target on a half turn, which has no direction between", () => {
    expect(
      easeDirection([0, -1], [0, 1], Math.log(2) * GRAVITY_SMOOTHING_SECONDS),
    ).toStrictEqual([0, 1]);
  });
});

describe("GravityTracker", () => {
  it("rises toward the top of the screen before any reading arrives", () => {
    expect(new GravityTracker().step(1)).toStrictEqual(DEFAULT_UP);
  });

  it("keeps rising toward the top when every reading is unusable", () => {
    const tracker = new GravityTracker();
    tracker.update(null, 0);
    tracker.update({ x: null, y: null }, 0);
    expect(tracker.step(10)).toStrictEqual(DEFAULT_UP);
  });

  it("turns toward a usable reading", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: G, y: 0 }, 0);
    expect(tracker.step(100)).toEqual(close(1, 0));
  });

  it("keeps the last usable direction through an unusable reading", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: G, y: 0 }, 0);
    tracker.update(null, 0);
    expect(tracker.step(100)).toEqual(close(1, 0));
  });

  it("moves part of the way in one short step rather than jumping", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: G, y: 0 }, 0);
    const [x] = tracker.step(1 / 60);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.5);
  });
});
