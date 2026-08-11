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
 * stored velocity and reports a rate in cells; `gradientSubtract` computes a
 * correction in cells and writes it back as stored velocity. Weighting both the
 * same way leaves the projection anisotropic in the correction while the
 * divergence it reports still falls — an error only the written velocity
 * reveals, which is what the tests here are shaped around.
 */

/** Per-axis conversions the three projection passes must agree on. */
export interface ProjectionScale {
  /** Stored velocity to cells per second, per axis — what `divergence` reads. */
  toCellsX: number;
  toCellsY: number;
  /** Cells per second back to stored, per axis — what the gradient writes. */
  toStoredX: number;
  toStoredY: number;
}

export const projectionScale = (
  width: number,
  height: number,
): ProjectionScale => ({
  toCellsX: width,
  toCellsY: height,
  toStoredX: 1 / width,
  toStoredY: 1 / height,
});

/**
 * Pack the two conversions into the shader's uniform slots. Out here rather
 * than in the renderer so a test can reach it — swapping the two reverses the
 * metric on the GPU, and nothing reading `projectionScale` would notice.
 */
export const projectionUniform = (
  scale: ProjectionScale,
): { toCells: [number, number]; toStored: [number, number] } => ({
  toCells: [scale.toCellsX, scale.toCellsY],
  toStored: [scale.toStoredX, scale.toStoredY],
});
