import { expect, test } from "@playwright/test";

import { litFraction, meanBrightness, sampleCanvas } from "./canvas";

test("reads a black canvas as a valid zero measurement", async ({ page }) => {
  await page.setContent(
    '<canvas aria-label="Fluid simulation" width="64" height="64"></canvas>',
  );
  await page.getByLabel("Fluid simulation").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("No canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No context");
    context.fillRect(0, 0, canvas.width, canvas.height);
  });

  expect(await sampleCanvas(page)).toHaveLength(64 * 64);
  expect(await meanBrightness(page)).toBe(0);
  expect(await litFraction(page)).toBe(0);
});

test("rejects failed sampling instead of reporting an unlit canvas", async ({
  page,
}) => {
  await page.setContent(
    '<canvas aria-label="Fluid simulation" width="64" height="64"></canvas>',
  );
  await page.evaluate(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => null,
    });
  });

  const message = "Cannot sample canvas: 2D context unavailable";
  await expect(sampleCanvas(page)).rejects.toThrow(message);
  await expect(meanBrightness(page)).rejects.toThrow(message);
  await expect(litFraction(page)).rejects.toThrow(message);
});
