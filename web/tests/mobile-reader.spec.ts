import {
  showControls,
  finishWriting,
  readerOptions,
  morePenSettings,
} from "./reader-controls";
import { resetPreferences } from "./preferences-fixture";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ request }) => {
  await resetPreferences(request);
  for (const b of await (await request.get("/api/v1/books")).json())
    await request.delete("/api/v1/books/" + b.id);
});
async function addPDF(request: APIRequestContext) {
  await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "sharpness.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(
          path.resolve("tests/fixtures/reading-notes.pdf"),
        ),
      },
    },
  });
}
async function open(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Read sharpness", exact: true })
    .click();
  await expect(page.locator(".pdf-page canvas")).toHaveAttribute(
    "data-render-scale",
    /[0-9]/,
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}
async function raster(page: Page) {
  return page.locator(".pdf-page canvas").evaluate((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
    cssWidth: c.getBoundingClientRect().width,
    cssHeight: c.getBoundingClientRect().height,
    alpha: c.getContext("2d")!.getImageData(0, 0, 1, 1).data[3],
  }));
}
async function draw(page: Page) {
  const layer = page.locator(".pdf-ink-layer"),
    box = (await layer.boundingBox())!;
  const event = {
    pointerId: 42,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.7,
    clientX: box.x + box.width * 0.2,
    clientY: box.y + box.height * 0.3,
  };
  await layer.dispatchEvent("pointerdown", event);
  await layer.dispatchEvent("pointermove", {
    ...event,
    clientX: box.x + box.width * 0.6,
  });
  await layer.dispatchEvent("pointerup", {
    ...event,
    buttons: 0,
    clientX: box.x + box.width * 0.6,
  });
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}

test("phone PDF starts sharp, sharpens after pinch zoom, and preserves ink and text selection", async ({
  browser,
  request,
}) => {
  await addPDF(request);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const initial = await raster(page);
  expect(initial.width).toBeGreaterThanOrEqual(2047);
  expect(initial.cssWidth).toBeCloseTo(412, 0);
  expect(initial.width / initial.cssWidth).toBeGreaterThan(3.5);
  expect(initial.alpha).toBe(255);
  await page.getByRole("button", { name: "Draw on PDF" }).click();
  await draw(page);
  const ink = await page.locator(".ink-stroke").getAttribute("d");
  await finishWriting(page);
  const text = page
    .locator(".textLayer span")
    .filter({ hasText: "A book is a quiet place" })
    .first();
  await text.evaluate((el) => {
    el.setAttribute("data-resolution-probe", "retained");
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect
    .poll(async () => (await raster(page)).width)
    .toBeGreaterThan(initial.width);
  const zoomed = await raster(page);
  expect(zoomed.cssWidth).toBeCloseTo(initial.cssWidth, 1);
  expect(zoomed.alpha).toBe(255);
  await expect(text).toHaveAttribute("data-resolution-probe", "retained");
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toContain("A book is a quiet place");
  await expect(page.locator(".ink-stroke")).toHaveAttribute("d", ink!);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 8 });
  await expect
    .poll(async () => (await raster(page)).width)
    .toBeGreaterThan(zoomed.width);
  const capped = await raster(page);
  expect(capped.width * capped.height).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(Math.max(capped.width, capped.height)).toBeLessThanOrEqual(8192);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await expect.poll(async () => (await raster(page)).width).toBe(initial.width);
  await showControls(page);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Go to page, page 2 of 2", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".textLayer")).toContainText("page 2");
  expect(errors).toEqual([]);
  await context.close();
});

test("portrait has one row of controls and landscape has a side rail with a small palette", async ({
  browser,
  request,
}) => {
  await addPDF(request);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page);
  await expect(page.locator(".reader-header")).toBeHidden();
  await expect(page.locator(".reader-footer")).toBeHidden();
  expect((await page.locator(".pdf-page").boundingBox())!.y).toBe(0);
  const dock = page.getByRole("navigation", { name: "Reading controls" });
  expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(56);
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await expect(dock.locator(".ink-toolbar")).toBeVisible();
  expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(56);
  const targets = await dock.locator("button:visible").evaluateAll((nodes) =>
    nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Pen options", exact: true }).click();
  const palette = page.getByRole("dialog", {
    name: "Pen options",
    exact: true,
  });
  expect((await palette.boundingBox())!.height).toBeLessThanOrEqual(168);
  await expect(
    page.getByRole("checkbox", { name: "Finger drawing" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo ink" })).toHaveCount(0);
  await page.getByRole("button", { name: "Amber ink" }).click();
  await morePenSettings(page);
  await page.getByRole("checkbox", { name: "Finger drawing" }).check();
  await page.getByRole("button", { name: "Close pen options" }).click();
  await finishWriting(page);
  await readerOptions(page);
  expect(
    (await page
      .getByRole("dialog", { name: "Reader options", exact: true })
      .boundingBox())!.height,
  ).toBeLessThanOrEqual(300);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator(".reader")).toHaveClass(/theme-night/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Reader options", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await page.getByRole("button", { name: "Pen options", exact: true }).click();
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect
    .poll(async () => {
      const rail = (await dock.boundingBox())!,
        paper = (await page.locator(".reading-area").boundingBox())!,
        box = (await palette.boundingBox())!;
      return (
        rail.width <= 56 &&
        rail.y >= 8 &&
        rail.y + rail.height <= 404 &&
        paper.y === 0 &&
        paper.height === 412 &&
        paper.x + paper.width <= rail.x &&
        box.x + box.width < rail.x &&
        box.y >= 8 &&
        box.y + box.height <= 404
      );
    })
    .toBe(true);
  expect((await palette.boundingBox())!.height).toBeLessThanOrEqual(168);
  await page.getByRole("button", { name: "Close pen options" }).click();
  await readerOptions(page);
  const menu = (await page
    .getByRole("dialog", { name: "Reader options", exact: true })
    .boundingBox())!;
  expect(menu.height).toBeLessThanOrEqual(300);
  expect(menu.y).toBeGreaterThanOrEqual(8);
  expect(menu.y + menu.height).toBeLessThanOrEqual(404);
  await page.getByRole("button", { name: "Close reader options" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    915,
  );
  await context.close();
});

test("standard desktop also uses a sharp baseline without exposing phone-only settings", async ({
  page,
  request,
}) => {
  await addPDF(request);
  await open(page);
  expect((await raster(page)).width).toBeGreaterThanOrEqual(2047);
  await expect(page.locator(".reader-header button:visible")).toHaveCount(3);
  await expect(page.locator(".ink-toolbar")).toHaveCount(0);
});
