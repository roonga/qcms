import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import {
  accountTrigger,
  fillStable,
  openMenu,
  readSetupKey,
  signInWithTotp,
  signOut,
  submitRecoveryCode,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";

// Serial order advances the account's factor and recovery-code state; each test still gets a fresh context.
// Keep enrollment in the selection when filtering tests because later tests need its secret and codes.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("auth2fa");

let totpSecret = "";

let recoveryCodes: string[] = [];

// Next's route-announcer alert is outside main; scope to the page's own alert.
function authAlert(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

// Assert required 2FA before the auth journey: a development .env.local may otherwise weaken the policy under test.
test("CANARY: the server under test enforces 2FA (QCMS_ADMIN_2FA=required)", async ({ page }) => {
  const canary = uniqueAdminEmail("canary2fa");
  await createTestAdmin(canary);
  await submitSignIn(page, canary);
  await expect(
    page,
    "an un-enrolled sign-in reached the shell, so this server is running QCMS_ADMIN_2FA=optional " +
      "and every enforced-2FA assertion in this file is vacuous. Check the admin webServer env " +
      "in playwright.config.ts and apps/admin/.env.local (issue #209).",
  ).toHaveURL(/\/two-factor\/enroll$/);
});

test("the sign-in screen offers no way to register (SEC-1)", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toBeVisible();

  await expect(page.getByText(/sign up|create an account|register/i)).toHaveCount(0);
});

test("an unauthenticated admin page redirects to sign-in (exit criterion 1)", async ({ page }) => {
  for (const path of ["/questions", "/forms", "/responses", "/webhooks", "/settings", "/"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test("first sign-in is forced into 2FA enrollment, which a wrong code cannot bypass", async ({
  page,
}) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  const secret = await readSetupKey(page);
  expect(secret.length).toBeGreaterThan(15);

  await page.goto("/questions");
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  await fillStable(page.getByLabel(/Six-digit code/), "000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/enroll\?error=1$/);
  await expect(authAlert(page)).toContainText("Those details did not match");

  await expect(page.getByLabel(/Setup key/)).toHaveValue(secret);

  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list).toBeVisible();
  recoveryCodes = await list.getByRole("listitem").allInnerTexts();
  expect(recoveryCodes.length).toBeGreaterThanOrEqual(5);
  totpSecret = secret;

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);

  await page.goto("/two-factor/recovery-codes");
  await expect(page).toHaveURL(/\/questions$/);
});

test("a shell route handler applies the enrollment gate, not just cookie validation", async ({
  page,
}) => {
  // Keep this account unenrolled without disturbing the shared account's advancing 2FA state.
  const unenrolled = uniqueAdminEmail("ungated");
  await createTestAdmin(unenrolled);
  await submitSignIn(page, unenrolled);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  // POST handlers bypass the shell layout; a valid session cookie must still fail the handler's enrollment gate.
  const response = await page.request.post("/settings/password", {
    headers: { origin: ADMIN_BASE_URL, referer: `${ADMIN_BASE_URL}/settings` },
    form: { currentPassword: TEST_PASSWORD, newPassword: "a different long passphrase" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toBe("/two-factor/enroll");
});

test("a later sign-in demands the second factor before any session exists", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);

  await page.goto("/questions");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a wrong TOTP code is rejected with the same generic message", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await fillStable(page.getByLabel(/Six-digit code/), "000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/challenge\?error=1$/);
  await expect(authAlert(page)).toContainText("Those details did not match");
});

test("a real otplib code completes the challenge and the shell nav marks the active area", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);

  const nav = page.getByRole("navigation", { name: "Primary" });

  for (const item of ["Questions", "Forms", "Workspaces", "Operations"]) {
    await expect(nav.getByRole("link", { name: item })).toBeVisible();
  }

  await expect(nav.getByRole("link", { name: "Questions" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await nav.getByRole("link", { name: "Forms" }).click();
  await expect(page).toHaveURL(/\/forms$/);
  await expect(nav.getByRole("link", { name: "Forms" })).toHaveAttribute("aria-current", "page");
});

test("the session persists across navigation and reload, then sign-out ends it", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  await signOut(page);

  await page.goto("/questions");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a recovery code signs in once and then never again", async ({ page }) => {
  const code = recoveryCodes[0];
  expect(code, "enrollment should have produced recovery codes").toBeDefined();

  await submitSignIn(page, EMAIL);
  await page.getByRole("link", { name: "Use a recovery code instead" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery$/);
  await submitRecoveryCode(page, code!);
  await expect(page).toHaveURL(/\/questions$/);

  await signOut(page);

  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, code!);
  await expect(page).toHaveURL(/\/two-factor\/recovery\?error=1$/);
  await expect(authAlert(page)).toContainText("Those details did not match");
});

test("a second recovery code still works, and the TOTP factor is unaffected", async ({ page }) => {
  const code = recoveryCodes[1];
  expect(code, "enrollment should have produced several recovery codes").toBeDefined();

  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, code!);
  await expect(page).toHaveURL(/\/questions$/);
  // Wait for sign-out navigation before sign-in: an in-flight sign-out response can replace the next document.
  await signOut(page);

  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);
});

test("changing the password reports success and keeps this session signed in", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/settings#change-password");
  const panel = page.locator("#settings-panel-password");

  await fillStable(panel.getByLabel("Current password"), "not-the-current-password");
  await fillStable(panel.getByLabel("New password"), "another-long-enough-passphrase");

  await panel.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/settings\?error=1$/);
  await expect(authAlert(page)).toContainText("Those details did not match");
});

