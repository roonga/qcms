import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { fillStable, readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue #319's design gate.
 *
 * The change removes the route that read stored recovery codes back and puts a
 * **regenerate** form in its place, on the Settings two-factor card. That form is the
 * only new pixel in the product, so it is the only thing this set has to show, in the
 * three mode layers and at both widths - and the display it lands on, which is the
 * existing one-time screen now reached from a second entry point.
 *
 * Same machinery and same rules as `gate-screenshots.pw.ts`: skipped unless
 * `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed directory.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-319
 * ```
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate319");
const capture = captureInto("docs/gates/pr-319");

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the capture signs in with", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

for (const mode of CAPTURE_MODES) {
  test(`captures the settings card in ${mode}`, async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);

    await submitSignIn(page, EMAIL);
    await submitTotp(page, totpSecret);
    await page.waitForURL(/\/questions$/);

    await page.goto("/settings");
    await expect(page.getByLabel("Your password")).toBeVisible();
    await capture(page, `settings-recovery-codes-${mode}`);

    // The refusal state, which is the one an operator is most likely to meet: the
    // generic sentence has to land beside the form that produced it rather than under
    // the password form above it.
    await fillStable(page.getByLabel("Your password"), "not-the-current-password");
    await page.getByRole("button", { name: "Generate new recovery codes" }).click();
    await expect(page).toHaveURL(/\/settings\?codesError=1$/);
    await capture(page, `settings-recovery-codes-error-${mode}`);
  });
}

test("captures the one-time display reached by regenerating", async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: "light", url: ADMIN_BASE_URL, sameSite: "Lax" }]);

  await submitSignIn(page, EMAIL);
  await submitTotp(page, totpSecret);
  await page.waitForURL(/\/questions$/);

  await page.goto("/settings");
  await fillStable(page.getByLabel("Your password"), TEST_PASSWORD);
  await page.getByRole("button", { name: "Generate new recovery codes" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await expect(page.getByRole("list", { name: "Recovery codes" })).toBeVisible();
  await capture(page, "recovery-codes-display-after-regenerate-light");
});
