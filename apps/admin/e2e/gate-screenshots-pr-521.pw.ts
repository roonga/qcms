import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { enrollNewAdmin } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";

/**
 * The screenshot gate for issue 521: the two states this change puts in front of an
 * operator on the form-scoped response browser.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`**, like every other capture spec here:
 * it writes PNGs into a committed directory, so leaving it in the standing suite would
 * dirty the working tree on every `pnpm verify:browser`. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-pr-521
 * ```
 *
 * ## The two states, and why both
 *
 * The change adds a warning notice with new copy and moves which empty sentence the
 * screen shows, and those two things interact, so one frame cannot show the change.
 *
 *  - `ignored-filters-*`: `?flagged=maybe&from=nope`, where nothing parses. The plural
 *    copy names both parameters and the empty state below is the unfiltered sentence,
 *    which is the defect's before-and-after in one frame: the screen used to claim no
 *    response matched filters it had discarded.
 *  - `ignored-filters-with-valid-*`: `?flagged=true&from=nope`, where one filter
 *    survives. The singular copy names only the rejected one and the empty state stays
 *    the FILTERED sentence, because a filter really is applied. That is the pair the
 *    reviewer needs to see the notice is about the address, not about the empty state.
 *
 * All three mode layers, because the notice is a coloured surface the sheet has to
 * carry at every contrast level, and both widths, because the copy names up to three
 * field labels in one sentence and phone width is where that wraps.
 *
 * The form is created empty on purpose: the empty list is where the defect was visible,
 * so the frames show the sentence that was wrong next to the notice that replaces the
 * silence.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate521");
const RUN = Date.now().toString(36);
const capture = captureInto("docs/gates/pr-521");

const UNFILTERED = "Nothing has been submitted to this form yet.";
const FILTERED = "No response matches these filters.";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("captures the ignored-filter notice against both empty states", async ({ page }) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, EMAIL);
  const formId = await createForm(page, `gate-521-${RUN}`, "Filter validation");

  for (const mode of CAPTURE_MODES) {
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);

    await page.goto(`/forms/${formId}/responses?flagged=maybe&from=nope`);
    // Copy is baked into a committed PNG, so refuse to shoot a frame that does not carry
    // the state it claims to show.
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText(
      "2 filters were not applied",
    );
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(UNFILTERED);
    await capture(page, `ignored-filters-${mode}`);

    await page.goto(`/forms/${formId}/responses?flagged=true&from=nope`);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText(
      "One filter was not applied",
    );
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(FILTERED);
    await capture(page, `ignored-filters-with-valid-${mode}`);
  }
});
