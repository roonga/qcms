import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, signInWithTotp, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * Capture the static-render screenshot set for the human design gate (task 031).
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots
 * ```
 *
 * It is a spec rather than a standalone script so it reuses the harness that already
 * exists (Postgres, the composed API, the admin dev server) and drives the real screens
 * rather than a mock of them - the gate is only worth anything if it shows what an
 * operator would see.
 *
 * ## Two viewports, and why the dev chrome is removed
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. 390 is not because admins use
 * phones (they do not - see the project comment on `admin-chromium`) but because the
 * layout has to survive a narrow window, and the top bar's wrap is the thing to look at.
 *
 * The Next dev-tools indicator is removed before every capture. It is dev-server chrome,
 * not product UI, and leaving it in has twice put a floating badge in the corner of
 * evidence a human is asked to approve.
 */

const CAPTURE = process.env.QCMS_ADMIN_CAPTURE_GATE === "1";

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate");
const OUT_DIR = "docs/gates/031";
const WIDTHS = [390, 1280] as const;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/**
 * Remove the Next dev-tools indicator. It lives in a custom element Next injects
 * (`nextjs-portal`) plus a couple of legacy ids, and it is only present under `next dev`,
 * so every selector here is expected to match nothing in a production build.
 */
async function hideDevChrome(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    for (const selector of ["nextjs-portal", "#__next-build-watcher", "[data-nextjs-toast]"]) {
      for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
    }
  });
}

/** Capture one named state at both widths. */
async function capture(page: import("@playwright/test").Page, name: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await hideDevChrome(page);
    await page.screenshot({ path: `${OUT_DIR}/${name}-${width}.png`, fullPage: true });
  }
  // Leave the page at the wide viewport so the next navigation starts from a known shape.
  await page.setViewportSize({ width: 1280, height: 800 });
}

test("captures the signed-out and failure states", async ({ page }) => {
  await page.goto("/sign-in");
  await capture(page, "sign-in");

  await page.goto("/sign-in?error=1");
  await capture(page, "sign-in-error");

  await page.goto("/sign-in?throttled=1");
  await capture(page, "sign-in-throttled");

  await page.goto("/sign-in?expired=1");
  await capture(page, "session-expired");
});

test("captures the 2FA enrollment and recovery-code states", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await capture(page, "2fa-enroll");

  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await capture(page, "recovery-codes");

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("captures the authenticated shell", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/questions");
  await capture(page, "shell-questions");
  await page.goto("/settings");
  await capture(page, "shell-settings");
});

test("captures the 2FA challenge states", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await capture(page, "2fa-challenge");

  await page.goto("/two-factor/challenge?error=1");
  await capture(page, "2fa-challenge-error");

  await page.goto("/two-factor/challenge");
  await page.getByRole("link", { name: "Use a recovery code instead" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery$/);
  await capture(page, "2fa-recovery-entry");
});
