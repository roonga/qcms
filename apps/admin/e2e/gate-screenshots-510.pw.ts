import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * Reference frames for issue #510: the two detail routes now headed by their own entity.
 *
 * **Not a gate.** #510 is not one of the admin-redesign tier's gated issues, so nothing
 * waits on a sign-off here. The change is user-visible, so the evidence is committed for
 * the Code Owner to look at if they want to: `docs/gates/pr-510/`.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`**, like every other capture spec: it
 * writes PNGs into a committed directory, and leaving it in the standing suite would
 * make every local `pnpm verify:browser` dirty the working tree.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-510
 * ```
 *
 * One mode rather than three. The tier's photographed gates shoot light, dark and
 * high-contrast because they are judging the treatment; what moved here is which words
 * a heading holds, which is identical in all three, and three times the frames would be
 * three times the reviewing for nothing. Widths stay at 390px and 1280px per the Code
 * Owner's 2026-07-25 rule - and at 390px the guard in `capture.ts` is doing real work,
 * because the response heading now carries a `ses_…` token with no break opportunity.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate510");
const capture = captureInto("docs/gates/pr-510");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** Set by the first test, which enrolls the account the capture signs in with. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the capture signs in with", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);
});

test("captures the response detail frame", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const sessionId = await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 2],
  ]);
  await page.goto(`/forms/${FORM_ID}/responses/${sessionId}`);
  await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

  // The frame is only evidence if the heading it is meant to show is on it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Response ${sessionId}`);
  await capture(page, "response-detail");
});

test("captures the version detail frame", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/forms/${FORM_ID}/versions/1`);
  await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("h1").first()).toHaveText("Version 1");
  await capture(page, "version-detail");
});
