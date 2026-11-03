import { expect, type Locator, test } from "@playwright/test";

const outlineStyle = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).outlineStyle);

test.describe("settings panel accessibility", () => {
  test("shows a focus ring on every control for the keyboard, not the mouse", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.locator(".settings__toggle");

    await toggle.click();
    await expect(toggle).toBeFocused();
    await expect(outlineStyle(toggle)).resolves.toBe("none");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await expect(outlineStyle(toggle)).resolves.toBe("solid");

    const controls = [
      page.getByRole("slider").first(),
      page.getByRole("checkbox", { name: "Wrap edges" }),
      page.getByRole("button", { name: "Reset" }),
    ];
    for (const control of controls) {
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
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

    await probe.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(probe).toBeFocused();
    await expect(outlineStyle(probe)).resolves.toBe("solid");
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
