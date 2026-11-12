import { describe, expect, it } from "vitest";

import renderShaderSource from "./render.wgsl?raw";

describe("the display shader", () => {
  it("brightens the colour by the heat in the dye's alpha channel", () => {
    expect(renderShaderSource).toMatch(
      /let colour = sampled\.rgb \* \(1\.0 \+ HEAT_GLOW \* sampled\.a\);/,
    );
  });

  it("interpolates heat along with the colour", () => {
    expect(renderShaderSource).toMatch(/fn sampleDye\(uv: vec2f\) -> vec4f/);
    expect(renderShaderSource).toMatch(
      /return textureLoad\(dye, clamp\(cell, vec2i\(0, 0\), maxCell\), 0\);/,
    );
  });

  it("gives the glow a positive gain", () => {
    const gain = /const HEAT_GLOW: f32 = ([\d.]+);/.exec(
      renderShaderSource,
    )?.[1];
    expect(Number(gain)).toBeGreaterThan(0);
  });
});
