import { expect, test } from "../../portal/e2e/support/gates.js";

import { ADMIN_BASE_URL } from "./support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * Capture the screenshot set for the human design gate (task 031; re-shot for the
 * theme in task 055).
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
 * ## The set: four screens, two viewports, three modes
 *
 * Task 055 names the four screens the theme has to be judged on - sign-in, the 2FA
 * challenge, the shell (Questions) and Settings - and requires each in Light, Dark and
 * High-contrast. Twenty-four frames, which is the smallest set that shows the theme's
 * three real risks: the translucent topbar, the auth card away from the shell, and the
 * high-contrast layer where the accent has to survive a two-colour palette.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. 390 is not because operators use
 * phones (they do not - see the project comment on `admin-chromium`) but because the
 * layout has to survive a narrow window, and the top bar's wrap is the thing to look at.
 *
 * The mode is set the way an operator's browser sets it - the `qcms-app-mode` cookie, read
 * by the root layout - rather than by poking the DOM, because a screenshot that did not go
 * through the real mechanism is evidence of nothing.
 *
 * The Next dev-tools indicator is suppressed before every capture. It is dev-server chrome,
 * not product UI, and leaving it in has twice put a floating badge in the corner of
 * evidence a human is asked to approve. Task 032 moved the hydration wait, the suppression
 * and the width handling into `support/capture.ts`, shared with 032's own capture, and
 * changed the suppression from removing `nextjs-portal` to hiding it with a stylesheet
 * (issue #220 - removing a React-owned node mid-hydration is its own race).
 *
 * NOTE: this set is task 055's and re-shooting it is not part of 032, so the topbar in
 * these frames is the pre-032 composition (three mode chips, a standalone Sign out). The
 * current bar is in `docs/gates/032/`.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate");
const MODES = CAPTURE_MODES;
const capture = captureInto("docs/gates/055");

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the rest of the capture signs in with", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

for (const mode of MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    // `url` rather than `domain` + `path`: Playwright takes one form or the other,
    // and the base URL is the one this project already knows.
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);

    await page.goto("/sign-in");
    await capture(page, `sign-in-${mode}`);

    await submitSignIn(page, EMAIL);
    await expect(page).toHaveURL(/\/two-factor\/challenge$/);
    await capture(page, `2fa-challenge-${mode}`);

    await submitTotp(page, totpSecret);
    await page.waitForURL(/\/questions$/);
    await capture(page, `shell-questions-${mode}`);

    await page.goto("/settings");
    await capture(page, `shell-settings-${mode}`);
  });
}
