import { describe, expect, it } from "vitest";

import { DYE_INTENSITY, hueToRgb } from "./color";

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
