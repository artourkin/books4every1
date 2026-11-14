import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resetPreferences } from "./preferences-fixture";
import {
  showControls,
  finishWriting,
  morePenSettings,
  tapControl,
} from "./reader-controls";
test.beforeEach(async ({ request }) => {
  await resetPreferences(request);
  for (const b of await (await request.get("/api/v1/books")).json())
    await request.delete("/api/v1/books/" + b.id);
});
async function open(page: Page, request: APIRequestContext) {
  await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "layout.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(
          path.resolve("tests/fixtures/reading-notes.pdf"),
        ),
      },
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Read layout", exact: true }).click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}
async function draw(page: Page, count: number) {
  const layer = page.locator(".pdf-ink-layer"),
    box = (await layer.boundingBox())!;
  const pen = {
    pointerId: 42,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.7,
    clientX: box.x + box.width * 0.2,
    clientY: box.y + box.height * 0.3,
  };
  await layer.dispatchEvent("pointerdown", pen);
  await expect(
    page.getByRole("button", { name: "Show reading controls" }),
  ).toBeDisabled();
  await layer.dispatchEvent("pointermove", {
    ...pen,
    clientX: box.x + box.width * 0.6,
  });
  await layer.dispatchEvent("pointerup", {
    ...pen,
    buttons: 0,
    clientX: box.x + box.width * 0.6,
  });
  await expect(page.locator(".ink-stroke")).toHaveCount(count);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}
test("writing tucks the dock away without losing strokes and idle controls also tuck while zoomed", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await draw(page, 1);
  await expect(
    page.getByRole("navigation", { name: "Reading controls" }),
  ).toHaveCount(0);
  await expect(page.locator(".pdf-ink-layer")).toHaveClass(/ink-enabled/);
  await draw(page, 2);
  await expect(
    page.getByRole("navigation", { name: "Reading controls" }),
  ).toHaveCount(0);
  await showControls(page);
  await page.getByRole("button", { name: "Undo ink", exact: true }).click();
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await finishWriting(page);
  await page.locator(".reader").focus();
  await expect(
    page.getByRole("button", { name: "Show reading controls" }),
  ).toBeVisible({ timeout: 6000 });
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await showControls(page);
  await page.locator(".reader").focus();
  await expect(
    page.getByRole("button", { name: "Show reading controls" }),
  ).toBeVisible({ timeout: 6000 });
  await showControls(page);
  await tapControl(page, "Next page");
  await expect(
    page.getByRole("button", { name: "Go to page, page 2 of 2", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => visualViewport!.scale)).toBeCloseTo(2, 1);
  await context.close();
});
test("short landscape and narrow portrait keep controls reachable without shrinking touch targets", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 320 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await page.getByRole("button", { name: "Pen options", exact: true }).click();
  for (const height of [320, 280, 240]) {
    await page.setViewportSize({ width: 915, height });
    await expect
      .poll(async () => {
        const rail = (await page
            .locator(".reader-floating-navigation")
            .boundingBox())!,
          palette = (await page.locator(".pen-options").boundingBox())!;
        return (
          rail.y >= 8 &&
          rail.y + rail.height <= height - 8 &&
          rail.width <= 56 &&
          palette.y >= 8 &&
          palette.y + palette.height <= height - 8
        );
      })
      .toBe(true);
  }
  await morePenSettings(page);
  await page.getByRole("checkbox", { name: "Finger drawing" }).check();
  await page.getByRole("button", { name: "Close pen options" }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await showControls(page);
  const dock = (await page
    .locator(".reader-floating-navigation")
    .boundingBox())!;
  expect(dock.x).toBeGreaterThanOrEqual(8);
  expect(dock.x + dock.width).toBeLessThanOrEqual(312);
  expect(dock.height).toBeLessThanOrEqual(56);
  const sizes = await page
    .locator(".reader-floating-navigation button:visible")
    .evaluateAll((nodes) =>
      nodes.map((el) => el.getBoundingClientRect().width),
    );
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
  await context.close();
});
