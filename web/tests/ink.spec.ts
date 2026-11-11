import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ request }) => {
  for (const b of await (await request.get("/api/v1/books")).json())
    await request.delete("/api/v1/books/" + b.id);
});
async function openPDF(page: Page, request: APIRequestContext) {
  const response = await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "pen-test.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(
          path.resolve("tests/fixtures/reading-notes.pdf"),
        ),
      },
    },
  });
  const book = await response.json();
  await visitPDF(page);
  return book as { id: string };
}
async function visitPDF(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Read pen-test", exact: true })
    .click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
}
let pointer = 10;
async function stroke(page: Page, type = "pen", y = 0.25) {
  await expect(page.locator(".pdf-ink-layer")).toHaveClass(/ink-enabled/);
  const box = (await page.locator(".pdf-ink-layer").boundingBox())!;
  const pointerId = ++pointer;
  const base = {
    pointerId,
    pointerType: type,
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  };
  await page.locator(".pdf-ink-layer").dispatchEvent("pointerdown", {
    ...base,
    clientX: box.x + box.width * 0.2,
    clientY: box.y + box.height * y,
    pressure: 0.2,
  });
  for (let i = 1; i <= 7; i++)
    await page.locator(".pdf-ink-layer").dispatchEvent("pointermove", {
      ...base,
      clientX: box.x + box.width * (0.2 + i * 0.07),
      clientY: box.y + box.height * (y + Math.sin(i) * 0.01),
      pressure: 0.2 + i * 0.1,
    });
  await page.locator(".pdf-ink-layer").dispatchEvent("pointerup", {
    ...base,
    buttons: 0,
    clientX: box.x + box.width * 0.69,
    clientY: box.y + box.height * y,
    pressure: 0,
  });
}
const saved = (page: Page) =>
  expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
