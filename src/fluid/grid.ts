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

/** Either grid differing means the textures it sizes are the wrong shape, so
 * both must match for the rebuild to be skippable. */
export const needsRebuild = (current: GridPair, next: GridPair): boolean =>
  !sameGrid(next.simGrid, current.simGrid) ||
  !sameGrid(next.dyeGrid, current.dyeGrid);

export const dispatchSize = (grid: Grid): [number, number] => [
  Math.ceil(grid.width / WORKGROUP_SIZE),
  Math.ceil(grid.height / WORKGROUP_SIZE),
];
