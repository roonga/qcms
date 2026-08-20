import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin } from "./support/flow.js";
import { createForm } from "./support/forms.js";

/**
 * Capture the one state issue 521 adds: a filter value the address carried that no
 * filter accepts, named on screen and not applied.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`**, like every other capture spec here:
 * it writes PNGs into a committed directory, so leaving it in the standing suite would
 * dirty the working tree on every `pnpm verify:browser`. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-pr-521
 * ```
 *
 * This is **not** one of the admin redesign tier's gated six. The frames are reference
 * evidence for a reviewer reading the PR, which is why there is one state and one mode
 * here rather than the three-mode sweep a design gate takes. `docs/gates/pr-521/README.md`
 * says the same thing beside the images.
 *
 * The form is created empty on purpose: the empty list is where the defect was visible
 * (the page claimed "no response matches these filters" for a filter it had discarded),
 * so the frame shows the sentence that was wrong next to the notice that replaces the
 * silence.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate521");
const RUN = Date.now().toString(36);
const capture = captureInto("docs/gates/pr-521");

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("captures the ignored-filter notice", async ({ page }) => {
  test.setTimeout(240_000);
  await enrollNewAdmin(page, EMAIL);
  const formId = await createForm(page, `gate-521-${RUN}`, "Filter validation");

  await page.goto(`/forms/${formId}/responses?flagged=maybe&from=nope`);
  // Copy is baked into a committed PNG, so refuse to shoot a frame that does not carry
  // the state it claims to show.
  await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText(
    "2 filters were not applied",
  );
  await expect(page.getByTestId("qcms-responses-empty")).toHaveText(
    "Nothing has been submitted to this form yet.",
  );
  await capture(page, "ignored-filters-light");
});