test("pressure-sensitive pen, translucent highlighter, erase, undo/redo, zoom and page isolation", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const book = await openPDF(page, request);
  await stroke(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await saved(page);
  let ink = await (await request.get(`/api/v1/books/${book.id}/ink/1`)).json();
  expect(
    ink.strokes[0].points.some((p: { pressure: number }) => p.pressure > 0.7),
  ).toBeTruthy();
  expect(ink.strokes[0].points[0].x).toBeCloseTo(0.2, 3);
  const original = await page.locator(".ink-stroke").getAttribute("d");
  await page.getByRole("button", { name: "Increase text size" }).click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-stroke")).toHaveAttribute("d", original!);
  await page
    .getByRole("button", { name: "Ink highlighter", exact: true })
    .click();
  await page.getByRole("button", { name: "Amber ink", exact: true }).click();
  await stroke(page, "mouse", 0.4);
  await expect(
    page.locator(".ink-stroke[data-tool=highlighter]"),
  ).toHaveAttribute("opacity", "0.3");
  await page.getByRole("button", { name: "Undo ink" }).click();
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo ink" }).click();
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await page.getByRole("button", { name: "Stroke eraser" }).click();
  await stroke(page, "pen", 0.25);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo ink" }).click();
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await saved(page);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("PAGE 2 OF 2", { exact: true })).toBeVisible();
  await saved(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await stroke(page, "pen", 0.3);
  await saved(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(page.getByText("PAGE 1 OF 2", { exact: true })).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await visitPDF(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  expect(errors).toEqual([]);
});
test("touch is opt-in, palm touches do not ink, cancelled strokes are discarded, mobile tools fit", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPDF(page, request);
  await stroke(page, "touch");
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Finger drawing" }).check();
  await stroke(page, "touch");
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Finger drawing" }).uncheck();
  await expect(page.locator(".pdf-ink-layer")).toHaveClass(/ink-enabled/);
  const box = (await page.locator(".pdf-ink-layer").boundingBox())!;
  const pen = {
    pointerId: 500,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + box.width * 0.3,
    clientY: box.y + box.height * 0.5,
    pressure: 0.7,
  };
  await page.locator(".pdf-ink-layer").dispatchEvent("pointerdown", pen);
  await stroke(page, "touch", 0.6);
  await page
    .locator(".pdf-ink-layer")
    .dispatchEvent("pointermove", { ...pen, clientX: box.x + box.width * 0.6 });
  await page.locator(".pdf-ink-layer").dispatchEvent("pointerup", {
    ...pen,
    buttons: 0,
    clientX: box.x + box.width * 0.6,
  });
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await page
    .locator(".pdf-ink-layer")
    .dispatchEvent("pointerdown", { ...pen, pointerId: 501 });
  await page
    .locator(".pdf-ink-layer")
    .dispatchEvent("pointercancel", { ...pen, pointerId: 501 });
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await saved(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page
    .getByRole("button", { name: "Read / select", exact: true })
    .click();
  await expect(page.locator(".pdf-ink-layer")).not.toHaveClass(/ink-enabled/);
});
test("failed saves keep ink visible, offer recovery, block accidental exit, and retry safely", async ({
  page,
  request,
}) => {
  await openPDF(page, request);
  await page.route("**/api/v1/books/*/ink/*", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test server unavailable" }),
      });
    else await route.continue();
  });
  await stroke(page);
  await expect(page.locator(".ink-save-state")).toContainText(
    "Test server unavailable",
  );
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("PAGE 2 OF 2", { exact: true })).toBeVisible();
  await expect(page.locator(".ink-save-state")).toContainText(
    "Ink on page 1 has not saved",
  );
  await page.getByRole("button", { name: "Review page 1" }).click();
  await expect(page.getByText("PAGE 1 OF 2", { exact: true })).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.locator(".reader")).toBeVisible();
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const download = await downloadPromise;
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(file.strokes).toHaveLength(1);
  expect(file.format).toBe("folio-ink-v1");
  await page.unroute("**/api/v1/books/*/ink/*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await visitPDF(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
});
test("a stale tab cannot overwrite ink saved by another tab", async ({
  page,
  request,
  context,
}) => {
  const book = await openPDF(page, request),
    other = await context.newPage();
  await visitPDF(other);
  await stroke(page);
  await saved(page);
  await stroke(other, "pen", 0.5);
  await expect(other.locator(".ink-save-state")).toContainText(
    "changed in another tab",
  );
  const stored = await (
    await request.get(`/api/v1/books/${book.id}/ink/1`)
  ).json();
  expect(stored.revision).toBe(1);
  expect(stored.strokes[0].points[0].y).toBeCloseTo(0.25, 3);
  other.once("dialog", (dialog) => dialog.accept());
  await other.getByRole("button", { name: "Reload saved ink" }).click();
  await saved(other);
  await expect(other.locator(".ink-stroke")).toHaveCount(1);
  await other.close();
});

test("new strokes while a save is in flight survive page turns and keyboard undo/redo", async ({
  page,
  request,
}) => {
  const book = await openPDF(page, request);
  let release!: () => void,
    started!: () => void,
    first = true;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    seen = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/v1/books/*/ink/*", async (route) => {
    if (route.request().method() === "PUT" && first) {
      first = false;
      started();
      await gate;
    }
    await route.continue();
  });
  await stroke(page);
  await seen;
  await stroke(page, "pen", 0.4);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("PAGE 2 OF 2", { exact: true })).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await stroke(page, "pen", 0.5);
  release();
  await saved(page);
  await expect
    .poll(async () => {
      const p = await (
        await request.get(`/api/v1/books/${book.id}/ink/1`)
      ).json();
      return p.strokes.length;
    })
    .toBe(2);
  await expect
    .poll(async () => {
      const p = await (
        await request.get(`/api/v1/books/${book.id}/ink/2`)
      ).json();
      return p.strokes.length;
    })
    .toBe(1);
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(page.getByText("PAGE 1 OF 2", { exact: true })).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  await saved(page);
});
