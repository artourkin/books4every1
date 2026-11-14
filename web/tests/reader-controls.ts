import { expect, type Page } from "@playwright/test";
export async function tapControl(page: Page, name: string) {
  const control = page.getByRole("button", { name, exact: true });
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  if (await page.evaluate(() => (window.visualViewport?.scale || 1) > 1.01)) {
    const point = await control.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        v = window.visualViewport!;
      return {
        x: r.x + r.width / 2 - v.offsetLeft,
        y: r.y + r.height / 2 - v.offsetTop,
      };
    });
    await page.touchscreen.tap(point.x, point.y);
  } else await control.click();
}
export async function showControls(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Show reading controls", exact: true })
      .isVisible()
  )
    await tapControl(page, "Show reading controls");
}
export async function readerOptions(page: Page) {
  await showControls(page);
  if (
    !(await page
      .getByRole("dialog", { name: "Reader options", exact: true })
      .isVisible())
  )
    await tapControl(page, "Reader options");
}
export async function finishWriting(page: Page) {
  if (
    !(await page
      .getByRole("button", { name: "Finish writing", exact: true })
      .isVisible())
  )
    await readerOptions(page);
  await tapControl(page, "Finish writing");
}
export async function morePenSettings(page: Page) {
  const button = page.getByRole("button", {
    name: "More pen settings",
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) === "false")
    await tapControl(page, "More pen settings");
}
