import { morePenSettings, showControls } from "./reader-controls";
import {
  test as base,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const test = base.extend<{ accountURL: string }>({
  accountURL: async ({ request }, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "folio-accounts-"));
    const url = "http://127.0.0.1:8082";
    const server = spawn(
      path.resolve("../bin/folio"),
      ["-addr", "127.0.0.1:8082", "-data", dir, "-web", path.resolve("dist")],
      {
        env: {
          ...process.env,
          FOLIO_PASSWORD: "upgrade-test-password",
          FOLIO_API_TOKEN: "",
          FOLIO_SECURE_COOKIE: "false",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let output = "";
    server.stderr.on("data", (data) => {
      output = (output + data).slice(-4000);
    });
    try {
      await expect
        .poll(
          async () => {
            try {
              return (await request.get(url + "/api/v1/health")).status();
            } catch {
              return 0;
            }
          },
          { message: "Isolated account server failed: " + output },
        )
        .toBe(200);
      await use(url);
    } finally {
      if (server.exitCode === null)
        await new Promise<void>((resolve) => {
          server.once("exit", () => resolve());
          server.kill("SIGTERM");
          setTimeout(() => server.kill("SIGKILL"), 3000).unref();
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
});
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Library settings", exact: true })
    .first()
    .click();
}
async function login(
  page: Page,
  url: string,
  name = "owner",
  password = "owner-password-123",
) {
  await page.goto(url);
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(page.locator(".app")).toBeVisible();
}
async function seed(request: APIRequestContext, url: string) {
  expect(
    (
      await request.post(url + "/api/v1/session", {
        data: { password: "upgrade-test-password" },
      })
    ).ok(),
  ).toBe(true);
  return uploadPDF(request, url);
}
async function uploadPDF(request: APIRequestContext, url: string) {
  const res = await request.post(url + "/api/v1/books", {
    multipart: {
      file: {
        name: "preferences.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(
          path.resolve("tests/fixtures/reading-notes.pdf"),
        ),
      },
    },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function createOwner(request: APIRequestContext, url: string) {
  await seed(request, url);
  expect(
    (
      await request.post(url + "/api/v1/users", {
        data: { username: "owner", password: "owner-password-123" },
      })
    ).ok(),
  ).toBe(true);
}
async function readPDF(page: Page) {
  await page
    .getByRole("button", { name: "Read preferences", exact: true })
    .click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await showControls(page);
  await page.getByRole("button", { name: "Pen options", exact: true }).click();
  await morePenSettings(page);
}
async function backToLibrary(page: Page) {
  const close = page.getByRole("button", { name: "Close pen options" });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
}
async function signOut(page: Page) {
  await settings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
}

test("owner setup preserves the library and pen preferences follow accounts across devices", async ({
  page,
  request,
  browser,
  accountURL,
}) => {
  await seed(request, accountURL);
  await page.goto(accountURL);
  await page.getByLabel("Library password").fill("upgrade-test-password");
  await page.getByRole("button", { name: "Open my library" }).click();
  await settings(page);
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page.getByLabel("Account password").fill("owner-password-123");
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page.getByText("Signed in as owner")).toBeVisible();
  await page.getByLabel("New username").fill("bob");
  await page.getByLabel("Temporary password").fill("bob-password-123");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await expect(page.getByText("Account created for bob.")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await readPDF(page);
  await page.getByLabel("Ink thickness").selectOption("5");
  await page.getByRole("button", { name: "Blue ink", exact: true }).click();
  await page.getByRole("checkbox", { name: "Finger drawing" }).check();
  await page
    .getByRole("button", { name: "Ink highlighter", exact: true })
    .click();
  await page.getByLabel("Ink thickness").selectOption("20");
  await backToLibrary(page);
  await readPDF(page);
  await expect(page.getByLabel("Ink thickness")).toHaveValue("20");
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(page.getByLabel("Ink thickness")).toHaveValue("5");
  await backToLibrary(page);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await signOut(page);
  await page.getByLabel("Username", { exact: true }).fill("bob");
  await page.getByLabel("Password", { exact: true }).fill("bob-password-123");
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(
    page.getByText("Every library begins with a book."),
  ).toBeVisible();
  expect(
    await (
      await page.context().request.get(accountURL + "/api/v1/books")
    ).json(),
  ).toEqual([]);
  await uploadPDF(page.context().request, accountURL);
  await page.reload();
  await expect(page.locator(".book-grid")).toBeVisible();
  await readPDF(page);
  await expect(page.getByLabel("Ink thickness")).toHaveValue("3");
  await expect(
    page.getByRole("checkbox", { name: "Finger drawing" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Graphite ink" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Ink thickness").selectOption("8");
  await backToLibrary(page);
  await signOut(page);
  await login(page, accountURL);
  await expect(page.locator(".book-list")).toBeVisible();
  await readPDF(page);
  await expect(page.getByLabel("Ink thickness")).toHaveValue("5");
  await expect(page.getByRole("button", { name: "Blue ink" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("checkbox", { name: "Finger drawing" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close pen options" }).click();
  await page
    .getByRole("button", { name: "Reader options", exact: true })
    .click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "Increase text size" }).click();
  await page.getByRole("button", { name: "Close reader options" }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect
    .poll(async () => {
      const saved = await (
        await page.context().request.get(accountURL + "/api/v1/me/preferences")
      ).json();
      return saved.theme === "night" && saved.fontSize === 110;
    })
    .toBe(true);
  const device = await browser.newContext({
    baseURL: accountURL,
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await device.newPage();
  await login(phone, accountURL);
  await readPDF(phone);
  await expect(phone.locator(".reader")).toHaveClass(/theme-night/);
  await expect(phone.getByLabel("Ink thickness")).toHaveValue("5");
  await phone
    .getByRole("button", { name: "Ink highlighter", exact: true })
    .click();
  await expect(phone.getByLabel("Ink thickness")).toHaveValue("20");
  await expect(phone.getByRole("button", { name: "Blue ink" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await device.close();
});

test("failed preference saves stay visible and retry persists the latest selection", async ({
  page,
  request,
  accountURL,
}) => {
  await createOwner(request, accountURL);
  await login(page, accountURL);
  await readPDF(page);
  await page.route("**/api/v1/me/preferences", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary settings failure" }),
    }),
  );
  await page.getByLabel("Ink thickness").selectOption("8");
  await expect(page.locator(".preferences-error")).toContainText(
    "Your preferences have not saved",
  );
  await page.getByRole("button", { name: "Amber ink" }).click();
  await page.unroute("**/api/v1/me/preferences");
  await page.getByRole("button", { name: "Retry saving preferences" }).click();
  await expect(page.locator(".preferences-error")).toHaveCount(0);
  await backToLibrary(page);
  await page.reload();
  await readPDF(page);
  await expect(page.getByLabel("Ink thickness")).toHaveValue("8");
  await expect(page.getByRole("button", { name: "Amber ink" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("switching accounts in another tab clears the previous private library and rejects stale writes", async ({
  page,
  context,
  request,
  accountURL,
}) => {
  await createOwner(request, accountURL);
  const ownerSession = await (
    await request.get(accountURL + "/api/v1/session")
  ).json();
  const ownerBooks = await (
    await request.get(accountURL + "/api/v1/books")
  ).json();
  expect(
    (
      await request.post(accountURL + "/api/v1/users", {
        data: { username: "bob", password: "bob-password-123" },
      })
    ).ok(),
  ).toBe(true);
  await login(page, accountURL);
  await readPDF(page);
  const other = await context.newPage();
  await other.goto(accountURL);
  await signOut(other);
  await other.getByLabel("Username", { exact: true }).fill("bob");
  await other.getByLabel("Password", { exact: true }).fill("bob-password-123");
  await other.getByRole("button", { name: "Open my library" }).click();
  await expect(
    other.getByText("Every library begins with a book."),
  ).toBeVisible();
  await expect(page.locator(".reader")).toHaveCount(0);
  await expect(
    page.getByText("Every library begins with a book."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Read preferences", exact: true }),
  ).toHaveCount(0);
  const forbidden = await context.request.get(
    accountURL + "/api/v1/books/" + ownerBooks[0].id + "/file",
  );
  expect(forbidden.status()).toBe(404);
  const stale = await context.request.patch(
    accountURL + "/api/v1/me/preferences",
    {
      headers: { "X-Folio-Profile": ownerSession.profileId },
      data: { penWidth: 8 },
    },
  );
  expect(stale.status()).toBe(409);
  const prefs = await (
    await context.request.get(accountURL + "/api/v1/me/preferences")
  ).json();
  expect(prefs.penWidth).toBe(3);
  expect(
    await (await context.request.get(accountURL + "/api/v1/books")).json(),
  ).toEqual([]);
});
