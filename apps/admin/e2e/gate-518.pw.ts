import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Screenshot evidence for issue 518's design gate.
 *
 * Two screens, because the change is one argument made in two places: the builder now says
 * it saves itself, in ambient chrome outside the validation panel (design-language element
 * 7), and the question editor now says it does not, beside the button that does the saving
 * (`plan/admin-design-contracts.md` §6). A frame of either alone would not show what the
 * gate is actually reviewing, which is that the two screens disagree *visibly*.
 *
 * Same machinery and same rules as every other capture spec: skipped unless
 * `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed directory.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium \
 *   apps/admin/e2e/gate-518.pw.ts
 * ```
 *
 * By path, never by bare name: a bare name matches every admin spec, and the flag above
 * un-skips every gate spec in the suite, so the pair would re-capture other gate
 * directories' committed PNGs.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate518");
const capture = captureInto("docs/gates/pr-518");

const RUN = Date.now().toString(36);
const PINNED_SLUG = `gate518-pinned-${RUN}`;
const DRAFT_SLUG = `gate518-draft-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** Set by the first test, which enrolls the account the captures sign in with. */
let totpSecret = "";
/** The form the builder frames are shot on, built once and reused by all three modes. */
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account and builds the form the captures photograph", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);

  // The library first: a form can only pin a published version (022).
  await createDraft(page, PINNED_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  // And a draft left unpublished, because a published version renders the editor frozen
  // and a frozen editor has no Save button to state a model beside.
  await createDraft(page, DRAFT_SLUG, "Short text");

  formId = await createForm(page, `gate518-${RUN}`, "Save model gate");
  await addStep(page, "Only step");
  await pinQuestion(page, questionIdFor(PINNED_SLUG), 1);
  await waitForSaved(page);
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} save-model frames`, async ({ page }) => {
    test.setTimeout(300_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    // --- the builder: ambient chrome, and a validation panel that only counts issues ---
    await page.goto(`/forms/${formId}`);
    await waitForSaved(page);

    // Refuse to shoot a frame that does not carry the change. A capture of the old screen
    // would send the Code Owner evidence of the defect and call it the fix.
    const strip = page.getByTestId("qcms-save-status");
    await expect(strip).toBeVisible();
    await expect(page.getByTestId("qcms-validation-status")).toBeVisible();
    await expect(
      page.getByTestId("qcms-validation-status").getByTestId("qcms-save-state"),
      "the save sentence must be out of the validation panel",
    ).toHaveCount(0);
    await capture(page, `builder-ambient-save-${mode}`);

    // --- the question editor: an explicit statement, and no ambient strip -------------
    await page.goto(`/questions/${questionIdFor(DRAFT_SLUG)}`);
    await expect(page.getByTestId("qcms-manual-save-note")).toBeVisible();
    await expect(
      page.getByTestId("qcms-save-status"),
      "a screen with a Save button carries no ambient strip",
    ).toHaveCount(0);
    await capture(page, `question-editor-manual-save-${mode}`);
  });
}
