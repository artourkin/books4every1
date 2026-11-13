import { test, expect } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ request }) => {
  const books = await (await request.get("/api/v1/books")).json();
  for (const b of books) await request.delete("/api/v1/books/" + b.id);
  const collections = await (await request.get("/api/v1/collections")).json();
  for (const c of collections)
    await request.delete("/api/v1/collections/" + encodeURIComponent(c));
});
test("library, search, collection, favorite and metadata editing", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Every library begins with a book."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Or explore six classic excerpts" })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Search library" }).fill("thoreau");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search library" }).fill("");
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Collection name" })
    .fill("Quiet mornings");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(
    page.getByRole("heading", { name: "Quiet mornings." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /All books/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Details for Walden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add to favorites", exact: true })
    .click();
  await page.getByLabel("On your shelf").selectOption("Quiet mornings");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Walden — my copy");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByRole("heading", { name: "Walden — my copy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(6);
  await page.getByRole("button", { name: /Quiet mornings/ }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator(".book-list")).toBeVisible();
  expect(errors).toEqual([]);
});
test("EPUB reading, text highlights, notes, bookmarks and resume", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/samples");
  await page.goto("/");
  await page.getByRole("button", { name: "Read Walden", exact: true }).click();
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator("h1")).toContainText("Where I Lived", {
    timeout: 20000,
  });
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await frame
    .locator("p")
    .filter({ hasText: "I went to the woods" })
    .evaluate((el) => {
      const text = el.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(100, text.textContent!.length));
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  await expect(
    page.getByRole("dialog", { name: "Annotate selected text" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Annotation note" })
    .fill("Make more time for slow mornings.");
  await page.getByRole("button", { name: "green highlight" }).click();
  await page.getByRole("button", { name: "Save highlight & note" }).click();
  await expect(
    page.getByText("Make more time for slow mornings.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Bookmark this page" }).click();
  await expect(page.locator(".panel-notes .note-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Close reader panel" }).click();
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator(".reader")).toHaveClass(/theme-night/);
  await page.getByRole("button", { name: "Use paper theme" }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  // EPUB page turns relocate asynchronously after the click handler returns.
  await expect(page.locator(".reader-progress > span")).not.toHaveText("0%");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const saved = (await (await request.get("/api/v1/books")).json()).find(
    (b: { title: string }) => b.title === "Walden",
  );
  expect(saved.progress).toBeGreaterThan(0);
  expect(saved.location).toContain("epubcfi(");
  await page.reload();
  await page.getByRole("button", { name: "Read Walden", exact: true }).click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes and highlights" }).click();
  await expect(page.locator(".panel-notes .note-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: /Notes & highlights/ }).click();
  await expect(
    page.getByText("Make more time for slow mornings.", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export notebook" }).click();
  expect((await download).suggestedFilename()).toBe("folio-notebook.md");
});
test("PDF upload, rendered text selection, persisted highlights, page navigation and delete", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add books", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve("tests/fixtures/reading-notes.pdf"));
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Read reading-notes", exact: true })
    .click();
  await expect(page.locator(".textLayer")).toContainText(
    "A book is a quiet place",
    { timeout: 20000 },
  );
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  const line = page
    .locator(".textLayer span")
    .filter({ hasText: "A book is a quiet place" })
    .first();
  await line.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page.getByRole("dialog", { name: "Annotate selected text" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Annotation note" })
    .fill("This works in a PDF, too.");
  await page.getByRole("button", { name: "Save highlight & note" }).click();
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "Close reader panel" }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Go to page, page 2 of 2", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Read reading-notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Go to page, page 2 of 2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Details for reading-notes" }).click();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("button", { name: "Delete book", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  expect(await (await request.get("/api/v1/annotations")).json()).toEqual([]);
});
test("mobile layout and upload errors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or explore six classic excerpts" })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your favorites." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add books", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "fake.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "valid PDF",
  );
});
