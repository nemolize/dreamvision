import { describe, expect, it } from "vitest";

import { HEAT_PER_DYE } from "./config";
import { projectionScale } from "./projection";
import renderShaderSource from "./render.wgsl?raw";
import simulationShaderSource from "./simulation.wgsl?raw";
import type { Splat } from "./types";
import {
  ADVECT_PARAM,
  DISPLAY_PARAM,
  packAdvectParams,
  packDisplayParams,
  packSplatUniforms,
  packUniforms,
  PARAM_FLOATS,
  SPLAT_UNIFORM,
  SPLAT_UNIFORM_FLOATS,
  UNIFORM,
  UNIFORM_FLOATS,
} from "./uniforms";

/**
 * The host's float offsets, checked against the struct layouts read out of
 * `simulation.wgsl` and `render.wgsl` themselves. Inserting a member shifts
 * every later offset and the fluid still renders — just with a wrong metric,
 * radius or dissipation — so nothing in the picture names the member that
 * moved.
 *
 * The shaders are the oracle rather than a copy of them, so editing a struct
 * fails these tests without anyone having to remember a twin lives here.
 */

/** Float width of each type, which is also its alignment: a `vec2f` aligns to 8
 * bytes and a `vec4f` to 16, which is what opens the holes being pinned. */
const FLOATS: Record<string, number> = { f32: 1, vec2f: 2, vec4f: 4 };

/** Padding members are dropped rather than assigned an offset: they occupy only
 * space the next member's alignment would have skipped anyway. */
const isPadding = (name: string): boolean => name.startsWith("_pad");

/** Fails loudly on an unknown type or a missing struct: silently returning a
 * partial layout would let the assertions below pass while checking less. */
const wgslStruct = (
  name: string,
  source = simulationShaderSource,
): Record<string, number> => {
  const body = new RegExp(`\\bstruct\\s+${name}\\s*\\{([^}]*)\\}`).exec(
    source,
  )?.[1];
  if (body === undefined) throw new Error(`no struct ${name} in the shader`);

  const offsets: Record<string, number> = {};
  let cursor = 0;
  for (const line of body.split("\n")) {
    const member = /^\s*(\w+)\s*:\s*(\w+)\s*,/.exec(
      line.replace(/\/\/.*$/, ""),
    );
    if (member === null) continue;
    const [, memberName, type] = member;
    const floats = FLOATS[type ?? ""];
    if (floats === undefined) throw new Error(`unhandled type ${type ?? ""}`);
    cursor = Math.ceil(cursor / floats) * floats;
    if (memberName !== undefined && !isPadding(memberName)) {
      offsets[memberName] = cursor;
    }
    cursor += floats;
  }
  return offsets;
};

const UNIFORMS_STRUCT = wgslStruct("Uniforms");
const SPLAT_UNIFORMS_STRUCT = wgslStruct("SplatUniforms");
const ADVECT_PARAMS_STRUCT = wgslStruct("AdvectParams");
const DISPLAY_PARAMS_STRUCT = wgslStruct("DisplayParams", renderShaderSource);

const vec2f = FLOATS["vec2f"] ?? 0;
const vec4f = FLOATS["vec4f"] ?? 0;

/** Guards the parser itself: a regex that silently matched nothing would leave
 * every layout empty, and `toStrictEqual({})` against an empty map would pass. */
describe("the shader-derived layouts", () => {
  it("finds every struct the host packs into", () => {
    expect(Object.keys(UNIFORMS_STRUCT)).not.toHaveLength(0);
    expect(Object.keys(SPLAT_UNIFORMS_STRUCT)).not.toHaveLength(0);
    expect(Object.keys(ADVECT_PARAMS_STRUCT)).not.toHaveLength(0);
  });

  it("drops the padding members rather than offsetting them", () => {
    for (const name of Object.keys(SPLAT_UNIFORMS_STRUCT)) {
      expect(isPadding(name)).toBe(false);
    }
  });
});

describe("UNIFORM", () => {
  it("places every member where the shader reads it", () => {
    expect(UNIFORM).toStrictEqual(UNIFORMS_STRUCT);
  });

  it("is sized to hold the struct", () => {
    expect(UNIFORM_FLOATS).toBeGreaterThanOrEqual(UNIFORM.up + vec2f);
    expect(UNIFORM_FLOATS % vec4f).toBe(0);
  });
});

