import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { isPreviewTarget } from "./target";

/** Drag across the middle of the viewport in steps, so the pointer accumulates
 * motion the way a real drag does — one jump would splat colour but impart
 * almost no velocity. */
const stir = async (
  page: Page,
  size: { width: number; height: number },
): Promise<void> => {
  const midY = size.height / 2;
  await page.mouse.move(size.width * 0.3, midY);
  await page.mouse.down();
  await page.mouse.move(size.width * 0.7, midY, { steps: 24 });
  await page.mouse.up();
};

/** Fraction of pixels that are not near-black, read back through a screenshot:
 * a WebGPU canvas does not preserve its drawing buffer, so `drawImage` onto a
 * 2D canvas returns transparent black no matter what was presented. */
const litFraction = async (page: Page): Promise<number> => {
  const png = await page.getByLabel("Fluid simulation").screenshot();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

  return page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const ctx = surface.getContext("2d");
    if (ctx === null) return -1;
    ctx.drawImage(bitmap, 0, 0);

    const { data } = ctx.getImageData(0, 0, surface.width, surface.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 24) {
        lit++;
      }
    }
    return lit / (data.length / 4);
  }, dataUrl);
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
    await page.goto("/");

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

    await expect
      .poll(() => litFraction(page), { timeout: 10_000 })
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
