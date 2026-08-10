/**
 * The projection's discretisation, as plain numbers.
 *
 * The three projection passes (`divergence`, `pressure`, `gradientSubtract`)
 * compose into a real Helmholtz projection only if their per-axis scale
 * factors agree. That agreement is a property of the numbers, not of any GPU
 * state, so the numbers live here rather than inside the shader — which is
 * what lets `projection.test.ts` check the operator identities on the CPU,
 * with no adapter.
 *
 * Velocity is stored in normalised units per second — the canvas spans 0..1 on
 * *each* axis independently, so `vx = 1` crosses the full width in a second
 * while `vy = 1` crosses the full height. `advect` is what fixes that reading:
 * it converts to cell offsets by multiplying each component by that grid's own
 * dimension, so one unit of `vx` covers `width` cells and one unit of `vy`
 * covers `height` cells.
 *
 * Cells are square — `fitGrid` sees to that — so a cell is the natural unit of
 * length here, and the physical speed of a velocity component is its value
 * times the cell count along its axis. Hence the per-axis weights below: the x
 * difference carries `width`, the y difference `height`. Summing them with
 * equal weight, as the passes did before #681, under-counts x by the aspect
 * ratio — 44% on a 16:9 canvas.
 *
 * Confining the conversion to these three passes leaves advection, the splat,
 * and the pointer in the units they already had.
 */

/** Per-axis factors the three projection passes must agree on. */
export interface ProjectionScale {
  /** Multiplies the x difference in `divergence`. */
  divergenceX: number;
  /** Multiplies the y difference in `divergence`. */
  divergenceY: number;
  /** Multiplies the x pressure difference in `gradientSubtract`. */
  gradientX: number;
  /** Multiplies the y pressure difference in `gradientSubtract`. */
  gradientY: number;
  /** Weights the x neighbours in the Jacobi sweep's Laplacian. */
  laplacianX: number;
  /** Weights the y neighbours in the Jacobi sweep's Laplacian. */
  laplacianY: number;
}

export const projectionScale = (
  width: number,
  height: number,
): ProjectionScale => ({
  divergenceX: width,
  divergenceY: height,
  gradientX: width,
  gradientY: height,
  laplacianX: width * width,
  laplacianY: height * height,
});

/** What the Jacobi sweep's weighted mean of the neighbours divides by. */
export const jacobiDiagonal = (scale: ProjectionScale): number =>
  2 * (scale.laplacianX + scale.laplacianY);
