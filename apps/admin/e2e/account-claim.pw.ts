import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, signInLinkFor, uniqueAdminEmail } from "./support/admin-account.js";
import { fillStable, readSetupKey, submitTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// The claim is the only door into an account a Site administrator created: the link is
// emailed, so this spec takes the token the message would carry and drives the screen.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("claim");

const CHOSEN_PASSWORD = `e2e-claimed-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

let token = "";

function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

// Next adds a route-announcer alert outside main during hydration; scope to the page's own alert.
function alertText(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

async function fillClaim(page: Page, next: string, confirm: string): Promise<void> {
  await fillStable(field(page, "Password"), next);
  await fillStable(field(page, "Confirm password"), confirm);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL, { claimed: false });
  token = await signInLinkFor(EMAIL);
});

test("a link with no token offers no form at all", async ({ page }) => {
  await page.goto("/claim");
  await expect(page.getByRole("heading", { name: "Set up your account" })).toBeVisible();
  await expect(alertText(page)).toContainText("cannot be used");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("an unknown token is refused with the same answer", async ({ page }) => {
  await page.goto("/claim?token=not-a-token-that-was-ever-issued");
  await fillClaim(page, CHOSEN_PASSWORD, CHOSEN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/claim\?error=1$/),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  await expect(alertText(page)).toContainText("cannot be used");
});

test("the screen refuses two passwords that differ, without spending the link", async ({
  page,
}) => {
  await page.goto(`/claim?token=${encodeURIComponent(token)}`);
  await fillClaim(page, CHOSEN_PASSWORD, `${CHOSEN_PASSWORD}x`);
  await Promise.all([
    page.waitForURL(/mismatch=1/),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  await expect(alertText(page)).toContainText("did not match");
});

test("the screen is operable from the keyboard alone, with focus visible", async ({ page }) => {
  await page.goto(`/claim?token=${encodeURIComponent(token)}`);
  await waitForHydration(page);

  const order = [
    field(page, "Password"),
    field(page, "Confirm password"),
    page.getByRole("button", { name: "Continue" }),
  ];
  await order[0]?.focus();
  for (const [index, control] of order.entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    const style = window.getComputedStyle(active);
    return `${style.outlineStyle}|${style.outlineWidth}`;
  });
  expect(outline).not.toMatch(/^none\|/);
});

test("the claim sets a password, then forces the second factor before the shell", async ({
  page,
}) => {
  await page.goto(`/claim?token=${encodeURIComponent(token)}`);
  await fillClaim(page, CHOSEN_PASSWORD, CHOSEN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/two-factor\/enroll$/),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);

  // The account is still unclaimed here, so no admin route answers it.
  await page.goto("/questions");
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  await page.goto("/two-factor/enroll");
  const secret = await readSetupKey(page);
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
});

test("the spent link is refused on a second use", async ({ page }) => {
  await page.goto(`/claim?token=${encodeURIComponent(token)}`);
  await fillClaim(page, `${CHOSEN_PASSWORD}-again`, `${CHOSEN_PASSWORD}-again`);
  await Promise.all([
    page.waitForURL(/\/claim\?error=1$/),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  await expect(alertText(page)).toContainText("cannot be used");
});

test("the claimed account signs in with the password it chose", async ({ page }) => {
  await page.goto("/sign-in");
  await fillStable(page.getByLabel("Email"), EMAIL);
  await fillStable(page.getByLabel("Password"), CHOSEN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/two-factor\/challenge$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
});
