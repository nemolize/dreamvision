import type { Page } from "@playwright/test";

/** Each pass waits a frame: a slow renderer can otherwise swallow the whole
 * drag in one frame, splatting colour but leaving velocity nearly empty. */
export const stir = async (
  page: Page,
  size: { width: number; height: number },
): Promise<void> => {
  const midY = size.height / 2;
  await page.mouse.move(size.width * 0.3, midY);
  await page.mouse.down();

  for (let pass = 1; pass <= 4; pass++) {
    await page.mouse.move(size.width * (0.3 + 0.1 * pass), midY, { steps: 6 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  }

  await page.mouse.up();
};

const SAMPLE_WIDTH = 64;

/** The settings toggle sits over the canvas, and an element screenshot
 * composites it in — its lit corner otherwise counts as dye. */
export const hideSettings = async (
  page: Page,
  hidden = true,
): Promise<void> => {
  await page.evaluate((on) => {
    const id = "e2e-hide-settings";
    document.getElementById(id)?.remove();
    if (!on) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = ".settings { display: none; }";
    document.head.append(style);
  }, hidden);
};

export const whileHidden = async <T>(
  page: Page,
  read: () => Promise<T>,
): Promise<T> => {
  await hideSettings(page);
  try {
    return await read();
  } finally {
    await hideSettings(page, false);
  }
};

/** Blurs as well as fills, because a resolution row reports its value on
 * release: `fill` alone leaves the panel treating the drag as still in hand. */
export const settleSlider = async (
  page: Page,
  name: string,
  value: string,
): Promise<void> => {
  const slider = page.getByRole("slider", { name });
  await slider.fill(value);
  await slider.blur();
};

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
      if (ctx === null) return [];
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

/** -1 when the canvas could not be sampled, so assert with a lower bound: an
 * upper-bound assertion passes on the sentinel. */
export const meanBrightness = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  if (pixels.length === 0) return -1;
  return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
};

/** Above the darkest few levels of an unlit canvas, so compression noise on a
 * black frame does not read as paint. */
const LIT_THRESHOLD = 24;

/** -1 when the canvas could not be sampled — see `meanBrightness`. */
export const litFraction = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  if (pixels.length === 0) return -1;
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
