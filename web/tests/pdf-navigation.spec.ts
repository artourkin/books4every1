import {
  test,
  expect,
  type Page,
  type CDPSession,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resetPreferences } from "./preferences-fixture";
import { showControls, tapControl } from "./reader-controls";

test.beforeEach(async ({ request }) => {
  await resetPreferences(request);
  for (const book of await (await request.get("/api/v1/books")).json())
    await request.delete(`/api/v1/books/${book.id}`);
});

async function open(
  page: Page,
  request: APIRequestContext,
  fontSize = 180,
  buffer?: Buffer,
) {
  await request.patch("/api/v1/me/preferences", { data: { fontSize } });
  await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "navigation.pdf",
        mimeType: "application/pdf",
        buffer:
          buffer ??
          (await readFile(path.resolve("tests/fixtures/reading-notes.pdf"))),
      },
    },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Read navigation", exact: true })
    .click();
  await expect(page.locator(".pdf-page canvas")).toHaveAttribute(
    "data-render-scale",
    /[0-9]/,
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}

async function view(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector(".pdf-page")!.getBoundingClientRect();
    return {
      x: box.left - visualViewport!.offsetLeft,
      y: box.top - visualViewport!.offsetTop,
      scale: visualViewport!.scale,
    };
  });
}
async function sameView(
  page: Page,
  previous: Awaited<ReturnType<typeof view>>,
) {
  await expect
    .poll(async () => {
      const next = await view(page);
      return Math.max(
        Math.abs(next.x - previous.x),
        Math.abs(next.y - previous.y),
      );
    })
    .toBeLessThan(1);
  expect((await view(page)).scale).toBeCloseTo(previous.scale, 2);
}
async function atPage(page: Page, number: number) {
  await expect(page.locator(".textLayer")).toContainText(`page ${number}`);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
}

// Real browser touch input exercises native scrolling, event cancellation,
// pointer capture, and the separate finger/pen paths together.
async function fingerDrag(
  page: Page,
  client: CDPSession,
  direction: number,
  duration = 160,
  vertical = 0,
) {
  const viewport = await page.evaluate(() => ({
    width: visualViewport!.width,
    height: visualViewport!.height,
  }));
  const x = viewport.width * (direction > 0 ? 0.75 : 0.25);
  const y = Math.min(150, viewport.height * 0.45);
  const dx = -direction * viewport.width * 0.5;
  const started = Date.now() / 1000;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    timestamp: started,
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let step = 1; step <= 5; step++) {
    await page.waitForTimeout(duration / 5);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      timestamp: started + (duration * step) / 5000,
      touchPoints: [
        { x: x + (dx * step) / 5, y: y + (vertical * step) / 5, id: 1 },
      ],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    timestamp: started + (duration + 16) / 1000,
    touchPoints: [],
  });
}

test("page buttons and direct jumps retain a zoomed PDF's horizontal and vertical scroll", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  await page
    .locator(".pdf-document")
    .evaluate((node) => node.scrollTo(120, 300));
  const previous = await view(page);
  expect(previous.x).toBeLessThan(-100);
  expect(previous.y).toBeLessThan(-250);
  await showControls(page);
  await tapControl(page, "Next page");
  await atPage(page, 2);
  await sameView(page, previous);
  await tapControl(page, "Previous page");
  await atPage(page, 1);
  await sameView(page, previous);
  await tapControl(page, "Go to page, page 1 of 2");
  await page.getByRole("spinbutton", { name: "Page number" }).fill("2");
  await tapControl(page, "Close reader panel");
  await atPage(page, 2);
  await sameView(page, previous);
  await context.close();
});

test("pinches, cancellations, vertical drags and pen palms do not turn PDF pages", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  const client = await context.newCDPSession(page);
  await showControls(page);
  await tapControl(page, "Draw on PDF");
  await page.locator(".pdf-document").evaluate((node) => node.scrollTo(0, 100));
  const beforeVertical = await view(page);
  await fingerDrag(page, client, 0, 160, -100);
  await atPage(page, 1);
  expect((await view(page)).y).toBeLessThan(beforeVertical.y - 50);

  const layer = page.locator(".pdf-ink-layer");
  const box = (await layer.boundingBox())!;
  const pen = {
    pointerId: 42,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.7,
    clientX: box.x + 100,
    clientY: 100,
  };
  await layer.dispatchEvent("pointerdown", pen);
  await fingerDrag(page, client, 1);
  await atPage(page, 1);
  await layer.dispatchEvent("pointermove", {
    ...pen,
    clientX: pen.clientX + 100,
  });
  await layer.dispatchEvent("pointerup", { ...pen, buttons: 0 });
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await fingerDrag(page, client, 1);
  await atPage(page, 1);
  await page.waitForTimeout(700);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 600, y: 150, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 400, y: 150, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await atPage(page, 1);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 300, y: 180, id: 1 },
      { x: 500, y: 180, id: 2 },
    ],
  });
  for (let step = 1; step <= 4; step++) {
    await page.waitForTimeout(30);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: 300 - step * 20, y: 180, id: 1 },
        { x: 500 + step * 20, y: 180, id: 2 },
      ],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await atPage(page, 1);
  await expect
    .poll(() => page.evaluate(() => visualViewport!.scale))
    .toBeGreaterThan(1.1);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await fingerDrag(page, client, 1);
  await atPage(page, 2);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await context.close();
});

