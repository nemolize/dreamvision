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
const hideSettings = async (page: Page, hidden = true): Promise<void> => {
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

const whileHidden = async <T>(
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
const settleSlider = async (
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

/** Mean brightness near a point. Both `point` and `radius` are fractions of the
 * canvas, because callers hold viewport-relative positions, not sample indices. */
const meanAround = (
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
    await expect(page.getByRole("slider")).toHaveCount(7);
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

  test("carries both fields across a resolution change instead of blanking them", async ({
    page,
  }) => {
    // Raised because each canvas read is a screenshot, which costs seconds
    // against CI's software renderer — the default 30s ceiling is not enough.
    test.setTimeout(180_000);

    await page.goto("/?seed=off");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto("/?seed=off");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Open settings" }).click();
    // Held still so the reads either side of the rebuild differ by the rebuild
    // and not by however long the screenshots took.
    await page.getByRole("slider", { name: "Dye decay" }).fill("0");

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await stir(page, viewport);

    const before = await whileHidden(page, () => meanBrightness(page));
    expect(before).toBeGreaterThan(0);

    await settleSlider(page, "Sim grid", "128");
    await settleSlider(page, "Dye grid", "512");
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );

    // Releasing the old textures before building the new ones would read as 0
    // here; the resample pass is the only thing that keeps the dye.
    const after = await whileHidden(page, () => meanBrightness(page));
    expect(after).toBeGreaterThan(before * 0.5);

    // Brightness cannot see the velocity half of the carry — dropping it freezes
    // the fluid with every lit pixel in place; only motion shows it survived.
    const changed = await whileHidden(page, async () => {
      const first = await sampleCanvas(page);
      const second = await sampleCanvas(page);
      return meanChange(first, second);
    });
    expect(changed).toBeGreaterThan(0.002);
  });

  test("keeps simulating at the highest resolution the panel offers", async ({
    page,
  }) => {
    // Raised because each canvas read is a screenshot, which costs seconds
    // against CI's software renderer — the default 30s ceiling is not enough.
    test.setTimeout(180_000);

    await page.goto("/?seed=off");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto("/?seed=off");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Open settings" }).click();
    const sim = page.getByRole("slider", { name: "Sim grid" });
    const dye = page.getByRole("slider", { name: "Dye grid" });
    await settleSlider(
      page,
      "Sim grid",
      (await sim.getAttribute("max")) ?? "512",
    );
    await settleSlider(
      page,
      "Dye grid",
      (await dye.getAttribute("max")) ?? "2048",
    );

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await stir(page, viewport);

    // The maxima are the one pair of values nothing else exercises, and the
    // device that cannot hold them fails here rather than in someone's browser.
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => litFraction(page), { timeout: 60_000 })
      .toBeGreaterThan(0.01);
  });

  test("restores a changed resolution after a reload", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    const initial = await page
      .getByRole("slider", { name: "Sim grid" })
      .inputValue();
    await settleSlider(page, "Sim grid", "160");

    await page.reload();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("slider", { name: "Sim grid" })).toHaveValue(
      "160",
    );

    await page.getByRole("button", { name: "Reset" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("slider", { name: "Sim grid" })).toHaveValue(
      initial,
    );
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

  test("stops painting when the browser revokes the pointer capture", async ({
    page,
  }) => {
    // Raised because each canvas read is a screenshot, which costs seconds
    // against CI's software renderer — the default 30s ceiling is not enough.
    test.setTimeout(180_000);

    await page.goto("/?seed=off");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto("/?seed=off");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await hideSettings(page);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    // Abandoned mid-canvas, away from the edges, because the disc sampled around
    // it has to stay on the canvas in every direction.
    const abandoned = { x: 0.5, y: 0.5 };
    const at = (point: { x: number; y: number }): [number, number] => [
      viewport.width * point.x,
      viewport.height * point.y,
    ];

    await page.mouse.move(...at({ x: 0.3, y: abandoned.y }));
    await page.mouse.down();
    await page.mouse.move(...at(abandoned), { steps: 6 });

    // Dispatched by hand because Playwright's mouse cannot revoke a capture; the
    // id must be its own 1, since PointerEvent's default 0 matches no stroke.
    await page.evaluate(() => {
      document.querySelector("canvas")?.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          bubbles: true,
          pointerId: 1,
        }),
      );
    });

    // Settled first because the dye already painted keeps advecting for a
    // while, and that motion is not what this test is about.
    /* eslint-disable playwright/no-wait-for-timeout */
    await page.waitForTimeout(3000);
    const before = await sampleCanvas(page);

    await page.waitForTimeout(4000);
    /* eslint-enable playwright/no-wait-for-timeout */
    const after = await sampleCanvas(page);

    const sum = (pixels: number[]): number =>
      pixels.reduce((total, value) => total + value, 0);
    const localBefore = meanAround(before, abandoned, 0.06);

    // Asserted before the ratio because every degenerate reading divides out to
    // 1 and passes: an unpainted drag would otherwise verify nothing at all.
    expect(localBefore).toBeGreaterThan(0);
    expect(sum(before)).toBeGreaterThan(0);

    // Compared against the field's own growth because dye keeps spreading
    // either way — an absolute rise fires on both the fixed and broken builds.
    const localGrowth = meanAround(after, abandoned, 0.06) / localBefore;
    const fieldGrowth = sum(after) / sum(before);

    // A stranded stroke re-splats its last position every frame, so its dye
    // piles up there faster than the field as a whole moves.
    expect(
      localGrowth,
      `local ${localGrowth.toFixed(3)} vs field ${fieldGrowth.toFixed(3)}`,
    ).toBeLessThan(fieldGrowth * 1.3);

    await page.mouse.up();
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
