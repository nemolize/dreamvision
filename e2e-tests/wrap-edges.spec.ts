import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { WORKGROUP_SIZE } from "../src/fluid/config";
import {
  SPLAT_UNIFORM,
  SPLAT_UNIFORM_FLOATS,
  UNIFORM,
  UNIFORM_FLOATS,
} from "../src/fluid/uniforms";
import { type KernelBuffer, runKernel } from "./shaderKernel";

const SIZE = 8;

const source = readFileSync(
  new URL("../src/fluid/simulation.wgsl", import.meta.url),
  "utf8",
).replaceAll("WORKGROUP_SIZE", String(WORKGROUP_SIZE));

const uniforms = (wrapEdges: boolean): KernelBuffer => {
  const floats = new Array<number>(UNIFORM_FLOATS).fill(0);
  floats.splice(UNIFORM.simSize, 2, SIZE, SIZE);
  floats[UNIFORM.aspect] = 1;
  floats.splice(UNIFORM.toCells, 2, 1, 1);
  floats.splice(UNIFORM.toStored, 2, 1, 1);
  floats[UNIFORM.wrapEdges] = wrapEdges ? 1 : 0;
  return { group: 0, binding: 0, floats };
};

const run = (
  page: Page,
  kernel: Omit<Parameters<typeof runKernel>[0], "source" | "workgroupSize">,
): Promise<number[]> =>
  page.evaluate(runKernel, {
    ...kernel,
    source,
    workgroupSize: WORKGROUP_SIZE,
  });

const texel = (texels: number[], channels: number, x: number, y: number) =>
  texels.slice((y * SIZE + x) * channels, (y * SIZE + x + 1) * channels);

const filled = (texel: number[]): number[] =>
  Array.from({ length: SIZE * SIZE }, () => texel).flat();

test.describe("wrapped edges, read off the shader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("leaves the velocity at an edge cell alone when the edges are wrapped", async ({
    page,
  }) => {
    const project = (wrapEdges: boolean) =>
      run(page, {
        entryPoint: "gradientSubtract",
        width: SIZE,
        height: SIZE,
        textures: [
          { binding: 0, texels: filled([0, 0, 0, 1]) },
          { binding: 1, texels: filled([1, 0.5, 0, 1]) },
        ],
        output: { binding: 2, channels: 4 },
        buffers: [uniforms(wrapEdges)],
      });

    const wrapped = await project(true);
    for (const [x, y] of [
      [0, 3],
      [SIZE - 1, 3],
      [3, 0],
      [3, SIZE - 1],
    ] as const) {
      expect(texel(wrapped, 4, x, y).slice(0, 2)).toEqual([1, 0.5]);
    }

    const walled = await project(false);
    expect(texel(walled, 4, 0, 3).slice(0, 2)).toEqual([0, 0.5]);
    expect(texel(walled, 4, 3, SIZE - 1).slice(0, 2)).toEqual([1, 0]);
  });

  test("measures no divergence across a wrapped edge in a uniform flow", async ({
    page,
  }) => {
    const divergence = (wrapEdges: boolean) =>
      run(page, {
        entryPoint: "divergence",
        width: SIZE,
        height: SIZE,
        textures: [{ binding: 0, texels: filled([1, 1, 0, 1]) }],
        output: { binding: 1, channels: 1 },
        buffers: [uniforms(wrapEdges)],
      });

    expect((await divergence(true)).every((value) => value === 0)).toBe(true);

    const walled = await divergence(false);
    expect(texel(walled, 1, 0, 3)[0]).not.toBe(0);
    expect(texel(walled, 1, 3, 0)[0]).not.toBe(0);
  });

  test("puts a splat's near copy on the far side of a wrapped edge", async ({
    page,
  }) => {
    const splatNear = (wrapEdges: boolean, point: [number, number]) => {
      const splat = new Array<number>(SPLAT_UNIFORM_FLOATS).fill(0);
      splat.splice(SPLAT_UNIFORM.point, 2, ...point);
      splat.splice(SPLAT_UNIFORM.color, 4, 1, 1, 1, 1);
      splat[SPLAT_UNIFORM.radius] = 0.01;
      return run(page, {
        entryPoint: "splat",
        width: SIZE,
        height: SIZE,
        textures: [{ binding: 0, texels: filled([0, 0, 0, 0]) }],
        output: { binding: 1, channels: 4 },
        buffers: [
          uniforms(wrapEdges),
          { group: 1, binding: 2, floats: [SIZE, SIZE, 0, 0] },
          { group: 2, binding: 0, floats: splat },
        ],
      });
    };

    const leftEdge: [number, number] = [0.02, 0.5];
    const topEdge: [number, number] = [0.5, 0.02];

    const wrappedLeft = await splatNear(true, leftEdge);
    expect(texel(wrappedLeft, 4, SIZE - 1, 4)[0]).toBeGreaterThan(0.3);
    const wrappedTop = await splatNear(true, topEdge);
    expect(texel(wrappedTop, 4, 4, SIZE - 1)[0]).toBeGreaterThan(0.3);

    const walledLeft = await splatNear(false, leftEdge);
    expect(texel(walledLeft, 4, SIZE - 1, 4)[0]).toBeLessThan(1e-6);
  });
});
