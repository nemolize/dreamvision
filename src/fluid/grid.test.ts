import { describe, expect, it } from "vitest";

import { WORKGROUP_SIZE } from "./config";
import { dispatchSize, fitGrid } from "./grid";
import { RESOLUTION_DESCRIPTORS } from "./resolution";

/** The extremes of a viewport, so a resolution the panel offers is checked
 * against the shapes it actually has to fit. */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 1000, height: 1000 },
  { width: 3840, height: 800 },
  { width: 320, height: 1400 },
] as const;

const resolutionStops = (key: "simResolution" | "dyeResolution"): number[] => {
  const descriptor = RESOLUTION_DESCRIPTORS.find((it) => it.key === key);
  if (descriptor === undefined) throw new Error(`no descriptor for ${key}`);
  const stops: number[] = [];
  for (let v = descriptor.min; v <= descriptor.max; v += descriptor.step) {
    stops.push(v);
  }
  return stops;
};

describe("fitGrid", () => {
  it("puts the resolution on the longer axis and derives the shorter one", () => {
    expect(fitGrid(1920, 1080, 320)).toEqual({ width: 320, height: 180 });
    expect(fitGrid(1080, 1920, 320)).toEqual({ width: 180, height: 320 });
    expect(fitGrid(1000, 1000, 320)).toEqual({ width: 320, height: 320 });
  });

  it("keeps cells square, which is what stops the fluid stretching", () => {
    const { width, height } = fitGrid(1600, 900, 256);
    expect(width / height).toBeCloseTo(1600 / 900, 1);
  });

  it("never falls below the 2 cells the difference stencils need", () => {
    // An extreme aspect drives the short axis toward zero; a 1-cell or 0-cell
    // grid would make every neighbour read a clamped copy of the centre.
    expect(fitGrid(4000, 10, 64).height).toBeGreaterThanOrEqual(2);
    expect(fitGrid(10, 4000, 64).width).toBeGreaterThanOrEqual(2);
  });

  it("returns whole cells for every resolution the panel can produce", () => {
    for (const key of ["simResolution", "dyeResolution"] as const) {
      for (const resolution of resolutionStops(key)) {
        for (const { width, height } of VIEWPORTS) {
          const grid = fitGrid(width, height, resolution);
          expect(Number.isInteger(grid.width)).toBe(true);
          expect(Number.isInteger(grid.height)).toBe(true);
          expect(grid.width).toBeGreaterThanOrEqual(2);
          expect(grid.height).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe("dispatchSize", () => {
  it("rounds up, so the trailing partial workgroup still covers its cells", () => {
    expect(
      dispatchSize({ width: WORKGROUP_SIZE, height: WORKGROUP_SIZE }),
    ).toEqual([1, 1]);
    expect(
      dispatchSize({ width: WORKGROUP_SIZE + 1, height: WORKGROUP_SIZE * 2 }),
    ).toEqual([2, 2]);
  });

  it("covers every cell of every grid the panel can ask for", () => {
    for (const key of ["simResolution", "dyeResolution"] as const) {
      for (const resolution of resolutionStops(key)) {
        for (const { width, height } of VIEWPORTS) {
          const grid = fitGrid(width, height, resolution);
          const [x, y] = dispatchSize(grid);
          expect(x * WORKGROUP_SIZE).toBeGreaterThanOrEqual(grid.width);
          expect(y * WORKGROUP_SIZE).toBeGreaterThanOrEqual(grid.height);
        }
      }
    }
  });
});
