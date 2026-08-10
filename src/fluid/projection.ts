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
 * Velocity is stored in normalised units per second, so the canvas spans 0..1
 * on both axes and one x-unit is a different physical length from one y-unit
 * on a non-square viewport. That is where #681's anisotropy comes from — not
 * from the cells, which `fitGrid` already keeps square. Confining the metric
 * to these three passes leaves advection, the splat, and the pointer in the
 * units they already had.
 *
 * Taking the canvas height as the unit of length, a cell measures `aspect /
 * width` across and `1 / height` down; every factor below follows from those
 * two lengths.
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
  aspect: number,
): ProjectionScale => {
  // Kept per-axis rather than collapsed to one `h`: rounding the cell counts
  // to whole numbers leaves the two slightly apart, and `fitGrid`'s minimum of
  // 2 cells drives them far apart at extreme aspects.
  const cellX = aspect / width;
  const cellY = 1 / height;

  return {
    divergenceX: 1 / cellX,
    divergenceY: 1 / cellY,
    gradientX: 1 / cellX,
    gradientY: 1 / cellY,
    laplacianX: 1 / (cellX * cellX),
    laplacianY: 1 / (cellY * cellY),
  };
};

/** What the Jacobi sweep's weighted mean of the neighbours divides by. */
export const jacobiDiagonal = (scale: ProjectionScale): number =>
  2 * (scale.laplacianX + scale.laplacianY);
