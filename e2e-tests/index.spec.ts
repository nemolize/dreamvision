import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { isPreviewTarget } from "./target";

/** Each pass waits a frame: a slow renderer can otherwise swallow the whole
 * drag in one frame, splatting colour but leaving velocity nearly empty. */
const stir = async (
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

/** Columns each screenshot is downsampled to. */
const SAMPLE_WIDTH = 64;

/** Read through a screenshot because a WebGPU canvas does not preserve its
 * drawing buffer: `drawImage` onto a 2D canvas returns transparent black. */
const sampleCanvas = async (page: Page): Promise<number[]> => {
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

const litFraction = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  if (pixels.length === 0) return -1;
  return pixels.filter((sum) => sum > 24).length / pixels.length;
};

/** Mean absolute brightness change between two samples, normalised to 0..1. */
const meanChange = (before: number[], after: number[]): number => {
  if (before.length === 0 || before.length !== after.length) return -1;
  const total = before.reduce(
    (sum, value, i) => sum + Math.abs(value - (after[i] ?? 0)),
    0,
  );
  return total / before.length / 765;
};

test.describe("fluid canvas", () => {
  test("fills the viewport with a canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("DreamVision");

    const canvas = page.getByLabel("Fluid simulation");
    await expect(canvas).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    expect(box?.x).toBeCloseTo(0, 0);
    expect(box?.y).toBeCloseTo(0, 0);
    expect(box?.width).toBeCloseTo(viewport?.width ?? 0, 0);
    expect(box?.height).toBeCloseTo(viewport?.height ?? 0, 0);
  });

  test("renders no controls over the canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();

    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("heading")).toHaveCount(0);
  });

  test("starts the GPU simulation and paints dye where the pointer drags", async ({
    page,
  }) => {
    // Each assertion reads the canvas back through a screenshot, which is slow
    // against CI's software renderer — the default 30s ceiling is not enough.
    test.setTimeout(120_000);

    // Ambient off, so every lit pixel below is the drag's: with the seed burst
    // and idle feed running, dye the pointer never touched would satisfy the
    // same assertions and a no-op drag would pass.
    await page.goto("/?ambient=off");

    const canvas = page.getByLabel("Fluid simulation");
    await expect(canvas).toBeVisible();

    // An adapter-less environment renders the notice instead; failing here
    // rather than skipping keeps a silently broken simulation from passing.
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The canvas starts black, so a lit area proves the compute passes ran and
    // the display pass sampled their output.
    expect(await litFraction(page)).toBeLessThan(0.001);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await stir(page, viewport);

    // Generous because each poll round is a screenshot, which costs seconds
    // against CI's software renderer — a tight window would only get one try.
    await expect
      .poll(() => litFraction(page), { timeout: 60_000 })
      .toBeGreaterThan(0.01);

    // The splat pass alone satisfies the check above; only working advection
    // keeps the picture changing once the pointer is up.
    const changeBetweenFrames = async (): Promise<number> => {
      const before = await sampleCanvas(page);
      const after = await sampleCanvas(page);
      return meanChange(before, after);
    };

    expect(await changeBetweenFrames()).toBeGreaterThan(0.002);
  });

  test("paints the seed burst before any input", async ({ page }) => {
    test.setTimeout(120_000);

    // Seed only: with the idle feed also running, a missing burst would be
    // covered for by the feed's first splat and this would still pass.
    await page.goto("/?ambient=seed");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Polled because the first frame lands behind GPU init, not because the
    // burst takes time — it is injected into the very first step.
    await expect
      .poll(() => litFraction(page), { timeout: 60_000 })
      .toBeGreaterThan(0.01);
  });

  test("keeps feeding itself while the pointer is idle", async ({ page }) => {
    test.setTimeout(120_000);

    // Idle only, so there is no seed burst to mistake for the feed: the canvas
    // opens black and can only light up once the feed's first splat lands.
    await page.goto("/?ambient=idle");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    expect(await litFraction(page)).toBeLessThan(0.001);

    await expect
      .poll(() => litFraction(page), { timeout: 60_000 })
      .toBeGreaterThan(0.01);
  });

  test("serves the SPA shell for a deep route with no file on disk", async ({
    page,
  }) => {
    await page.goto("/some/deep/route");

    await expect(page).toHaveTitle("DreamVision");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();
  });

  test("serves the app from hashed production assets", async ({ page }) => {
    test.skip(!isPreviewTarget, "only meaningful against the production build");

    await page.goto("/");

    const scriptSrc =
      (await page.locator('script[type="module"]').getAttribute("src")) ?? "";
    expect(scriptSrc).toMatch(/^\/assets\/index-[\w-]+\.js$/);

    const response = await page.request.get(scriptSrc);
    expect(response.status()).toBe(200);
  });
});
