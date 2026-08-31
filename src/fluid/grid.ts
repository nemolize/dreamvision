import { WORKGROUP_SIZE } from "./config";

export interface Grid {
  width: number;
  height: number;
}

/** Fit a grid of `resolution` cells on its longer axis to the canvas' aspect,
 * so cells stay square and the fluid is not stretched. */
export const fitGrid = (
  width: number,
  height: number,
  resolution: number,
): Grid => {
  const aspect = width / height;
  const cells =
    aspect >= 1
      ? { width: resolution, height: resolution / aspect }
      : { width: resolution * aspect, height: resolution };
  return {
    width: Math.max(2, Math.round(cells.width)),
    height: Math.max(2, Math.round(cells.height)),
  };
};

export const sameGrid = (a: Grid, b: Grid): boolean =>
  a.width === b.width && a.height === b.height;

export interface GridPair {
  simGrid: Grid;
  dyeGrid: Grid;
}

export const fitGrids = (
  width: number,
  height: number,
  resolution: { simResolution: number; dyeResolution: number },
): GridPair => ({
  simGrid: fitGrid(width, height, resolution.simResolution),
  dyeGrid: fitGrid(width, height, resolution.dyeResolution),
});

/** Either grid differing means the textures it sizes are the wrong shape, so
 * both must match to skip; `null` is the first build, with nothing to keep. */
export const needsRebuild = (
  current: GridPair | null,
  next: GridPair,
): boolean =>
  current === null ||
  !sameGrid(next.simGrid, current.simGrid) ||
  !sameGrid(next.dyeGrid, current.dyeGrid);

export const dispatchSize = (grid: Grid): [number, number] => [
  Math.ceil(grid.width / WORKGROUP_SIZE),
  Math.ceil(grid.height / WORKGROUP_SIZE),
];
