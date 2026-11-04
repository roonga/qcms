import { devices, type Locator } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { createDraft, grip, openPanel } from "./support/questions.js";

const EMAIL = uniqueAdminEmail("touchreveal1011");

let totpSecret = "";

function opacityOf(target: Locator): Promise<string> {
  return target.evaluate((element) => getComputedStyle(element).opacity);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("1011 the option grid's insert point and grip are visible where nothing can hover", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, `e2e-touch-${Date.now().toString(36)}`, "Single choice");
  const detail = new URL(page.url()).pathname;
  expect(detail, "the created question owns the URL").toMatch(/^\/questions\/q_/u);

  // A bare hasTouch does not guarantee any-hover:none; use a mobile device with only a touch pointer.
  const touch = await browser.newContext({
    ...devices["Pixel 7"],
    // Browser-created contexts do not inherit project baseURL; relative navigation needs it explicitly.
    baseURL: ADMIN_BASE_URL,
  });
  try {
    await touch.addCookies((await page.context().storageState()).cookies);
    const phone = await touch.newPage();

    // Assert the media query matches before testing reveal so the entire check cannot pass vacuously.
    await phone.goto(detail);
    expect(
      await phone.evaluate(() => window.matchMedia("(any-hover: none)").matches),
      "this context is the one the rule is written for",
    ).toBe(true);

    await openPanel(phone, "options");
    const insert = phone.locator('[data-option-index="0"] .qcms-opt-insert').first();
    await expect(insert, "the grid rendered its first row").toHaveCount(1);

    expect(await opacityOf(insert), "the insert point is visible with no hover available").toBe(
      "1",
    );
    expect(await opacityOf(grip(phone, 0)), "and so is the row grip that opens its menu").toBe("1");
  } finally {
    await touch.close();
  }
});
