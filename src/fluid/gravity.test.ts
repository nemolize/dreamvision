import { describe, expect, it } from "vitest";

import { GRAVITY_SMOOTHING_SECONDS } from "./config";
import {
  DEFAULT_UP,
  easeDirection,
  GravityTracker,
  inPlaneShare,
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

describe("inPlaneShare", () => {
  it("is 1 for a device held upright and 0 for one lying flat", () => {
    expect(inPlaneShare({ x: 0, y: G, z: 0 })).toBeCloseTo(1, 9);
    expect(inPlaneShare({ x: 0, y: 0, z: G })).toBe(0);
  });

  it("is the sine of the tilt in between, whatever the gravity's size", () => {
    const tilt = Math.PI / 6;
    expect(
      inPlaneShare({ x: 0, y: G * Math.sin(tilt), z: G * Math.cos(tilt) }),
    ).toBeCloseTo(0.5, 9);
    expect(inPlaneShare({ x: 0, y: 3, z: 4 })).toBeCloseTo(0.6, 9);
  });

  it("counts a reading without a usable z as fully in the plane", () => {
    expect(inPlaneShare({ x: 0, y: 2 })).toBe(1);
    expect(inPlaneShare({ x: 0, y: 2, z: null })).toBe(1);
    expect(inPlaneShare({ x: 0, y: 2, z: Number.NaN })).toBe(1);
  });

  it("has no share for a reading that is missing, not finite or all zero", () => {
    expect(inPlaneShare(null)).toBeNull();
    expect(inPlaneShare({ x: null, y: 5, z: 1 })).toBeNull();
    expect(inPlaneShare({ x: 5, y: Infinity, z: 1 })).toBeNull();
    expect(inPlaneShare({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe("easeDirection", () => {
  it("stays where it is for no elapsed time and never steps backwards", () => {
    expect(easeDirection([0, -1], [1, 0], 0)).toStrictEqual([0, -1]);
    expect(easeDirection([0, -1], [1, 0], -1)).toStrictEqual([0, -1]);
  });

  it("closes the share of the turn one time constant implies", () => {
    const [x, y] = easeDirection([0, -1], [1, 0], GRAVITY_SMOOTHING_SECONDS);
    const turned = (Math.PI / 2) * (1 - Math.exp(-1));
    expect(x).toBeCloseTo(Math.sin(turned), 9);
    expect(y).toBeCloseTo(-Math.cos(turned), 9);
  });

  it("converges onto the target", () => {
    expect(easeDirection([0, -1], [1, 0], 100)).toEqual(close(1, 0));
  });

  it("stays a unit vector part-way", () => {
    const [x, y] = easeDirection([0, -1], [1, 0], 0.05);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
  });

  it("turns a target exactly opposite, at the step a real frame takes", () => {
    let direction: readonly [number, number] = [0, -1];
    const [, firstY] = easeDirection(direction, [0, 1], 1 / 60);
    expect(firstY).toBeGreaterThan(-1);

    for (let frame = 0; frame < 600; frame++) {
      direction = easeDirection(direction, [0, 1], 1 / 60);
    }
    expect(direction).toEqual(close(0, 1));
  });

  it("turns the same way round from either side of an opposite target", () => {
    const [x] = easeDirection([0, -1], [0, 1], 1 / 60);
    const [mirrored] = easeDirection([0, 1], [0, -1], 1 / 60);
    expect(Math.abs(x)).toBeCloseTo(Math.abs(mirrored), 9);
    expect(x).not.toBe(0);
  });

  it("takes the shorter way round to a near-opposite target", () => {
    const [x] = easeDirection([0, -1], [-0.05, Math.sqrt(1 - 0.0025)], 1 / 60);
    expect(x).toBeLessThan(0);
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

  it("lifts with the full share before any reading and for a reading without z", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: 0, y: 2 }, 0);
    expect(tracker.step(100)).toEqual(close(0, -1));
  });

  it("scales the direction by the share of gravity in the screen plane", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: 0, y: 3, z: 4 }, 0);
    expect(tracker.step(100)).toEqual(close(0, -0.6));
  });

  it("fades the lift to nothing for a device lying flat, keeping the last direction", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: G, y: 0, z: 0 }, 0);
    tracker.step(100);
    tracker.update({ x: 0, y: 0, z: G }, 0);
    const [part] = tracker.step(GRAVITY_SMOOTHING_SECONDS);
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(1);
    expect(tracker.step(100)).toEqual(close(0, 0));
  });

  it("keeps the last share through an unusable reading", () => {
    const tracker = new GravityTracker();
    tracker.update({ x: 0, y: 3, z: 4 }, 0);
    tracker.update(null, 0);
    expect(tracker.step(100)).toEqual(close(0, -0.6));
  });
});
