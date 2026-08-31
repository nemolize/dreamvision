import { describe, expect, it } from "vitest";

import { projectionScale } from "./projection";
import type { Splat } from "./types";
import {
  ADVECT_PARAM,
  packAdvectParams,
  packSplatUniforms,
  packUniforms,
  PARAM_FLOATS,
  SPLAT_UNIFORM,
  SPLAT_UNIFORM_FLOATS,
  UNIFORM,
  UNIFORM_FLOATS,
} from "./uniforms";

/**
 * The WGSL struct layouts, transcribed by hand from `simulation.wgsl`, and the
 * packers checked against them. Inserting a member shifts every later offset
 * and the fluid still renders — just with a wrong metric, radius or dissipation
 * — so nothing in the picture names the member that moved.
 *
 * Transcribed, so this checks the host's offsets against a stated layout rather
 * than against the shader: editing a struct means editing its twin here.
 */

/** Float width of each WGSL type, which is also its alignment: a `vec2f` aligns
 * to 8 bytes and a `vec4f` to 16, which is what leaves the holes being pinned. */
const f32 = 1;
const vec2f = 2;
const vec4f = 4;

/** Padding members are omitted: they shift later offsets only by occupying
 * space the alignment of the next member would have skipped anyway. */
const wgslOffsets = (
  members: readonly (readonly [string, number])[],
): Record<string, number> => {
  const offsets: Record<string, number> = {};
  let cursor = 0;
  for (const [name, floats] of members) {
    cursor = Math.ceil(cursor / floats) * floats;
    offsets[name] = cursor;
    cursor += floats;
  }
  return offsets;
};

const UNIFORMS_STRUCT = wgslOffsets([
  ["simSize", vec2f],
  ["dt", f32],
  ["aspect", f32],
  ["toCells", vec2f],
  ["toStored", vec2f],
]);

const SPLAT_UNIFORMS_STRUCT = wgslOffsets([
  ["point", vec2f],
  ["delta", vec2f],
  ["color", vec4f],
  ["radius", f32],
]);

const ADVECT_PARAMS_STRUCT = wgslOffsets([
  ["gridSize", vec2f],
  ["dissipation", f32],
]);

describe("UNIFORM", () => {
  it("places every member where the shader reads it", () => {
    expect(UNIFORM).toStrictEqual(UNIFORMS_STRUCT);
  });

  it("is sized to hold the struct", () => {
    expect(UNIFORM_FLOATS).toBeGreaterThanOrEqual(UNIFORM.toStored + vec2f);
  });
});

describe("packUniforms", () => {
  const pack = (): Float32Array => {
    const target = new Float32Array(UNIFORM_FLOATS);
    packUniforms(
      target,
      { width: 64, height: 32 },
      { width: 200, height: 100 },
      projectionScale(64, 32),
      1 / 60,
    );
    return target;
  };

  it("writes the simulation grid, not the dye grid, into simSize", () => {
    const packed = pack();
    expect([
      packed[UNIFORM.simSize],
      packed[UNIFORM.simSize + 1],
    ]).toStrictEqual([64, 32]);
  });

  it("writes the timestep and the dye grid's aspect", () => {
    const packed = pack();
    expect(packed[UNIFORM.dt]).toBeCloseTo(1 / 60, 6);
    expect(packed[UNIFORM.aspect]).toBeCloseTo(2);
  });

  /** The two conversions are reciprocal per axis, so swapping them reverses the
   * metric on the GPU and the solve still converges — onto the wrong field. */
  it("writes toCells and toStored in that order, not swapped", () => {
    const packed = pack();
    expect([
      packed[UNIFORM.toCells],
      packed[UNIFORM.toCells + 1],
    ]).toStrictEqual([64, 32]);
    expect(packed[UNIFORM.toStored]).toBeCloseTo(1 / 64, 6);
    expect(packed[UNIFORM.toStored + 1]).toBeCloseTo(1 / 32, 6);
  });

  it("leaves no member unwritten", () => {
    const target = new Float32Array(UNIFORM_FLOATS).fill(Number.NaN);
    packUniforms(
      target,
      { width: 8, height: 8 },
      { width: 8, height: 8 },
      projectionScale(8, 8),
      1,
    );
    for (const offset of Object.values(UNIFORM)) {
      expect(target[offset]).not.toBeNaN();
    }
  });
});

