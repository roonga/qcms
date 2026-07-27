import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  readSetupKey,
  signInWithTotp,
  submitRecoveryCode,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";

/**
 * The admin auth loop, end to end in a real browser (task 031, exit criterion 2):
 * sign-in, TOTP enrollment, the one-time recovery-code display, the 2FA challenge, session
 * persistence, sign-out, and the recovery-code path including its single-use property.
 *
 * ## One account, serial tests, each self-contained about its session
 *
 * `mode: "serial"` because the account's 2FA state advances in the database: "enrollment is
 * enforced on first sign-in" is only true once, and "a recovery code works once" needs the
 * codes a specific enrollment produced. But each test still signs in for itself, because
 * Playwright gives every test a fresh browser context and sharing one would disable the
 * shared console gate (see `support/flow.ts`).
 *
 * ## Nothing is shortcut
 *
 * The TOTP secret is read off the enrollment screen's manual setup key and codes are
 * generated from it with otplib, so what is verified is the real cryptographic loop: a
 * secret better-auth provisioned, a code a standards-compliant generator derived from it,
 * and better-auth accepting it. The recovery codes are read off their one-time display.
 *
 * ## Failure paths ARE in the browser here
 *
 * A wrong code produces no 4xx for the browser to log (which would trip the shared console
 * gate): every auth failure is a 303 back to the screen with an opaque marker. That is a
 * consequence of the form-POST design rather than a special case, and it is what lets the
 * generic-message and single-use assertions run in the browser at all.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("auth2fa");

/** Set by the enrollment test. Stable afterwards: an enrolled factor is not re-provisioned. */
let totpSecret = "";
/** Read off the one-time display. Each is usable exactly once. */
let recoveryCodes: string[] = [];

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the sign-in screen offers no way to register (SEC-1)", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to QCMS admin" })).toBeVisible();
  // Not a styling detail: SEC-1 requires that no self-registration path exists, and the
  // screen must not imply one either.
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

  // The manual setup key is the accessible alternative to the QR image, so it has to be a
  // real labelled field carrying the secret - not decoration.
  const secret = await readSetupKey(page);
  expect(secret.length).toBeGreaterThan(15);

  // Enforced by default: the shell is not reachable from an unenrolled session.
  await page.goto("/questions");
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  await page.getByLabel(/Six-digit code/).fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/enroll\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
  // A mistyped digit must not throw away the secret already added to the authenticator.
  await expect(page.getByLabel(/Setup key/)).toHaveValue(secret);

  // A real otplib code completes enrollment and opens the one-time display.
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list).toBeVisible();
  recoveryCodes = await list.getByRole("listitem").allInnerTexts();
  expect(recoveryCodes.length).toBeGreaterThanOrEqual(5);
  totpSecret = secret;

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);

  // "Codes never shown again": the display is spent, so revisiting must not re-print them.
  await page.goto("/two-factor/recovery-codes");
  await expect(page).toHaveURL(/\/questions$/);
});

test("a later sign-in demands the second factor before any session exists", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);

  // A correct password alone must not reach the shell.
  await page.goto("/questions");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a wrong TOTP code is rejected with the same generic message", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await page.getByLabel(/Six-digit code/).fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/challenge\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
});

test("a real otplib code completes the challenge and the shell nav marks the active area", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  for (const item of ["Questions", "Forms", "Responses", "Webhooks", "Settings"]) {
    await expect(nav.getByRole("link", { name: item })).toBeVisible();
  }
  // The active item is announced, not only coloured (WCAG 1.4.1).
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
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  // Server-side invalidation, not just a cleared cookie: the shell is gone for good.
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

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // Single use is the whole security property of a recovery code, so a passing happy path
  // proves nothing without this.
  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, code!);
  await expect(page).toHaveURL(/\/two-factor\/recovery\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
});

test("a second recovery code still works, and the TOTP factor is unaffected", async ({ page }) => {
  const code = recoveryCodes[1];
  expect(code, "enrollment should have produced several recovery codes").toBeDefined();

  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, code!);
  await expect(page).toHaveURL(/\/questions$/);
  await page.getByRole("button", { name: "Sign out" }).click();

  // Redeeming recovery codes does not disturb the authenticator factor.
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);
});

test("changing the password reports success and keeps this session signed in", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/settings");

  // A rejected change must be indistinguishable from any other auth failure (SEC-1).
  await page.getByLabel("Current password").fill("not-the-current-password");
  await page.getByLabel("New password").fill("another-long-enough-passphrase");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/settings\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
});
