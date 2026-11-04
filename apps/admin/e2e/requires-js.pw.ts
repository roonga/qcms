import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("requiresjs");

const TITLE = "JavaScript is required";
const BODY = "Turn on JavaScript in your browser settings, then reload this page.";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function expectOnlyTheMessage(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { level: 1, name: TITLE });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(BODY);

  await expect(page.locator("a.skip-link")).toBeHidden();
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the sign-in page shows the message and no form", async ({ page }) => {
    await page.goto("/sign-in");
    await expectOnlyTheMessage(page);

    // Use CSS plus attachment checks: role locators exclude hidden controls and could pass on a missing element.
    for (const selector of [
      'form[action="/sign-in/submit"]',
      'input[name="email"]',
      'input[name="password"]',
    ]) {
      const element = page.locator(selector);
      await expect(element, `${selector} is still served`).toBeAttached();
      await expect(element, `${selector} is not painted`).toBeHidden();
    }

    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toHaveCount(0);

    await page.keyboard.press("Tab");
    expect(
      await page.locator(":focus").count(),
      "nothing on the page takes focus, so Tab leaves the body",
    ).toBe(0);
  });

  test("no auth screen can be reached or submitted with scripting off", async ({ page }) => {
    for (const route of [
      "/sign-in",
      "/two-factor/challenge",
      "/two-factor/enroll",
      "/two-factor/recovery",
      "/two-factor/recovery-codes",
    ]) {
      await page.goto(route);
      await expectOnlyTheMessage(page);

      await expect(page.locator("form:visible"), `${route} paints no form`).toHaveCount(0);
      await expect(page.locator("input:visible"), `${route} paints no field`).toHaveCount(0);
      await expect(page.getByRole("textbox"), `${route} announces no field`).toHaveCount(0);
      await expect(page.getByRole("button"), `${route} announces no control`).toHaveCount(0);

      await page.keyboard.press("Tab");
      expect(await page.locator(":focus").count(), `${route} puts nothing in the tab order`).toBe(
        0,
      );
    }
  });
});

test("an authenticated shell route shows the message and no shell", async ({ page, browser }) => {
  test.setTimeout(240_000);

  // Create the session with the project page before copying cookies into a scriptless context.
  // A browser-created context inherits neither baseURL nor the project's hydration settings.
  await enrollNewAdmin(page, EMAIL);

  const scriptless = await browser.newContext({
    javaScriptEnabled: false,
    // Browser-created contexts do not inherit project baseURL; relative navigation needs it explicitly.
    baseURL: ADMIN_BASE_URL,
  });
  try {
    await scriptless.addCookies((await page.context().storageState()).cookies);
    const scriptlessPage = await scriptless.newPage();

    await scriptlessPage.goto("/questions");

    await expect(
      scriptlessPage,
      "the transferred session is real, not a bounce to sign-in",
    ).toHaveURL(/\/questions$/);
    await expectOnlyTheMessage(scriptlessPage);

    await expect(scriptlessPage.locator("header")).toBeHidden();
    await expect(scriptlessPage.locator("main#main-content")).toBeHidden();
    await expect(scriptlessPage.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(scriptlessPage.getByRole("table", { name: "Question library" })).toHaveCount(0);

    const signOutForm = scriptlessPage.locator('form[action="/sign-out"]');
    await expect(
      signOutForm,
      "the POST form the scripted menu submits is still served",
    ).toBeAttached();
    await expect(signOutForm).toBeHidden();
    await expect(signOutForm.locator("button")).toHaveCount(0);
    await expect(scriptlessPage.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  } finally {
    await scriptless.close();
  }
});

test("with JavaScript the message is absent and the sign-in form is the page", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: TITLE })).toHaveCount(0);
  await expect(page.getByText(TITLE)).toBeHidden();
  await expect(page.locator(".qcms-requires-js")).toBeHidden();

  await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
