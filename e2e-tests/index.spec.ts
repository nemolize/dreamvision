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

/** The settings toggle sits over the canvas, and an element screenshot
 * composites it in — its lit corner otherwise counts as dye. */
const hideSettings = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: ".settings { display: none; }" });
};

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

const meanBrightness = async (page: Page): Promise<number> => {
  const pixels = await sampleCanvas(page);
  if (pixels.length === 0) return -1;
  return pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
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

  test("keeps the settings panel collapsed until it is opened", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();

    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("heading")).toHaveCount(0);

    await page.getByRole("button", { name: "Open settings" }).click();

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(5);
  });

  test("restores a changed setting after a reload, and drops it on reset", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    const force = page.getByRole("slider", { name: "Splat force" });
    const initial = await force.inputValue();
    await force.fill("77");

    await page.reload();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("slider", { name: "Splat force" })).toHaveValue(
      "77",
    );

    await page.getByRole("button", { name: "Reset" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("slider", { name: "Splat force" })).toHaveValue(
      initial,
    );
  });

  test("stores a setting on its own, without waiting for the page to hide", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("slider", { name: "Splat force" }).fill("64");

    // Read from the live page because a reload flushes the pending write on its
    // way out, and would pass even if the debounce never fired.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("dreamvision.settings"),
        ),
      )
      .toContain('"splatForce":64');
  });

  test("carries the dye decay slider through to the solver", async ({
    page,
  }) => {
    // Two full simulation runs, each settling for seconds against CI's software
    // renderer, so the default 30s ceiling is not enough.
    test.setTimeout(180_000);

    const retentionAtDecay = async (decay: string): Promise<number> => {
      await page.goto("/?seed=off");
      await page.evaluate(() => {
        window.localStorage.clear();
      });
      await page.goto("/?seed=off");
      await expect(page.getByRole("alert")).toHaveCount(0);

      await page.getByRole("button", { name: "Open settings" }).click();
      await page.getByRole("slider", { name: "Dye decay" }).fill(decay);
      await hideSettings(page);

      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      await stir(page, viewport);

      // Elapsed time is the variable under test — decay is a rate — so these
      // wait for a fixed span rather than for a condition to become true.
      /* eslint-disable playwright/no-wait-for-timeout */
      await page.waitForTimeout(1000);
      const before = await meanBrightness(page);
      expect(before).toBeGreaterThan(0);

      await page.waitForTimeout(4000);
      /* eslint-enable playwright/no-wait-for-timeout */
      return (await meanBrightness(page)) / before;
    };

    // Nothing below the GPU boundary is observable from the DOM, so the dye's
    // own fade rate is the only evidence the slider's value arrived.
    const slow = await retentionAtDecay("0");
    const fast = await retentionAtDecay("3");

    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeLessThan(0.2);
  });

  test("starts the GPU simulation and paints dye where the pointer drags", async ({
    page,
  }) => {
    // Each assertion reads the canvas back through a screenshot, which is slow
    // against CI's software renderer — the default 30s ceiling is not enough.
    test.setTimeout(120_000);

    // Seed off, so every lit pixel below is the drag's: with the burst running,
    // dye the pointer never touched satisfies the same assertions and a no-op
    // drag passes.
    await page.goto("/?seed=off");

    const canvas = page.getByLabel("Fluid simulation");
    await expect(canvas).toBeVisible();
    await hideSettings(page);

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

    await page.goto("/");
    await expect(page.getByLabel("Fluid simulation")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await hideSettings(page);

    // Nothing touches the pointer, and the sibling test above shows the canvas
    // stays black without the burst — so this lights up only if it ran. Polled
    // because the first frame lands behind GPU init, not because it takes time.
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
