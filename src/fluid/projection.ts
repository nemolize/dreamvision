/**
 * How the projection's three passes convert between stored velocity and the
 * grid. They only compose into a Helmholtz projection if they agree on it, and
 * that agreement is a property of the numbers rather than of any GPU state —
 * which is what lets `projection.test.ts` check the operators on the CPU, with
 * no adapter.
 *
 * Velocity is stored normalised per axis, so `vx = 1` crosses the full canvas
 * width in a second and `vy = 1` the full height; `advect` reads it that way,
 * multiplying each component by its own grid dimension. Cells are square, so a
 * component's speed in cells is its value times the cell count along its axis.
 *
 * The conversion runs both ways and the two are reciprocal: `divergence` reads
 * stored velocity and reports a rate in cells, so it multiplies;
 * `gradientSubtract` computes a correction in cells and writes it back as
 * stored velocity, so it divides. Weighting both alike — the state this file
 * was added to fix — leaves the projection anisotropic in the correction while
 * the divergence it reports still falls, so only the written velocity reveals
 * it. The two cancel in between, which is why the Jacobi sweep inverts the
 * plain 5-point Laplacian with no weights of its own.
 */

/** Per-axis factors the three projection passes must agree on. */
export interface ProjectionScale {
  /** Stored velocity to cells per second, for `divergence`'s x difference. */
  divergenceX: number;
  /** Stored velocity to cells per second, for `divergence`'s y difference. */
  divergenceY: number;
  /** Cells per second back to stored, for `gradientSubtract`'s x correction. */
  gradientX: number;
  /** Cells per second back to stored, for `gradientSubtract`'s y correction. */
  gradientY: number;
}

export const projectionScale = (
  width: number,
  height: number,
): ProjectionScale => ({
  divergenceX: width,
  divergenceY: height,
  gradientX: 1 / width,
  gradientY: 1 / height,
});
