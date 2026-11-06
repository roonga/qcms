import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("pwa");

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the manifest is installable and names only this origin", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");

  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  expect(manifest.name).toBe("QCMS");
  expect(manifest.start_url).toBe("/questions");
  expect(manifest.display).toBe("standalone");

  for (const size of ["192x192", "512x512"]) {
    const icons = manifest.icons.filter((icon) => icon.sizes === size && icon.type === "image/png");
    expect(icons.map((icon) => icon.purpose).sort(), size).toEqual(["any", "maskable"]);
  }
  for (const icon of manifest.icons) {
    expect(icon.src, "an icon from another origin would be fetched past the CSP").toMatch(/^\//);
  }
});

test("every generated icon is a PNG", async ({ request, page }) => {
  await page.goto("/sign-in");
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(apple).not.toBeNull();

  for (const path of ["/pwa-icon-192", "/pwa-icon-512", apple ?? ""]) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("image/png");
    expect([...(await response.body()).subarray(0, 4)], path).toEqual(PNG_MAGIC);
  }
});

test("the worker is revalidated every time and caches nothing", async ({ request }) => {
  const response = await request.get("/sw.js");

  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toContain("text/javascript");
  expect(headers["cache-control"]).toBe("no-cache");

  const source = await response.text();
  expect(source, "a fetch handler is the only way a worker could store a response").not.toMatch(
    /addEventListener\(\s*["']fetch["']/,
  );
  expect(source).not.toContain("caches");
});

test("the CSP grants the worker and the manifest this origin only", async ({ request }) => {
  const csp = (await request.get("/sign-in")).headers()["content-security-policy"];

  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("manifest-src 'self'");
  expect(csp).not.toMatch(/https?:\/\//);
});

test("the document declares the manifest and the Apple web app", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    /manifest\.webmanifest/,
  );
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black-translucent",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "QCMS",
  );
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );
  await expect(
    page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]'),
  ).toHaveCount(1);
});

test("an authenticated screen runs the worker and stores nothing", async ({ page }) => {
  test.setTimeout(240_000);
  await enrollNewAdmin(page, EMAIL);

  await page.goto("/questions");

  await expect
    .poll(
      async () => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state),
      { timeout: 30_000 },
    )
    .toBe("activated");

  const stored = await page.evaluate(async () => (await caches.keys()).length);
  expect(stored, "the worker opens no cache, so nothing authenticated is stored").toBe(0);

  const update = page.getByTestId("qcms-app-update");
  await expect(update, "a first install replaces nothing, so no notice is offered").toHaveCount(0);
});
