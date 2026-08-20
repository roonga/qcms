import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openResponses, submitResponse } from "./support/ops.js";

/**
 * Screenshot evidence for issue 515's design gate.
 *
 * The change adds one column to one table: the answer preview the wireframe specifies
 * and the shipped browser omitted. So this shoots one screen, in the three mode layers
 * and at both widths, and 390 is the frame that carries the argument - it is where the
 * column drops, which is `plan/admin-design-contracts.md` §2's compact-width clause
 * being satisfied rather than deferred.
 *
 * Same machinery and same rules as every other capture spec: skipped unless
 * `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed directory.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-515
 * ```
 *
 * ## The answers in the frame are fixture answers
 *
 * The column renders respondent data in production, and these PNGs are committed to a
 * public repository. The rows are made by this spec through the real respondent routes,
 * out of the seeded insurance fixture's own questions and invented values, so nothing
 * that reaches a committed image resembles a real person's answer.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate515");
const capture = captureInto("docs/gates/pr-515");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the capture signs in with, and makes rows to photograph", async ({
  page,
}) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);

  // Two shapes, so the frame shows both a two-answer preview and a one-answer one
  // (answering "no" hides the follow-up count). Invented values on fixture questions.
  await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 3],
  ]);
  await submitResponse(SLUG, [[ACCIDENT, false]]);
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} responses-table frame`, async ({ page }) => {
    test.setTimeout(240_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);

    // The column is BAKED into a committed PNG, so refuse to shoot a frame that does not
    // have it: a capture that photographs the old five-column table would send the Code
    // Owner evidence of the defect and call it the fix.
    const table = page.getByTestId("qcms-responses-table");
    await expect(table.getByRole("columnheader", { name: "Answer preview" })).toBeVisible();
    await expect(table.getByTestId("qcms-answer-preview").first()).not.toBeEmpty();

    await capture(page, `responses-table-${mode}`);
  });
}
