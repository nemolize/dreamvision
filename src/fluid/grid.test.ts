import { describe, expect, it } from "vitest";

import { DYE_RESOLUTION, SIM_RESOLUTION, WORKGROUP_SIZE } from "./config";
import type { Grid } from "./grid";
import {
  dispatchSize,
  fitGrid,
  fitGrids,
  needsRebuild,
  sameGrid,
} from "./grid";
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

describe("sameGrid", () => {
  it("compares the dimensions, not the identity", () => {
    expect(
      sameGrid({ width: 320, height: 180 }, { width: 320, height: 180 }),
    ).toBe(true);
    expect(
      sameGrid({ width: 320, height: 180 }, { width: 320, height: 181 }),
    ).toBe(false);
    expect(
      sameGrid({ width: 320, height: 180 }, { width: 321, height: 180 }),
    ).toBe(false);
  });

  it("is decided by the finer dye grid, so the sim grid alone overstates how often a resize can be skipped", () => {
    const rate = (
      steady: (width: number, height: number) => boolean,
    ): number => {
      let unchanged = 0;
      let total = 0;
      for (const { width, height } of VIEWPORTS) {
        for (let step = 0; step < 40; step++) {
          if (steady(width + step, height)) unchanged++;
          total++;
        }
      }
      return unchanged / total;
    };

    const steadyAt =
      (resolution: number) =>
      (width: number, height: number): boolean =>
        sameGrid(
          fitGrid(width, height, resolution),
          fitGrid(width + 1, height, resolution),
        );

    const simOnly = rate(steadyAt(SIM_RESOLUTION));
    const bothGrids = rate(
      (width, height) =>
        steadyAt(SIM_RESOLUTION)(width, height) &&
        steadyAt(DYE_RESOLUTION)(width, height),
    );

    expect(simOnly).toBeGreaterThan(0.8);
    expect(bothGrids).toBeLessThan(simOnly);
    expect(bothGrids).toBeGreaterThan(0.4);
  });

  it("never skips on a square viewport, where the dye grid steps on every pixel", () => {
    for (let step = 0; step < 8; step++) {
      const width = 1000 + step;
      expect(
        sameGrid(
          fitGrid(width, 1000, DYE_RESOLUTION),
          fitGrid(width + 1, 1000, DYE_RESOLUTION),
        ),
      ).toBe(false);
    }
  });
});

describe("needsRebuild", () => {
  const pair = (sim: Grid, dye: Grid) => ({ simGrid: sim, dyeGrid: dye });
  const SIM = { width: 320, height: 180 };
  const DYE = { width: 1024, height: 576 };

  it("skips the rebuild only when both grids match", () => {
    expect(needsRebuild(pair(SIM, DYE), pair(SIM, DYE))).toBe(false);
  });

  it("rebuilds when either grid alone differs, since each sizes its own textures", () => {
    expect(
      needsRebuild(pair(SIM, DYE), pair({ width: 320, height: 179 }, DYE)),
    ).toBe(true);
    expect(
      needsRebuild(pair(SIM, DYE), pair(SIM, { width: 1024, height: 575 })),
    ).toBe(true);
  });

  it("rebuilds on the first build, which has no grids to keep", () => {
    expect(needsRebuild(null, pair(SIM, DYE))).toBe(true);
  });

  it("skips a 1px canvas step on a wide viewport but not the resize that changes a grid", () => {
    const resolution = {
      simResolution: SIM_RESOLUTION,
      dyeResolution: DYE_RESOLUTION,
    };
    const built = fitGrids(3840, 800, resolution);

    expect(needsRebuild(built, fitGrids(3841, 800, resolution))).toBe(false);
    expect(needsRebuild(built, fitGrids(1920, 1080, resolution))).toBe(true);
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
