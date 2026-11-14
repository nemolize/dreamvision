import { expect, type Locator, type Page, test } from "@playwright/test";

import { LOG_TRACK_STEPS } from "@/fluid/descriptor";

const outlineStyle = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).outlineStyle);

/** `:focus-visible` matches only focus the browser attributes to the keyboard,
 * so a bare `focus()` after a click would show no ring. */
const focusWithKeyboard = async (
  page: Page,
  control: Locator,
): Promise<void> => {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
};

test.describe("settings panel accessibility", () => {
  test("shows a focus ring on every control for the keyboard, not the mouse", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.locator(".settings__toggle");

    await toggle.click();
    await expect(toggle).toBeFocused();
    await expect(outlineStyle(toggle)).resolves.toBe("none");

    await focusWithKeyboard(page, toggle);
    await expect(outlineStyle(toggle)).resolves.toBe("solid");
    expect(
      await toggle.evaluate((element) => getComputedStyle(element).boxShadow),
    ).not.toBe("none");

    const controls = [
      page.getByRole("slider").first(),
      page.getByRole("checkbox", { name: "Wrap edges" }),
      page.getByRole("button", { name: "Reset" }),
    ];
    for (const control of controls) {
      await focusWithKeyboard(page, control);
      await expect(outlineStyle(control)).resolves.toBe("solid");
    }
  });

  test("rings the notice's action button too", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.className = "notice__action";
      button.textContent = "Probe";
      document.body.append(button);
    });
    const probe = page.getByRole("button", { name: "Probe" });

    await focusWithKeyboard(page, probe);
    await expect(outlineStyle(probe)).resolves.toBe("solid");
  });

  test("rings the canvas, the first tab stop, inside the viewport", async ({
    page,
  }) => {
    await page.goto("/");
    const canvas = page.getByLabel("Fluid simulation");

    await focusWithKeyboard(page, canvas);
    await expect(outlineStyle(canvas)).resolves.toBe("solid");
    expect(
      await canvas.evaluate(
        (element) => getComputedStyle(element).outlineOffset,
      ),
    ).toBe("-4px");
    expect(
      await canvas.evaluate((element) => getComputedStyle(element).boxShadow),
    ).toBe("none");
  });

  test("keeps the focus ring of the last slider inside the scrolled panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    // Tabbing down from the toggle scrolls only far enough to reveal each
    // control, which is where a ring gets cut off.
    const last = page.getByRole("slider").last();
    const stopsBefore = await last.evaluate(
      (element) =>
        Array.from(
          element.closest(".settings__panel")?.querySelectorAll("input") ?? [],
        ).findIndex((input) => input === element) + 1,
    );
    for (let press = 0; press < stopsBefore; press++) {
      await page.keyboard.press("Tab");
    }
    await expect(last).toBeFocused();

    const { ringBottom, panelBottom } = await last.evaluate((element) => {
      const panel = element.closest(".settings__panel");
      if (panel === null) throw new Error("slider outside the panel");
      const style = getComputedStyle(element);
      const reach =
        parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return {
        ringBottom: element.getBoundingClientRect().bottom + reach,
        panelBottom: panel.getBoundingClientRect().bottom,
      };
    });
    expect(ringBottom).toBeLessThanOrEqual(panelBottom);
  });

  test("scrolls the panel on a short viewport so Reset stays reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    const panel = page.locator(".settings__panel");
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeLessThanOrEqual(
      360,
    );
    expect(
      await panel.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);

    const reset = page.getByRole("button", { name: "Reset" });
    await reset.focus();
    await expect(reset).toBeInViewport({ ratio: 1 });
  });

  test("adds no scrollbar when the whole panel fits", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    const panel = page.locator(".settings__panel");
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
  });
});

const boxOf = async (
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return box;
};

test.describe("Scale slider", () => {
  test("reaches both ends of its range and the small widths with a pointer", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    const slider = page.getByRole("slider", { name: "Scale" });
    const box = await boxOf(slider);
    const midY = box.y + box.height / 2;
    const shown = async (): Promise<number> =>
      Number(await slider.getAttribute("aria-valuetext"));

    const share =
      Number(await slider.inputValue()) /
      Number(await slider.getAttribute("max"));
    await expect(shown()).resolves.toBe(3);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.75);

    await page.mouse.click(box.x + 1, midY);
    await expect(slider).toHaveValue("0");
    await expect.poll(shown).toBe(0.01);

    await page.mouse.click(box.x + box.width - 1, midY);
    await expect(slider).toHaveValue(String(LOG_TRACK_STEPS));
    await expect.poll(shown).toBe(100);

    await page.mouse.click(box.x + box.width * 0.3, midY);
    await expect.poll(shown).toBeLessThan(0.3);
    expect(await shown()).toBeGreaterThan(0.01);
  });
});
