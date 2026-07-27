import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { generate } from "otplib";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, signInWithTotp, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * The admin's axe gate (task 031, exit criterion 5; policies inherited from task 030).
 *
 * Zero violations is the gate, and it runs on **every state the shell and the auth loop
 * have**, not just the first page: the signed-out screen, each failure state, the enrollment
 * screen with its QR and setup key, the one-time recovery-code display, the challenge and
 * its recovery variant, and all five shell areas. Two of those are the ones a
 * first-render-only gate would miss, and they are exactly where this app's accessibility
 * risk concentrates: an alert that has to receive focus, and a list of codes that has to be
 * announced as a list. (The gate has already earned its place once: it caught a duplicate
 * `role="alert"` created by wrapping the vendored `Alert` in a second live region.)
 *
 * It runs inside the one root Playwright config, which CI's browser job executes in full
 * (`pnpm exec playwright test`), so the gate is CI-enforced by construction rather than by a
 * separate job someone has to remember to add - the failure mode 029 shipped and 030 had to
 * fix (docs/RETRO.md).
 *
 * `color-contrast` is enabled here, unlike in the jsdom component tests where no canvas
 * exists to measure it: this is a real browser, and the admin's Cobalt palette against the
 * shared neutrals is precisely the pair worth checking.
 *
 * Each test signs in for itself: Playwright gives every test a fresh browser context, and
 * sharing one would disable the shared console gate (see `support/flow.ts`).
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("a11y");

/** Set by the enrollment test; stable once the factor is confirmed. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** WCAG 2.2 AA, the same rule set the portal gate uses. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // Name the state and the rules in the failure message: an axe failure reported as a bare
  // count costs a second run to diagnose.
  expect(
    results.violations.map((v) => `${v.id}: ${v.help}`),
    `axe violations on the ${state} state`,
  ).toEqual([]);
}

test("the signed-out and failure states have zero violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expectNoViolations(page, "signed-out");

  // The failure state carries a focused alert, which is where an accessible-name, duplicate
  // live region, or focus-order regression would land.
  await page.goto("/sign-in?error=1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoViolations(page, "sign-in error");

  await page.goto("/sign-in?throttled=1");
  await expectNoViolations(page, "sign-in throttled");

  await page.goto("/sign-in?expired=1");
  await expectNoViolations(page, "session expired");
});

test("the enrollment and recovery-code states have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await expectNoViolations(page, "2FA enrollment");

  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);

  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await expectNoViolations(page, "recovery-codes display");
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("the authenticated shell states have zero violations", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  for (const path of ["/questions", "/forms", "/responses", "/webhooks", "/settings"]) {
    await page.goto(path);
    await expectNoViolations(page, `shell ${path}`);
  }
});

test("the 2FA challenge and its recovery variant have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await expectNoViolations(page, "2FA challenge");

  await page.goto("/two-factor/challenge?error=1");
  await expectNoViolations(page, "2FA challenge error");

  await page.getByRole("link", { name: "Use a recovery code instead" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery$/);
  await expectNoViolations(page, "2FA recovery entry");
});

test("the whole auth loop is reachable by keyboard alone", async ({ page }) => {
  // Not an axe check: axe cannot tell whether a control is *reachable*, which is the defect
  // class issue #144 shipped (a control rendered, labelled, and unfocusable).
  await page.goto("/sign-in");
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // email
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type(EMAIL);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(TEST_PASSWORD);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // code field
  await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
  await page.keyboard.type(await generate({ secret: totpSecret }));
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});