describe("SPLAT_UNIFORM", () => {
  it("places every member where the shader reads it", () => {
    expect(SPLAT_UNIFORM).toStrictEqual(SPLAT_UNIFORMS_STRUCT);
  });

  /** Two `vec2f` fill floats 0-3, so `color` lands on the `vec4f` boundary with
   * no hole — but `radius` then sits at 8, not the 7 a packed array would use. */
  it("leaves the hole the vec4f alignment opens after color", () => {
    expect(SPLAT_UNIFORM.color % vec4f).toBe(0);
    expect(SPLAT_UNIFORM.radius).toBe(SPLAT_UNIFORM.color + vec4f);
  });

  it("is padded to the struct's 16-byte alignment", () => {
    expect(SPLAT_UNIFORM_FLOATS % vec4f).toBe(0);
    expect(SPLAT_UNIFORM_FLOATS).toBeGreaterThan(SPLAT_UNIFORM.radius);
  });
});

describe("packSplatUniforms", () => {
  const splat: Splat = {
    x: 0.25,
    y: 0.75,
    dx: -0.5,
    dy: 0.125,
    color: [0.5, 0.25, 0.125],
  };

  const pack = (): Float32Array => {
    const target = new Float32Array(SPLAT_UNIFORM_FLOATS);
    packSplatUniforms(target, splat, 0.0035);
    return target;
  };

  it("writes the position and the displacement into their own slots", () => {
    const packed = pack();
    expect([
      ...packed.slice(SPLAT_UNIFORM.point, SPLAT_UNIFORM.point + vec2f),
    ]).toStrictEqual([0.25, 0.75]);
    expect([
      ...packed.slice(SPLAT_UNIFORM.delta, SPLAT_UNIFORM.delta + vec2f),
    ]).toStrictEqual([-0.5, 0.125]);
  });

  it("writes the three colour components at the vec4f offset", () => {
    const packed = pack();
    expect([
      ...packed.slice(SPLAT_UNIFORM.color, SPLAT_UNIFORM.color + 3),
    ]).toStrictEqual([0.5, 0.25, 0.125]);
  });

  it("writes the radius past the colour's padding", () => {
    const packed = pack();
    expect(packed[SPLAT_UNIFORM.radius]).toBeCloseTo(0.0035, 6);
  });

  /** The renderer reuses one array across a frame's splats, so a member the
   * packer skipped would carry the previous splat's value into this one. */
  it("overwrites every member rather than leaving a stale one", () => {
    const stale = 9;
    const target = new Float32Array(SPLAT_UNIFORM_FLOATS).fill(stale);
    packSplatUniforms(target, splat, 0.0035);
    for (const offset of Object.values(SPLAT_UNIFORM)) {
      expect(target[offset]).not.toBe(stale);
    }
  });
});

describe("ADVECT_PARAM", () => {
  it("places every member where the shader reads it", () => {
    expect(ADVECT_PARAM).toStrictEqual(ADVECT_PARAMS_STRUCT);
  });

  it("fits the one vec4f the buffer is allocated at", () => {
    expect(ADVECT_PARAM.dissipation).toBeLessThan(PARAM_FLOATS);
  });
});

describe("packAdvectParams", () => {
  it("writes the grid and the dissipation into their own slots", () => {
    const packed = packAdvectParams({ width: 320, height: 180 }, 0.6);
    expect([
      packed[ADVECT_PARAM.gridSize],
      packed[ADVECT_PARAM.gridSize + 1],
    ]).toStrictEqual([320, 180]);
    expect(packed[ADVECT_PARAM.dissipation]).toBeCloseTo(0.6);
  });

  /** `applySettings` rewrites dissipation in place at this byte offset, so a
   * shorter buffer would put that write past the end of the allocation. */
  it("returns a buffer the in-place dissipation write stays inside", () => {
    const packed = packAdvectParams({ width: 8, height: 8 }, 0.2);
    expect(packed).toHaveLength(PARAM_FLOATS);
    expect(ADVECT_PARAM.dissipation * 4).toBeLessThan(packed.byteLength);
  });
});
