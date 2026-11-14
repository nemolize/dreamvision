import { describe, expect, it } from "vitest";

import renderShaderSource from "./render.wgsl?raw";

describe("the display shader", () => {
  it("brightens the colour by the heat in the dye's alpha channel", () => {
    expect(renderShaderSource).toMatch(
      /let colour = sampled\.rgb \* \(1\.0 \+ displayParams\.glow \* sampled\.a\);/,
    );
  });

  it("interpolates heat along with the colour", () => {
    expect(renderShaderSource).toMatch(/fn sampleDye\(uv: vec2f\) -> vec4f/);
    expect(renderShaderSource).toMatch(
      /return textureLoad\(dye, clamp\(cell, vec2i\(0, 0\), maxCell\), 0\);/,
    );
  });

  it("reads the glow gain from the display uniform, not a shader constant", () => {
    expect(renderShaderSource).not.toMatch(/const HEAT_GLOW/);
    expect(renderShaderSource).toMatch(
      /@group\(0\) @binding\(1\) var<uniform> displayParams: DisplayParams;/,
    );
  });
});
