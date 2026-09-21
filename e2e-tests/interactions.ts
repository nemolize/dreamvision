import { expect, type Page } from "@playwright/test";

export const freshPage = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.goto(url);
  await expect(page.getByRole("alert")).toHaveCount(0);
};

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
