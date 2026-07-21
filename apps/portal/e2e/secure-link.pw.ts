/**
 * Secure-link entry (task 029, exit criterion 1). The `/l/:token` BFF silently
 * verifies the link and either redirects into the flow (valid) or redirects to the
 * friendly typed-error page (expired / consumed / revoked / invalid). Tokens are
 * minted in globalSetup relative to the API's fixed clock.
 */

import { expect, test } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";

test("a valid link redirects into the flow with real step content", async ({ page }) => {
  const { validToken } = readFixtures();
  await page.goto(`/l/${validToken}`);
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();
});

test("an expired link shows the friendly expired page", async ({ page }) => {
  const { expiredToken } = readFixtures();
  await page.goto(`/l/${expiredToken}`);
  await page.waitForURL(/\/link-error/);
  await expect(page.getByText("This link has expired")).toBeVisible();
});

test("a consumed one-time link shows the already-used page", async ({ page }) => {
  const { consumedToken } = readFixtures();
  await page.goto(`/l/${consumedToken}`);
  await page.waitForURL(/\/link-error/);
  await expect(page.getByText("This link has already been used")).toBeVisible();
});

test("a revoked link shows the no-longer-active page", async ({ page }) => {
  const { revokedToken } = readFixtures();
  await page.goto(`/l/${revokedToken}`);
  await page.waitForURL(/\/link-error/);
  await expect(page.getByText("This link is no longer active")).toBeVisible();
});

test("an unreadable link shows the not-valid page", async ({ page }) => {
  const { invalidToken } = readFixtures();
  await page.goto(`/l/${invalidToken}`);
  await page.waitForURL(/\/link-error/);
  await expect(page.getByText("This link is not valid")).toBeVisible();
});
