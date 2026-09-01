import type { Grid } from "./grid";
import type { ProjectionScale } from "./projection";
import { projectionUniform } from "./projection";
import type { Splat } from "./types";

/** Float index of each `Uniforms` member in `simulation.wgsl`. */
export const UNIFORM = {
  simSize: 0,
  dt: 2,
  aspect: 3,
  toCells: 4,
  toStored: 6,
} as const;

export const UNIFORM_FLOATS = 8;
export const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

/** Float index of each `SplatUniforms` member in `simulation.wgsl` — WGSL
 * aligns the `vec4f` to 16 bytes, leaving a hole a positional array would
 * misfill. */
export const SPLAT_UNIFORM = {
  point: 0,
  delta: 2,
  color: 4,
  radius: 8,
} as const;

export const SPLAT_UNIFORM_FLOATS = 12;
export const SPLAT_UNIFORM_BYTES = SPLAT_UNIFORM_FLOATS * 4;

/** Float index of each `AdvectParams` member in `simulation.wgsl`. */
export const ADVECT_PARAM = {
  gridSize: 0,
  dissipation: 2,
} as const;

/** One `vec4f` — the size every pass-parameter buffer is allocated at. */
export const PARAM_FLOATS = 4;
export const PARAM_BYTES = PARAM_FLOATS * 4;

/** The per-frame simulation uniforms, written into `target` so the renderer can
 * keep one array for the lifetime of the device. */
export const packUniforms = (
  target: Float32Array,
  simGrid: Grid,
  dyeGrid: Grid,
  scale: ProjectionScale,
  dt: number,
): void => {
  target.set([simGrid.width, simGrid.height], UNIFORM.simSize);
  target[UNIFORM.dt] = dt;
  target[UNIFORM.aspect] = dyeGrid.width / dyeGrid.height;
  const metric = projectionUniform(scale);
  target.set(metric.toCells, UNIFORM.toCells);
  target.set(metric.toStored, UNIFORM.toStored);
};

export const packSplatUniforms = (
  target: Float32Array,
  splat: Splat,
  radius: number,
): void => {
  target.set([splat.x, splat.y], SPLAT_UNIFORM.point);
  target.set([splat.dx, splat.dy], SPLAT_UNIFORM.delta);
  target.set(splat.color, SPLAT_UNIFORM.color);
  target[SPLAT_UNIFORM.radius] = radius;
};

export const packAdvectParams = (
  grid: Grid,
  dissipation: number,
): Float32Array => {
  const values = new Float32Array(PARAM_FLOATS);
  values.set([grid.width, grid.height], ADVECT_PARAM.gridSize);
  values[ADVECT_PARAM.dissipation] = dissipation;
  return values;
};
