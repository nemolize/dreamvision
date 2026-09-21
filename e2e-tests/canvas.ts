import type { Page } from "@playwright/test";

const SAMPLE_WIDTH = 64;

/** Read through a screenshot because a WebGPU canvas does not preserve its
 * drawing buffer: `drawImage` onto a 2D canvas returns transparent black. */
export const sampleCanvas = async (page: Page): Promise<number[]> => {
  const png = await page.getByLabel("Fluid simulation").screenshot();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

  return page.evaluate(
    async ({ url, width }) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const height = Math.max(
        1,
        Math.round((width * bitmap.height) / bitmap.width),
      );
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      const ctx = surface.getContext("2d");
      if (ctx === null) {
        throw new Error("Cannot sample canvas: 2D context unavailable");
      }
      ctx.drawImage(bitmap, 0, 0, width, height);

      const { data } = ctx.getImageData(0, 0, width, height);
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0));
      }
      return pixels;
    },
    { url: dataUrl, width: SAMPLE_WIDTH },
  );
};

export const meanBrightness = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
};

/** Above the darkest few levels of an unlit canvas, so compression noise on a
 * black frame does not read as paint. */
const LIT_THRESHOLD = 24;

export const litFraction = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  return pixels.filter((sum) => sum > LIT_THRESHOLD).length / pixels.length;
};

/** `point` and `radius` are canvas fractions, because callers hold
 * viewport-relative positions rather than sample indices. */
export const meanAround = (
  pixels: number[],
  point: { x: number; y: number },
  radius: number,
): number => {
  const height = Math.round(pixels.length / SAMPLE_WIDTH);
  const inside: number[] = [];
  for (const [index, value] of pixels.entries()) {
    const x = (index % SAMPLE_WIDTH) / SAMPLE_WIDTH;
    const y = Math.floor(index / SAMPLE_WIDTH) / height;
    if (Math.hypot(x - point.x, y - point.y) <= radius) inside.push(value);
  }
  if (inside.length === 0) return -1;
  return inside.reduce((sum, value) => sum + value, 0) / inside.length;
};

const MAX_PIXEL_SUM = 3 * 255;

export const meanChange = (before: number[], after: number[]): number => {
  if (before.length === 0 || before.length !== after.length) return -1;
  const total = before.reduce(
    (sum, value, i) => sum + Math.abs(value - (after[i] ?? 0)),
    0,
  );
  return total / before.length / MAX_PIXEL_SUM;
};
