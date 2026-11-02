import { expect, test } from "@playwright/test";

import {
  litFraction,
  meanAround,
  meanBrightness,
  meanChange,
  sampleCanvas,
} from "./canvas";
import {
  cheapenGrids,
  freshPage,
  hideSettings,
  pinStrongSplats,
  settleSlider,
  stir,
  waitFrames,
  whileHidden,
} from "./interactions";
import { isPreviewTarget } from "./target";

const FRAMES_FOR_DECAY_TO_SHOW = 60;

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
    await freshPage(page, "/");
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
    // Two simulation runs, each waiting on frames from CI's software renderer,
    // so the default 30s ceiling is not enough.
    test.setTimeout(180_000);

    const retentionAtDecay = async (decay: string): Promise<number> => {
      await freshPage(page, "/?seed=off");

      await page.getByRole("button", { name: "Open settings" }).click();
      await page.getByRole("slider", { name: "Dye decay" }).fill(decay);
      await cheapenGrids(page);
      await hideSettings(page);

      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      await stir(page, viewport);

      // Each frame advances the simulation by at most 1/30 s, so wall time says
      // nothing about how much the dye has decayed on a slow renderer; frames do.
      await page.evaluate(() => {
        let frames = 0;
        const count = () => {
          frames++;
          document.body.dataset["frames"] = String(frames);
          requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
      });
      const framesSeen = (): Promise<number> =>
        page.evaluate(() => Number(document.body.dataset["frames"] ?? 0));
      const untilFrames = (target: number): Promise<void> =>
        expect
          .poll(framesSeen, { timeout: 120_000 })
          .toBeGreaterThanOrEqual(target);

      await untilFrames(10);
      const before = await meanBrightness(page);
      expect(before).toBeGreaterThan(0);

      await untilFrames((await framesSeen()) + FRAMES_FOR_DECAY_TO_SHOW);
      const after = await meanBrightness(page);
      expect(after).toBeGreaterThanOrEqual(0);
      return after / before;
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

    await freshPage(page, "/?seed=off");

    await page.getByRole("button", { name: "Open settings" }).click();
    // Held still so the reads either side of the rebuild differ by the rebuild
    // and not by however long the screenshots took.
    await page.getByRole("slider", { name: "Dye decay" }).fill("0");
    await pinStrongSplats(page);

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

    await freshPage(page, "/?seed=off");

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
    await freshPage(page, "/");
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
    await page.getByRole("button", { name: "Open settings" }).click();
    await pinStrongSplats(page);
    await hideSettings(page);

    // An adapter-less environment renders the notice instead; failing here
    // rather than skipping keeps a silently broken simulation from passing.
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The canvas starts black, so a lit area proves the compute passes ran and
    // the display pass sampled their output.
    const unlit = await litFraction(page);
    expect(unlit).toBeGreaterThanOrEqual(0);
    expect(unlit).toBeLessThan(0.001);

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

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    // Abandoned mid-canvas, away from the edges, because the disc sampled around
    // it has to stay on the canvas in every direction.
    const abandoned = { x: 0.5, y: 0.5 };
    const at = (point: { x: number; y: number }): [number, number] => [
      viewport.width * point.x,
      viewport.height * point.y,
    ];
    const sum = (pixels: number[]): number =>
      pixels.reduce((total, value) => total + value, 0);

    // Dispatched by hand because Playwright's mouse cannot revoke a capture; the
    // id must be its own 1, since PointerEvent's default 0 matches no stroke.
    const revokeCapture = (): Promise<void> =>
      page.evaluate(() => {
        document.querySelector("canvas")?.dispatchEvent(
          new PointerEvent("lostpointercapture", {
            bubbles: true,
            pointerId: 1,
          }),
        );
      });
    const holdStroke = (): Promise<void> => Promise.resolve();

    const fieldGrowth = async (
      release: () => Promise<void>,
    ): Promise<number> => {
      await freshPage(page, "/?seed=off");

      await page.getByRole("button", { name: "Open settings" }).click();
      // Pinned so the revoked field fades clearly yet stays above zero, and the
      // stroke is one the reads can see, whatever the defaults are.
      await page.getByRole("slider", { name: "Dye decay" }).fill("1");
      await pinStrongSplats(page);
      await cheapenGrids(page);
      await hideSettings(page);

      await page.mouse.move(...at({ x: 0.3, y: abandoned.y }));
      await page.mouse.down();
      await page.mouse.move(...at(abandoned), { steps: 6 });

      await release();

      // Settled first because the dye already painted keeps advecting for a
      // while, and that motion is not what this test is about.
      await waitFrames(page, 20);
      const before = await sampleCanvas(page);

      await waitFrames(page, 40);
      const after = await sampleCanvas(page);

      // Asserted before the ratio because every degenerate reading divides out to
      // 1 and passes: an unpainted drag would otherwise verify nothing at all.
      expect(meanAround(before, abandoned, 0.06)).toBeGreaterThan(0);
      expect(sum(before)).toBeGreaterThan(0);
      expect(meanAround(after, abandoned, 0.06)).toBeGreaterThan(0);

      await page.mouse.up();
      return sum(after) / sum(before);
    };

    const revoked = await fieldGrowth(revokeCapture);
    const stranded = await fieldGrowth(holdStroke);

    // A stranded stroke keeps splatting, so its field decays less; compared with
    // it because the decay depends on the frame rate. 0.8 is chosen empirically.
    expect(revoked).toBeLessThan(stranded * 0.8);
  });

  test("lets dye cross an edge only when the edges are wrapped", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const leftEdgeBrightness = async (wrap: boolean): Promise<number> => {
      await freshPage(page, "/?seed=off");

      await page.getByRole("button", { name: "Open settings" }).click();
      await settleSlider(page, "Splat force", "60");
      await cheapenGrids(page);
      await page.getByRole("checkbox", { name: "Wrap edges" }).setChecked(wrap);
      await hideSettings(page);

      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      const midY = viewport.height / 2;
      // Ends far enough from the edge that the splat itself, wrapped, reaches
      // nothing on the far side: only the flow can carry dye across.
      await page.mouse.move(viewport.width * 0.5, midY);
      await page.mouse.down();
      for (let pass = 1; pass <= 4; pass++) {
        await page.mouse.move(viewport.width * (0.5 + 0.0875 * pass), midY, {
          steps: 6,
        });
        await waitFrames(page, 1);
      }
      await page.mouse.up();

      await waitFrames(page, 60);
      return meanAround(await sampleCanvas(page), { x: 0.03, y: 0.5 }, 0.06);
    };

    const walled = await leftEdgeBrightness(false);
    const wrapped = await leftEdgeBrightness(true);

    // 10 is chosen empirically, no fixed source.
    expect(walled).toBeLessThan(1);
    expect(wrapped).toBeGreaterThan(10);
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
