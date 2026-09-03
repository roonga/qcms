import { expect, type Locator, type Page } from "@playwright/test";
import { generate } from "otplib";

import { TEST_PASSWORD } from "./admin-account.js";
import { waitForHydration } from "./hydration.js";

/**
 * Fill a field and prove the value stuck.
 *
 * ## The wait, which is the part that fixes the defect (issue #210)
 *
 * These screens are served as complete, interactive HTML and React attaches to them
 * afterwards, 76-404ms later on an idle machine and longer under load. react-aria's
 * `TextField` renders a CONTROLLED input seeded empty, so the commit that attaches React
 * writes that empty value over anything typed in the meantime. Where the field is
 * `required` - the sign-in password, the six-digit code - the submit that follows is then
 * stopped by the browser's own constraint validation: no submit event, no request, no
 * error message, and a spec left parked on the screen it believed it had left, with the
 * field mysteriously empty. Waiting for the page's own hydration marker removes that
 * window rather than retrying through it, and it is the reason the marker exists.
 *
 * ## The retry, which is a backstop for something else
 *
 * `toPass` re-runs fill-then-check, and it stays. It answers a different failure: under
 * `next dev` a route is compiled on demand and the reload that follows can replace the
 * document *after* Playwright resolved the field and filled it. That one genuinely cannot
 * be waited for, so one retry is the right price. It is not what makes the hydration case
 * safe, and it never was - the value it re-checks is wiped after the check, not before it.
 *
 * Nothing here papers over a product failure: a rejected code still redirects and still
 * renders its message, and the assertions about that are untouched.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await waitForHydration(field.page());
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

/**
 * The topbar's two menu triggers (task 032), by their accessible names.
 *
 * By NAME and not by class, because the name is the contract: both triggers are
 * wordless (a glyph, two decorative letters), so `aria-label` is the entire control
 * as far as a screen reader is concerned, and a test that found them by class would
 * keep passing after the labels went missing.
 *
 * The appearance trigger's name carries its current mode, so the match is a prefix.
 */
export function appearanceTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Appearance: / });
}

export function accountTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Account menu for / });
}

/** Open a menu from its trigger and wait for the popover to be on screen. */
export async function openMenu(trigger: Locator): Promise<void> {
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger.page().getByRole("menu")).toBeVisible();
}

/**
 * Sign out through the account menu.
 *
 * There are two sign-out controls in the DOM on every authenticated page and only
 * one of them is ever reachable: the menu item, and the `<noscript>` fallback form's
 * button, which CSS keeps hidden while scripts run. A bare
 * `getByRole("button", { name: "Sign out" })` therefore matches nothing in a scripted
 * browser (Playwright's role engine skips what is hidden from the accessibility
 * tree), which is why every caller goes through here.
 *
 * The wait is the same one the old standalone button needed: `click()` resolves when
 * the navigation is initiated, so without it the POST is still in flight when the
 * next flow starts.
 */
export async function signOut(page: Page): Promise<void> {
  await openMenu(accountTrigger(page));
  await Promise.all([
    page.waitForURL(/\/sign-in/),
    page.getByRole("menuitem", { name: "Sign out" }).click(),
  ]);
}

/**
 * Take a brand-new account all the way from first sign-in to the shell, and return its
 * TOTP secret so later tests in the file can sign in again.
 *
 * Every spec that needs an authenticated screen has to do this once, because enforced 2FA
 * means a fresh account's first sign-in lands on enrollment rather than on the shell. The
 * steps are the real screens throughout: nothing here reaches into better-auth to mark a
 * factor confirmed, so a regression in enrollment fails the specs that depend on it
 * rather than being quietly bypassed.
 *
 * Read the secret inside the flow, never cached across tests: a sign-in by an account
 * with no confirmed factor re-provisions enrollment, so each visit carries a new one.
 */
export async function enrollNewAdmin(page: Page, email: string): Promise<string> {
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  const secret = await readSetupKey(page);
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await page.waitForURL(/\/questions$/);
  return secret;
}

/**
 * What currently holds focus, as its `id` when it has one and its tag name otherwise.
 *
 * A string rather than a locator assertion, because the interesting failures are the
 * ones where focus went somewhere nobody chose: `toBeFocused()` reports only that the
 * expected element is not focused, while this reports `BODY` and names the defect
 * (issue #308). Poll it - focus after an action that unmounts its own trigger is set
 * in an effect, and React Aria's own restore runs in the same commit.
 */
export function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    return active.id === "" ? active.tagName : active.id;
  });
}
