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
 * Wait until every running transition and animation has finished.
 *
 * Load-bearing before any computed-style read that follows a mode-class swap, and it
 * cost a cycle to find the first time: the vendored controls carry `transition-colors`,
 * so changing the root class starts a colour animation and an immediate sample measures
 * a MID-TRANSITION value - a colour that exists for a tenth of a second and is nobody's
 * experience. Two runs disagreeing on the number is the signature.
 *
 * `document.getAnimations()` asks the exact question ("is anything still animating?"),
 * so this settles as fast as the page does. A `waitForTimeout` would have hidden the
 * same race behind a number that is too small on a loaded machine, and emulating reduced
 * motion would have measured a configuration rather than removing the race.
 *
 * Lives here rather than in one spec because two specs need it: the axe gate samples
 * colour after a mode swap, and the theming assertions in `appearance.pw.ts` do the
 * same. One copy, so a fix to the wait cannot reach only half the callers.
 *
 * TWO FRAMES, AND A LOOP, both earned the hard way.
 *
 * A single `requestAnimationFrame` is not enough. A CSS transition does not exist as an
 * animation until the style change that starts it has been recomputed, and the callback
 * of the first frame can run BEFORE that recalculation - so `getAnimations()` returns an
 * empty list, this resolves immediately, and the sample lands in the middle of a
 * transition that had not started being observable yet. That is a race the caller wins
 * most of the time, which is the worst kind: it surfaced only when an unrelated change on
 * the same page (a preview that now holds state) shifted the render timing by a frame.
 *
 * The loop is for the same reason one layer out: finishing one set of transitions can
 * start another (a dialog that fades in, then its contents settling), so re-asking until
 * the page reports nothing running is the only wait that is actually about the page. The
 * bound exists so an infinite animation cannot hang the suite; it is a safety net, not a
 * timing knob, and hitting it does not fail anything.
 *
 * EACH `finished` IS RACED AGAINST A DEADLINE, and that is the other half of the same
 * safety net (task 034). The round bound above only limits how many times this re-asks; it
 * does nothing about a single `finished` that never settles, and one of those is enough to
 * hang the whole suite forever. It is reachable: a CSS transition on an element that stops
 * being rendered - a mode swap over a page whose modal then hides what it repainted - stays
 * `running` and never resolves. That state was reproduced on the admin's publish screens
 * and cost two 15-minute runs before it was recognised as a wait rather than as a slow
 * page. A transition that has not finished within `MAX_ANIMATION_MS` is one this helper
 * stops waiting for; every real transition in either app is an order of magnitude shorter
 * (`duration-200` is the longest), so the race never fires on a healthy page.
 */
/** How long any one animation may hold up the settle before it is left behind. */
const MAX_ANIMATION_MS = 1000;

export async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async (maxAnimationMs: number) => {
    // Named rather than inlined into the `new Promise(...)` below: an arrow inside an
    // executor inside a helper inside this callback is five levels of nesting, which
    // `sonarjs/no-nested-functions` rejects.
    const onNextFrame = (resolve: (value: unknown) => void): void => {
      requestAnimationFrame(resolve);
    };
    const frame = async (): Promise<void> => {
      await new Promise(onNextFrame);
    };
    // A deadline for one animation, so a `finished` that never settles is left behind
    // rather than allowed to hang the run.
    const deadline = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, maxAnimationMs));
    };
    const settled = async (animation: Animation): Promise<void> => {
      await Promise.race([animation.finished.catch(() => undefined), deadline()]);
    };
    await frame();
    await frame();
    for (let round = 0; round < 5; round += 1) {
      const running = document.getAnimations();
      if (running.length === 0) return;
      await Promise.all(running.map(settled));
      await frame();
    }
  }, MAX_ANIMATION_MS);
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
