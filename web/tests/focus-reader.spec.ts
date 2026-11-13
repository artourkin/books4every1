import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ request }) => {
  for (const b of await (await request.get("/api/v1/books")).json())
    await request.delete("/api/v1/books/" + b.id);
});
async function openPDF(page: Page, request: APIRequestContext) {
  await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "focus.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(
          path.resolve("tests/fixtures/reading-notes.pdf"),
        ),
      },
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Read focus", exact: true }).click();
  await expect(page.locator(".pdf-page canvas")).toHaveAttribute(
    "data-render-scale",
    /[0-9]/,
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}
async function focus(page: Page) {
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect(page.locator(".reader")).toHaveClass(/reader-focused/);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
}
async function controlsInsideViewport(
  page: Page,
  selector = ".reader-floating-navigation",
) {
  await expect
    .poll(() =>
      page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect(),
          v = window.visualViewport!;
        return (
          r.left >= v.offsetLeft - 1 &&
          r.top >= v.offsetTop - 1 &&
          r.right <= v.offsetLeft + v.width + 1 &&
          r.bottom <= v.offsetTop + v.height + 1
        );
      }),
    )
    .toBe(true);
}
// CDP touch coordinates start at the visual viewport; locator.click uses the
// layout viewport after pinch zoom. Send a real touch at the visible center.
async function tap(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const point = await button.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      v = window.visualViewport!;
    return {
      x: r.x + r.width / 2 - v.offsetLeft,
      y: r.y + r.height / 2 - v.offsetTop,
    };
  });
  await page.touchscreen.tap(point.x, point.y);
}
async function turn(page: Page, n: number, touch = false) {
  if (touch) await tap(page, n === 2 ? "Next page" : "Previous page");
  else
    await page
      .getByRole("button", {
        name: n === 2 ? "Next page" : "Previous page",
        exact: true,
      })
      .click();
  await expect(
    page.getByRole("button", {
      name: `Go to page, page ${n} of 2`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
}

test("fullscreen uses the entire page, hides idle controls, and follows browser exit", async ({
  page,
  request,
}) => {
  await openPDF(page, request);
  await focus(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("reader"),
      ),
    )
    .toBe(true);
  await expect(page.locator(".reader-header")).toBeHidden();
  await expect(page.locator(".reader-footer")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .evaluate((c) => Math.round(c.getBoundingClientRect().width)),
    )
    .toBe(1440);
  expect((await page.locator(".pdf-page").boundingBox())!.y).toBe(0);
  await controlsInsideViewport(page);
  await page.locator(".reader").focus();
  await expect(
    page.getByRole("button", { name: "Show reading controls" }),
  ).toBeVisible({ timeout: 6000 });
  await expect(
    page.getByRole("navigation", { name: "Reading controls" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show reading controls" }).click();
  await turn(page, 2);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".reader")).not.toHaveClass(/reader-focused/);
  await expect(page.locator(".reader-header")).toBeVisible();
  await expect(page.locator(".reader-footer")).toBeVisible();
});

test("pinch-zoomed phone keeps reachable page buttons and pen tools, without losing magnification or ink", async ({
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
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openPDF(page, request);
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  const layer = page.locator(".pdf-ink-layer"),
    box = (await layer.boundingBox())!;
  const pen = {
    pointerId: 44,
    pointerType: "pen",
    isPrimary: true,
    buttons: 1,
    button: 0,
    pressure: 0.7,
    clientX: box.x + box.width * 0.2,
    clientY: box.y + box.height * 0.3,
  };
  await layer.dispatchEvent("pointerdown", pen);
  await layer.dispatchEvent("pointermove", {
    ...pen,
    clientX: box.x + box.width * 0.6,
  });
  await layer.dispatchEvent("pointerup", { ...pen, buttons: 0 });
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
  const ink = await page.locator(".ink-stroke").getAttribute("d");
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect(page.locator(".reader")).toHaveClass(/reader-zoomed/);
  await client.send("Input.synthesizeScrollGesture", {
    x: 150,
    y: 180,
    yDistance: -200,
    xDistance: -90,
    gestureSourceType: "touch",
  });
  await controlsInsideViewport(page);
  await controlsInsideViewport(page, ".ink-toolbar");
  const physicalTarget = await page
    .getByRole("button", { name: "Next page", exact: true })
    .evaluate(
      (el) => el.getBoundingClientRect().width * window.visualViewport!.scale,
    );
  expect(physicalTarget).toBeCloseTo(44, 0);
  await turn(page, 2, true);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.querySelector(".pdf-page")!.getBoundingClientRect(),
          v = visualViewport!;
        return (
          Math.abs(r.top - v.offsetTop) < 1 &&
          Math.abs(r.left - v.offsetLeft) < 1
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBeCloseTo(
    2,
    1,
  );
  await controlsInsideViewport(page);
  await turn(page, 1, true);
  await expect(page.locator(".ink-stroke")).toHaveAttribute("d", ink!);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBeCloseTo(
    2,
    1,
  );
  await tap(page, "Pen options");
  await controlsInsideViewport(page, ".pen-options");
  await tap(page, "Amber ink");
  await tap(page, "Close pen options");
  await tap(page, "Reader options");
  await controlsInsideViewport(page, ".reader-menu");
  await tap(page, "Finish writing");
  await expect(page.locator(".ink-toolbar")).toHaveCount(0);
  await tap(page, "Go to page, page 1 of 2");
  await controlsInsideViewport(page, ".reader-panel");
  await page.getByRole("spinbutton", { name: "Page number" }).fill("2");
  await tap(page, "Close reader panel");
  await expect(page.locator(".textLayer")).toContainText("page 2");
  await context.close();
  expect(errors).toEqual([]);
});

test("focus survives fullscreen rejection, supports writing, and exits with Escape", async ({
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
  await context.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () =>
      Promise.reject(new Error("Fullscreen unavailable"));
  });
  const page = await context.newPage();
  await openPDF(page, request);
  await focus(page);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect((await page.locator(".pdf-page").boundingBox())!.y).toBe(0);
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "PDF writing tools" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pen options", exact: true }).click();
  await page.setViewportSize({ width: 915, height: 412 });
  await controlsInsideViewport(page, ".pen-options");
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader")).toHaveClass(/reader-focused/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader")).not.toHaveClass(/reader-focused/);
  await expect(
    page.getByRole("button", { name: "Finish writing", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reader-header")).toBeVisible();
  await context.close();
});

test("EPUB fullscreen retains navigation and the way back to the library", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/samples");
  await page.goto("/");
  await page.getByRole("button", { name: "Read Walden", exact: true }).click();
  await expect(page.frameLocator("iframe").first().locator("h1")).toContainText(
    "Where I Lived",
  );
  await focus(page);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.locator(".reader-floating-navigation .reader-progress"),
  ).not.toHaveText("0%");
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.locator(".reader")).toHaveCount(0);
  await expect(page.locator(".book-card")).toHaveCount(6);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("phone fullscreen preserves page zoom through page turns and keeps its exit menu reachable", async ({
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
  await openPDF(page, request);
  await focus(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("reader"),
      ),
    )
    .toBe(true);
  // Chromium disables browser pinch scaling in native fullscreen. Page zoom is
  // application-controlled and remains available through the same floating menu.
  await tap(page, "Reader options");
  await tap(page, "Increase text size");
  await tap(page, "Increase text size");
  await tap(page, "Close reader options");
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .evaluate((c) => Math.round(c.getBoundingClientRect().width)),
    )
    .toBe(494);
  await controlsInsideViewport(page);
  await turn(page, 2, true);
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .evaluate((c) => Math.round(c.getBoundingClientRect().width)),
    )
    .toBe(494);
  await controlsInsideViewport(page);
  await tap(page, "Reader options");
  await controlsInsideViewport(page, ".reader-menu");
  await tap(page, "Exit focus mode");
  await expect(page.locator(".reader")).not.toHaveClass(/reader-focused/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.locator(".reader-header")).toBeVisible();
  await context.close();
});
