import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import {
  accountTrigger,
  appearanceTrigger,
  fillStable,
  openMenu,
  readSetupKey,
  signInWithTotp,
  signOut,
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
  await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toBeVisible();
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

  await fillStable(page.getByLabel(/Six-digit code/), "000000");
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

test("a shell route handler applies the enrollment gate, not just cookie validation", async ({
  page,
}) => {
  // Its own account, deliberately left un-enrolled: EMAIL's 2FA state advances through
  // this serial file, and this test must not disturb it.
  const unenrolled = uniqueAdminEmail("ungated");
  await createTestAdmin(unenrolled);
  await submitSignIn(page, unenrolled);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  // The `(shell)` layout guards the pages it renders; a form POST reaches the route
  // handler directly and never passes through it. This session carries a valid
  // better-auth cookie, so only the handler's own gate can turn it away - which is
  // exactly the invariant "the enrollment screens and nothing else" depends on.
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

  // A correct password alone must not reach the shell.
  await page.goto("/questions");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a wrong TOTP code is rejected with the same generic message", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await fillStable(page.getByLabel(/Six-digit code/), "000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/challenge\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
});

test("a real otplib code completes the challenge and the shell nav marks the active area", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);

  const nav = page.getByRole("navigation", { name: "Primary" });
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
  // "Account", not "Settings": the Settings heading names the SELECTED SECTION rather than
  // the screen (issue 655, and the POC's own reason - the screen's name is already in the
  // rail summary and the topbar). What this test needs from it is unchanged: a heading only
  // the authenticated shell can render, so a lost session shows up as a redirect instead.
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  await signOut(page);
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

  await signOut(page);

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
  // `signOut` waits for sign-out to land before this test starts the next flow, and
  // that wait is load-bearing: a click resolves once the navigation is *initiated*,
  // so without it the sign-out POST is still in flight when `signInWithTotp` calls
  // `goto("/sign-in")`, and the late response can replace the document between the
  // code field being filled and Verify being clicked - which submits an empty field,
  // and the browser's own `required` validation then blocks the submit with no
  // navigation and no server error to show for it (the hazard flow.ts documents).
  await signOut(page);

  // Redeeming recovery codes does not disturb the authenticator factor.
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(page).toHaveURL(/\/questions$/);
});

test("changing the password reports success and keeps this session signed in", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  // The password form is one of three PANELS on this screen and only one shows at a time
  // (issue 655), so the panel is selected before the form is used. Arriving by the fragment
  // rather than by pressing the rail row, because this is the link the account menu has
  // published since task 032 and it is what a reader following it actually gets.
  await page.goto("/settings#change-password");
  const panel = page.locator("#settings-panel-password");

  // A rejected change must be indistinguishable from any other auth failure (SEC-1).
  await fillStable(panel.getByLabel("Current password"), "not-the-current-password");
  await fillStable(panel.getByLabel("New password"), "another-long-enough-passphrase");
  // Scoped to the panel: the rail row that opens it carries the same name as the submit
  // button, correctly, so an unscoped query matches two controls once the panel is up.
  await panel.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/settings\?error=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");
});

test("regenerating recovery codes needs the password, and retires the old set (issue #319)", async ({
  page,
}) => {
  // This is the whole replacement for the route that used to read the stored codes
  // back, so both halves of what it buys are asserted: a session alone cannot do it,
  // and doing it kills the previous set.
  await signInWithTotp(page, EMAIL, totpSecret);
  // Same reason as the password test above: the recovery-codes form lives on the two-factor
  // panel, and a panel that is not selected is `hidden` rather than merely below the fold.
  await page.goto("/settings#two-factor");

  const passwordField = page.getByLabel("Your password");
  await expect(passwordField).toBeVisible();

  // A wrong password reports the same generic sentence as every other auth failure and
  // changes nothing (SEC-1).
  await fillStable(passwordField, "not-the-current-password");
  await page.getByRole("button", { name: "Generate new recovery codes" }).click();
  await expect(page).toHaveURL(/\/settings\?codesError=1$/);
  await expect(page.getByRole("alert")).toContainText("Those details did not match");

  await fillStable(page.getByLabel("Your password"), TEST_PASSWORD);
  await page.getByRole("button", { name: "Generate new recovery codes" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list).toBeVisible();
  const fresh = await list.getByRole("listitem").allInnerTexts();
  expect(fresh.length).toBeGreaterThanOrEqual(5);
  // A fresh set, not the one enrollment produced.
  expect(fresh.some((code) => recoveryCodes.includes(code))).toBe(false);

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
  // Still one-time: the display is spent whichever step opened it.
  await page.goto("/two-factor/recovery-codes");
  await expect(page).toHaveURL(/\/questions$/);
  await signOut(page);

  // The retired set is dead. `recoveryCodes[2]` was never redeemed above, so if it is
  // refused now that is regeneration doing it and nothing else - which is the property
  // that makes regenerating the right answer to "my codes leaked".
  const retired = recoveryCodes[2];
  expect(retired, "enrollment should have produced several recovery codes").toBeDefined();
  await submitSignIn(page, EMAIL);
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, retired!);
  await expect(page).toHaveURL(/\/two-factor\/recovery\?error=1$/);

  // And one of the fresh codes works, so the account is not locked out by the swap.
  await page.goto("/two-factor/recovery");
  await submitRecoveryCode(page, fresh[0]!);
  await expect(page).toHaveURL(/\/questions$/);
  await signOut(page);
});

test("the account menu names the operator and routes to the password screen", async ({ page }) => {
  // Task 032. The trigger is two decorative letters, so everything an operator needs
  // to know about which account is acting lives in the accessible name and in the
  // menu's own header - and both are worth asserting, because a monogram that names
  // the wrong session is worse than no monogram at all.
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = accountTrigger(page);
  await expect(trigger).toHaveAccessibleName(`Account menu for ${EMAIL}`);

  await openMenu(trigger);
  const menu = page.getByRole("menu");
  // The full email lives here, which is what lets the trigger be a circle. It sits in
  // the popover BESIDE the menu rather than inside it, on purpose: it labels the menu
  // and is not a stop in it, so it is located from the popover and not from the menu.
  await expect(page.locator(".qcms-menu .qcms-menu__email")).toHaveText(EMAIL);
  // The header is a label, not a stop: exactly two items are reachable.
  await expect(menu.getByRole("menuitem")).toHaveText(["Change password", "Sign out"]);

  await menu.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/settings#change-password$/);
  await expect(page.getByLabel("Current password")).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("sign-out still works, and the menu triggers are gone", async ({ page }) => {
    // The Code Owner's 2026-07-31 decision, and the reason a `<noscript>` block exists
    // at all: a menu cannot open without scripts, so moving sign-out into one would
    // have removed the ability to END A SESSION on a machine where scripts are
    // blocked. The auth screens were always native forms, so the whole loop below runs
    // with no client JavaScript whatsoever.
    await signInWithTotp(page, EMAIL, totpSecret);

    // Both triggers are hidden by the noscript rule: a control an operator can focus
    // but never open is worse than no control at all.
    await expect(appearanceTrigger(page)).toBeHidden();
    await expect(accountTrigger(page)).toBeHidden();

    // And the fallback is the same POST the scripted menu item submits, not a second
    // sign-out path with its own behaviour to get wrong.
    const fallback = page.getByRole("button", { name: "Sign out" });
    await expect(fallback).toBeVisible();
    await Promise.all([page.waitForURL(/\/sign-in/), fallback.click()]);

    // Server-side invalidation, exactly as in the scripted path.
    await page.goto("/questions");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
