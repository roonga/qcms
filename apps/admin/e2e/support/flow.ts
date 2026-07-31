import { expect, type Locator, type Page } from "@playwright/test";
import { generate } from "otplib";

import { TEST_PASSWORD } from "./admin-account.js";

/**
 * Fill a field and prove the value stuck.
 *
 * Under `next dev` the document these screens are typed into can be replaced *after*
 * Playwright has resolved the field and filled it - the route is compiled on demand,
 * and the reload that follows leaves a freshly rendered, empty input in place of the
 * one that was just filled. The click that follows then submits an empty required
 * field, so the browser's own constraint validation blocks the submit: no navigation,
 * no server round trip, and no error message to read. It surfaces much later as a
 * `waitForURL`/`toHaveURL` timeout parked on the screen the test thought it had left,
 * with the field mysteriously empty (issue #210).
 *
 * `toPass` re-runs fill-then-check, so a document swapped underneath us costs one
 * retry instead of the whole test. Nothing here papers over a product failure: a
 * rejected code still redirects and still renders its message, and the assertions
 * about that are untouched.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

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

/**
 * Submit the sign-in form and wait for it to land. Where it lands depends on the
 * account's 2FA state: the challenge, enrollment, the shell, or back to `?error=1`.
 *
 * The wait is load-bearing. `click()` resolves once the navigation is *initiated*, and
 * callers immediately either assert a URL or type into the screen the POST redirects
 * to - both of which race the in-flight response. Waiting for the URL to leave the bare
 * `/sign-in` means every caller starts from a document that has actually arrived.
 */
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await fillStable(page.getByLabel("Email"), email);
  await fillStable(page.getByLabel("Password"), TEST_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/sign-in" || url.search !== ""),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
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
  await fillStable(page.getByLabel(/Six-digit code/), await generate({ secret }));
  await page.getByRole("button", { name: "Verify" }).click();
}

/** Enter a recovery code and verify, from the recovery-entry screen. */
export async function submitRecoveryCode(page: Page, code: string): Promise<void> {
  await fillStable(page.getByLabel(/Recovery code/), code);
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
