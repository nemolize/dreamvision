import { expect, test } from "@playwright/test";

import { STATS_WINDOW_MS } from "../src/fluid/config";

const READING = /^(\d+|–) fps · (\d+\.\d|–) ms$/;

declare global {
  interface Window {
    mapGate: { armed: boolean; held: boolean; release: () => void };
    readings: string[];
    releasedAt: number;
  }
}

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

  test("drops a GPU timing still in flight when the toggle is switched off and on", async ({
    page,
  }) => {
    // Holds the first GPU readback once armed and leaves every later one
    // pending, so the only timing that can reach the readout is the stale one.
    await page.addInitScript(() => {
      const original: unknown = Reflect.get(GPUBuffer.prototype, "mapAsync");
      if (typeof original !== "function") throw new Error("no mapAsync");
      const gate = { armed: false, held: false, release: () => undefined };
      window.mapGate = gate;
      Object.defineProperty(GPUBuffer.prototype, "mapAsync", {
        value(this: GPUBuffer, ...args: unknown[]): unknown {
          if (!gate.armed) return Reflect.apply(original, this, args);
          if (gate.held) return new Promise(() => undefined);
          gate.held = true;
          return new Promise((resolve, reject) => {
            gate.release = () => {
              const run: unknown = Reflect.apply(original, this, args);
              Promise.resolve(run).then(resolve, reject);
            };
          });
        },
      });
    });
    await page.goto("/");
    const readout = page.locator(".frame-stats");
    const toggle = page.getByRole("checkbox", { name: "Frame stats" });

    await page.getByRole("button", { name: "Open settings" }).click();
    await toggle.check();
    await expect(readout).toHaveText(/ · \d+\.\d ms$/, { timeout: 20_000 });

    await page.evaluate(() => {
      window.mapGate.armed = true;
    });
    await page.waitForFunction(() => window.mapGate.held);

    await toggle.uncheck();
    await expect(readout).toHaveCount(0);
    await toggle.check();
    // A closed window means the new listener is installed.
    await expect(readout).toHaveText(/^\d+ fps · – ms$/, { timeout: 20_000 });

    // The stale sample would colour one window only, so every reading seen
    // after the release is kept rather than just the last.
    await page.evaluate(() => {
      window.readings = [];
      new MutationObserver(() => {
        const text = document.querySelector(".frame-stats")?.textContent;
        if (text !== undefined && text !== "") window.readings.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      window.releasedAt = performance.now();
      window.mapGate.release();
    });
    await page.waitForFunction(
      (waitMs) => performance.now() - window.releasedAt >= waitMs,
      3 * STATS_WINDOW_MS,
    );

    const readings = await page.evaluate(() => window.readings);
    expect(readings.filter((text) => /\d\.\d ms$/.test(text))).toEqual([]);
    await expect(readout).toHaveText(/ · – ms$/);
  });
});
