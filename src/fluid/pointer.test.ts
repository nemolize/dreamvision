import { describe, expect, it } from "vitest";

import { SPLAT_FORCE } from "./config";
import { DYE_INTENSITY, hueToRgb, PointerTracker } from "./pointer";

/** Ratios between channels, which the intensity scale leaves untouched. */
const normalise = ([r, g, b]: readonly [number, number, number]): number[] => {
  const peak = Math.max(r, g, b);
  return [r / peak, g / peak, b / peak].map((v) => Number(v.toFixed(3)));
};

describe("hueToRgb", () => {
  it("maps the primary and secondary hues to pure colours", () => {
    expect(normalise(hueToRgb(0))).toEqual([1, 0, 0]);
    expect(normalise(hueToRgb(1 / 3))).toEqual([0, 1, 0]);
    expect(normalise(hueToRgb(2 / 3))).toEqual([0, 0, 1]);
    expect(normalise(hueToRgb(1 / 6))).toEqual([1, 1, 0]);
    expect(normalise(hueToRgb(1 / 2))).toEqual([0, 1, 1]);
    expect(normalise(hueToRgb(5 / 6))).toEqual([1, 0, 1]);
  });

  it("wraps back to the starting hue", () => {
    expect(hueToRgb(1)).toEqual(hueToRgb(0));
  });

  it("always saturates exactly one channel", () => {
    for (let i = 0; i < 60; i++) {
      const [r, g, b] = hueToRgb(i / 60);
      expect(Math.max(r, g, b)).toBeCloseTo(DYE_INTENSITY, 6);
      expect(Math.min(r, g, b)).toBeCloseTo(0, 6);
    }
  });
});

describe("PointerTracker", () => {
  it("reports no motion and no press before any interaction", () => {
    const sample = new PointerTracker().consume();
    expect(sample).toMatchObject({ x: 0, y: 0, dx: 0, dy: 0, down: false });
  });

  it("ignores movement while the pointer is up", () => {
    const tracker = new PointerTracker();
    tracker.move(0.5, 0.5);
    expect(tracker.consume()).toMatchObject({ x: 0, y: 0, dx: 0, dy: 0 });
  });

  it("accumulates motion across several moves within one frame", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.move(0.6, 0.5);
    tracker.move(0.7, 0.5);

    const sample = tracker.consume();
    expect(sample.x).toBeCloseTo(0.7, 6);
    // Both steps contribute, so the force is the whole 0.5 -> 0.7 travel.
    expect(sample.dx).toBeCloseTo(0.2 * SPLAT_FORCE, 3);
    expect(sample.dy).toBeCloseTo(0, 6);
    expect(sample.down).toBe(true);
  });

  it("clears motion once consumed so a still pointer applies no force", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.move(0.6, 0.5);
    tracker.consume();

    const sample = tracker.consume();
    expect(sample.dx).toBe(0);
    expect(sample.dy).toBe(0);
    // Position and press state survive; only the delta is drained.
    expect(sample.x).toBeCloseTo(0.6, 6);
    expect(sample.down).toBe(true);
  });

  it("stops splatting after release but keeps the last position", () => {
    const tracker = new PointerTracker();
    tracker.press(0.5, 0.5);
    tracker.release();
    tracker.move(0.9, 0.9);

    const sample = tracker.consume();
    expect(sample.down).toBe(false);
    expect(sample.x).toBeCloseTo(0.5, 6);
    expect(sample.dx).toBe(0);
  });

  it("does not carry motion across a press", () => {
    const tracker = new PointerTracker();
    tracker.press(0.1, 0.1);
    tracker.move(0.4, 0.1);
    tracker.press(0.8, 0.8);

    expect(tracker.consume()).toMatchObject({ x: 0.8, y: 0.8, dx: 0, dy: 0 });
  });
});
