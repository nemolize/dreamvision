import { expect, test } from "@playwright/test";

import { STATS_WINDOW_MS } from "../src/fluid/config";

const READING = /^(\d+|–) fps · (\d+\.\d|–) ms$/;

declare global {
  interface Window {
    mapGate: {
      armed: boolean;
      held: boolean;
      release: () => void;
      settled: "resolved" | "rejected" | null;
      settledAt: number;
    };
    readings: string[];
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
      const gate: Window["mapGate"] = {
        armed: false,
        held: false,
        release: () => undefined,
        settled: null,
        settledAt: 0,
      };
      window.mapGate = gate;
      Object.defineProperty(GPUBuffer.prototype, "mapAsync", {
        value(this: GPUBuffer, ...args: unknown[]): unknown {
          if (!gate.armed) return Reflect.apply(original, this, args);
          if (gate.held) return new Promise(() => undefined);
          gate.held = true;
          return new Promise((resolve, reject) => {
            gate.release = () => {
              const run: unknown = Reflect.apply(original, this, args);
              Promise.resolve(run).then(
                (value) => {
                  gate.settled = "resolved";
                  gate.settledAt = performance.now();
                  resolve(value);
                },
                (error: unknown) => {
                  gate.settled = "rejected";
                  gate.settledAt = performance.now();
                  reject(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                },
              );
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
      window.mapGate.release();
    });
    // Counted from when the held readback settled, so a slow one still gets
    // its windows; a rejected one would otherwise read as a dropped sample.
    await page.waitForFunction(
      (waitMs) =>
        window.mapGate.settled !== null &&
        performance.now() - window.mapGate.settledAt >= waitMs,
      3 * STATS_WINDOW_MS,
    );
    expect(await page.evaluate(() => window.mapGate.settled)).toBe("resolved");

    const readings = await page.evaluate(() => window.readings);
    expect(readings.filter((text) => /\d\.\d ms$/.test(text))).toEqual([]);
    await expect(readout).toHaveText(/ · – ms$/);
  });
});