describe("packUniforms", () => {
  const pack = (
    wrapEdges = false,
    vorticity = 0,
    gravity = 0,
    sceneWidth = 1,
    up: readonly [number, number] = [0, -1],
  ): Float32Array => {
    const target = new Float32Array(UNIFORM_FLOATS);
    packUniforms(
      target,
      { width: 64, height: 32 },
      { width: 200, height: 100 },
      projectionScale(64, 32),
      1 / 60,
      wrapEdges,
      vorticity,
      gravity,
      sceneWidth,
      up,
    );
    return target;
  };

  it("writes the wrap flag as 1 when edges join and 0 when they are walls", () => {
    expect(pack(true)[UNIFORM.wrapEdges]).toBe(1);
    expect(pack(false)[UNIFORM.wrapEdges]).toBe(0);
  });

  it("writes the confinement strength into its own member", () => {
    expect(pack(false, 37)[UNIFORM.vorticity]).toBe(37);
  });

  it("writes the gravity in cells per second squared, counted on the simulation grid", () => {
    expect(pack(false, 0, 9.8, 4)[UNIFORM.gravityCells]).toBeCloseTo(
      (9.8 * 64) / 4,
      4,
    );
    expect(pack(false, 0, 0, 4)[UNIFORM.gravityCells]).toBe(0);
  });

  it("counts the gravity on the grid's long side, so turning the screen keeps the lift", () => {
    const packOn = (width: number, height: number): number => {
      const target = new Float32Array(UNIFORM_FLOATS);
      packUniforms(
        target,
        { width, height },
        { width: 200, height: 100 },
        projectionScale(width, height),
        1 / 60,
        false,
        0,
        9.8,
        4,
        [0, -1],
      );
      return target[UNIFORM.gravityCells] ?? Number.NaN;
    };
    expect(packOn(144, 320)).toBeCloseTo(packOn(320, 144), 4);
    expect(packOn(144, 320)).toBeCloseTo((9.8 * 320) / 4, 4);
  });

  it("writes the up direction as an x, y pair", () => {
    const packed = pack(false, 0, 0, 1, [0.6, -0.8]);
    expect(packed[UNIFORM.up]).toBeCloseTo(0.6, 6);
    expect(packed[UNIFORM.up + 1]).toBeCloseTo(-0.8, 6);
  });

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
      true,
      1,
      1,
      1,
      [0, -1],
    );
    for (const offset of Object.values(UNIFORM)) {
      expect(target[offset]).not.toBeNaN();
    }
  });
});

describe("DISPLAY_PARAM", () => {
  it("places every member where the render shader reads it", () => {
    expect(DISPLAY_PARAM).toStrictEqual(DISPLAY_PARAMS_STRUCT);
  });

  it("packs the glow gain into its member of a full parameter block", () => {
    const packed = packDisplayParams(2.5);
    expect(packed).toHaveLength(PARAM_FLOATS);
    expect(packed[DISPLAY_PARAM.glow]).toBe(2.5);
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
  it("adds heat in proportion to the brightest colour channel", () => {
    expect(pack()[SPLAT_UNIFORM.heat]).toBeCloseTo(HEAT_PER_DYE * 0.5, 6);
  });

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
    expect(ADVECT_PARAM.heatDissipation).toBeLessThan(PARAM_FLOATS);
  });

  it("keeps the two decays side by side, which the in-place rewrite relies on", () => {
    expect(ADVECT_PARAM.heatDissipation).toBe(ADVECT_PARAM.dissipation + 1);
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

  it("writes the heat decay apart from the dissipation, and equal to it when omitted", () => {
    const grid = { width: 8, height: 8 };
    const apart = packAdvectParams(grid, 0.6, 2);
    expect(apart[ADVECT_PARAM.heatDissipation]).toBeCloseTo(2);
    expect(apart[ADVECT_PARAM.dissipation]).toBeCloseTo(0.6);
    expect(
      packAdvectParams(grid, 0.6)[ADVECT_PARAM.heatDissipation],
    ).toBeCloseTo(0.6);
  });

  /** `applySettings` rewrites dissipation in place at this byte offset, so a
   * shorter buffer would put that write past the end of the allocation. */
  it("returns a buffer the in-place dissipation write stays inside", () => {
    const packed = packAdvectParams({ width: 8, height: 8 }, 0.2);
    expect(packed).toHaveLength(PARAM_FLOATS);
    expect(ADVECT_PARAM.dissipation * 4).toBeLessThan(packed.byteLength);
  });
});