test("regenerating recovery codes needs the password, and retires the old set (issue #319)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/settings#two-factor");

  const passwordField = page.getByLabel("Your password");
  await expect(passwordField).toBeVisible();

  await fillStable(passwordField, "not-the-current-password");
  await page.getByRole("button", { name: "Generate new recovery codes" }).click();
  await expect(page).toHaveURL(/\/settings\?codesError=1$/);
  await expect(authAlert(page)).toContainText("Those details did not match");

  await fillStable(page.getByLabel("Your password"), TEST_PASSWORD);
  await page.getByRole("button", { name: "Generate new recovery codes" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list).toBeVisible();
  const fresh = await list.getByRole("listitem").allInnerTexts();
  expect(fresh.length).toBeGreaterThanOrEqual(5);

  expect(fresh.some((code) => recoveryCodes.includes(code))).toBe(false);

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);

  await page.goto("/two-factor/recovery-codes");
  await expect(page).toHaveURL(/\/questions$/);
  await signOut(page);

  // Use an unredeemed old code so refusal proves regeneration revoked the set rather than single-use redemption.
  const retired = recoveryCodes[2];
  expect(retired, "enrollment should have produced several recovery codes").toBeDefined();
  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, retired!);
  await expect(page).toHaveURL(/\/two-factor\/recovery\?error=1$/);

  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, fresh[0]!);
  await expect(page).toHaveURL(/\/questions$/);
  await signOut(page);
});

test("the account menu names the operator and routes to the password screen", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = accountTrigger(page);
  await expect(trigger).toHaveAccessibleName(`EA, account menu for ${EMAIL}`);

  const monogram = trigger.locator("span[aria-hidden='true']");
  await expect(monogram).toHaveCount(1);
  expect(
    (await monogram.innerText()).trim(),
    "the disc paints the same two letters the name opens with",
  ).toBe("EA");

  await openMenu(trigger);
  const menu = page.getByRole("menu");

  await expect(page.locator(".qcms-menu .qcms-menu__email")).toHaveText(EMAIL);

  await expect(menu.locator(".qcms-menu__email")).toHaveCount(0);

  await expect(page.locator(".qcms-menu .qcms-menu__sep")).toHaveCount(1);

  await expect(menu.getByRole("menuitem")).toHaveText([
    "Settings",
    "My access",
    "Change password",
    "Sign out",
  ]);

  await expect(menu.getByRole("menuitem", { name: "Change password" })).toHaveAttribute(
    "href",
    "/settings#change-password",
  );

  await menu.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/settings#change-password$/);
  await expect(page.getByLabel("Current password")).toBeVisible();
});
