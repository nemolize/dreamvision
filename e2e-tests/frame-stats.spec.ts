import { expect, test } from "@playwright/test";

const READING = /^(\d+|–) fps · (\d+\.\d|–) ms$/;

test.describe("frame stats readout", () => {
  test("is absent until the panel's toggle is ticked, and shows a reading in the corner with the panel closed", async ({
    page,
  }) => {
    await page.goto("/");
    const readout = page.locator(".frame-stats");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();
    await expect(readout).toHaveCount(0);

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("checkbox", { name: "Frame stats" }).check();
    await page.getByRole("button", { name: "Close settings" }).click();

    await expect(readout).toHaveText(READING);
    await expect(readout).toHaveText(/^\d+ fps/);
  });

  test("stays on across a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("checkbox", { name: "Frame stats" }).check();

    await page.reload();

    await expect(page.locator(".frame-stats")).toHaveText(READING);
  });
});