test("opting into finger drawing keeps finger strokes as ink instead of page turns", async ({
  browser,
  request,
}) => {
  await request.patch("/api/v1/me/preferences", {
    data: { drawWithTouch: true },
  });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  await showControls(page);
  await tapControl(page, "Draw on PDF");
  const client = await context.newCDPSession(page);
  await fingerDrag(page, client, 1);
  await atPage(page, 1);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  await context.close();
});

test("a shorter PDF page clamps the retained position to its bounds", async ({
  browser,
  request,
}) => {
  const original = (
    await readFile(path.resolve("tests/fixtures/reading-notes.pdf"))
  ).toString("latin1");
  const secondBox = original.lastIndexOf("/MediaBox [ 0 0 612 792 ]");
  expect(secondBox).toBeGreaterThan(0);
  // Keep byte offsets intact while making the second fixture page shorter.
  const shorter = Buffer.from(
    original.slice(0, secondBox) +
      original.slice(secondBox).replace("612 792", "612 392"),
    "latin1",
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request, 180, shorter);
  await page
    .locator(".pdf-document")
    .evaluate((node) => node.scrollTo(120, 1300));
  const previous = await view(page);
  expect(previous.y).toBeLessThan(-1000);
  await showControls(page);
  await tapControl(page, "Next page");
  await atPage(page, 2);
  const next = await view(page);
  expect(next.x).toBeCloseTo(previous.x, 0);
  expect(next.y).toBeGreaterThan(previous.y + 100);
  expect(next.scale).toBe(previous.scale);
  expect(
    await page
      .locator(".pdf-document")
      .evaluate((node) =>
        Math.abs(node.scrollTop - (node.scrollHeight - node.clientHeight)),
      ),
  ).toBeLessThan(1);
  await context.close();
});

test("native finger flicks turn pages in reading and writing modes while slow drags pan", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request);
  const client = await context.newCDPSession(page);
  await page
    .locator(".pdf-document")
    .evaluate((node) => node.scrollTo(120, 250));
  let previous = await view(page);
  await fingerDrag(page, client, 1);
  await atPage(page, 2);
  await sameView(page, previous);
  await fingerDrag(page, client, 1);
  await atPage(page, 2);
  await sameView(page, previous);
  await fingerDrag(page, client, -1);
  await atPage(page, 1);
  await sameView(page, previous);
  await fingerDrag(page, client, -1);
  await atPage(page, 1);
  await sameView(page, previous);
  await showControls(page);
  await tapControl(page, "Draw on PDF");
  await fingerDrag(page, client, 1, 850);
  await atPage(page, 1);
  const panned = await view(page);
  expect(panned.x).toBeLessThan(previous.x - 50);
  previous = panned;
  await page.locator(".pdf-ink-layer").dispatchEvent("pointermove", {
    pointerType: "pen",
    pointerId: 42,
    buttons: 0,
    clientX: 300,
    clientY: 100,
  });
  await fingerDrag(page, client, 1);
  await atPage(page, 2);
  await sameView(page, previous);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await expect(page.locator(".pdf-ink-layer")).toHaveClass(/ink-enabled/);
  await fingerDrag(page, client, -1);
  await atPage(page, 1);
  await sameView(page, previous);
  await context.close();
});

test("browser pinch zoom retains the visible PDF region through arrows and writing-mode swipes", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8081",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await open(page, request, 100);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page
    .locator(".pdf-page")
    .evaluate((node) =>
      node.scrollIntoView({ block: "end", inline: "end", behavior: "instant" }),
    );
  await page
    .locator(".pdf-document")
    .evaluate((node) => node.scrollTo(70, 100));
  const previous = await view(page);
  expect(previous.x).toBeLessThan(-50);
  expect(previous.y).toBeLessThan(-50);
  await showControls(page);
  await tapControl(page, "Next page");
  await atPage(page, 2);
  await sameView(page, previous);
  await showControls(page);
  await tapControl(page, "Draw on PDF");
  await fingerDrag(page, client, -1);
  await atPage(page, 1);
  await sameView(page, previous);
  await expect(page.locator(".pdf-ink-layer")).toHaveClass(/ink-enabled/);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  const beforePan = await page.evaluate(() => visualViewport!.offsetLeft);
  await fingerDrag(page, client, -1, 850);
  await atPage(page, 1);
  expect(await page.evaluate(() => visualViewport!.offsetLeft)).toBeLessThan(
    beforePan - 20,
  );
  const panned = await view(page);
  await fingerDrag(page, client, 1);
  await atPage(page, 2);
  await sameView(page, panned);
  await context.close();
});
