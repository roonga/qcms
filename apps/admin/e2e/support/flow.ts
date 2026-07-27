import type { Page } from "@playwright/test";
import { generate } from "otplib";

import { TEST_PASSWORD } from "./admin-account.js";

/**
 * Browser steps every admin auth spec reuses (task 031).
 *
 * These exist because of a Playwright property that is easy to design around wrongly:
 * `test.describe.configure({ mode: "serial" })` controls **ordering**, not the browser
 * context. Each `test()` still gets a fresh context, so no cookie survives from one test to
 * the next, and a spec written as "step 1 signs in, step 2 continues" fails at step 2 with
 * a locator timeout rather than anything that names the cause. (Measured: two tests, one
 * minute each, waiting for a control on a page they had been redirected away from.)
 *
 * Sharing one context across the file would fix that and would also **silently disable the
 * shared console gate**, which attaches to the injected `page` fixture. So every test
 * instead re-establishes its own session through the real screens, using the steps here.
 * Serial mode is still declared, because the account's 2FA state advances in the database
 * and a later test depends on an earlier one having enrolled it.
 */

/** Submit the sign-in form. Where it lands depends on the account's 2FA state. */
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Read the TOTP secret off the enrollment screen's manual setup key - the same field an
 * operator uses when they cannot scan the QR code.
 *
 * Read it **within the test that uses it**: a sign-in by an account with no confirmed
 * factor re-provisions enrollment, so each visit to this screen carries a *new* secret and
 * one cached from an earlier test is already stale.
 */
export async function readSetupKey(page: Page): Promise<string> {
  return page.getByLabel(/Setup key/).inputValue();
}

/** Enter a freshly generated TOTP code and verify. Used for enrollment and challenge. */
export async function submitTotp(page: Page, secret: string): Promise<void> {
  await page.getByLabel(/Six-digit code/).fill(await generate({ secret }));
  await page.getByRole("button", { name: "Verify" }).click();
}

/** Enter a recovery code and verify, from the recovery-entry screen. */
export async function submitRecoveryCode(page: Page, code: string): Promise<void> {
  await page.getByLabel(/Recovery code/).fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
}

/**
 * Sign in an already-enrolled account all the way to the shell, via its TOTP factor.
 *
 * The `waitForURL` is not decoration. `click()` returns once the navigation has been
 * *initiated*, so a caller that immediately called `page.goto("/settings")` raced the
 * in-flight POST and landed somewhere unrelated - which surfaced as a missing heading on a
 * page the test had never actually reached. Waiting for the shell here means every caller
 * starts from a known place.
 */
export async function signInWithTotp(page: Page, email: string, secret: string): Promise<void> {
  await submitSignIn(page, email);
  await submitTotp(page, secret);
  await page.waitForURL(/\/questions$/);
}
