import { expect } from "@playwright/test";

import { test } from "../../portal/e2e/support/gates.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";

/**
 * The response browser's empty state tells the truth about which filters were applied
 * (issue 521).
 *
 * ## Why this is a browser spec and not only a unit test
 *
 * The defect is a *sentence on a screen* chosen from a querystring, and a querystring is
 * something an operator arrives with. `lib/ops/response-filters.test.ts` pins the parse;
 * this pins that the page renders the parse, including the sentence itself, which is the
 * half that was wrong.
 *
 * ## Why it makes its own form
 *
 * The unfiltered empty state ("nothing has been submitted") only exists on a form with no
 * responses, and the seeded `frm_auto_quote` collects submissions from the operations
 * spec. A form created here is empty and stays empty, so the two empty sentences are
 * distinguishable in the same run without depending on what any other spec did.
 *
 * A draft form is enough: this screen reads the form for its header and its version list
 * and reads the responses from the API, and neither needs a published version.
 *
 * ## The control matters as much as the regressions
 *
 * The last test asserts that a VALID filter still produces the filtered sentence. Without
 * it, deleting the distinction entirely would turn the first two green, which is the
 * obvious wrong way to fix this.
 */

const EMAIL = uniqueAdminEmail("filters");
const RUN = Date.now().toString(36);

/** The empty form every test in this file reads. */
let formId = "";
/**
 * The factor the first test enrolls.
 *
 * `mode: "serial"` orders the tests but does NOT share a browser context, so every test
 * after the first signs in again with this secret (the same contract 035's spec states).
 */
let totpSecret = "";

const UNFILTERED = "Nothing has been submitted to this form yet.";
const FILTERED = "No response matches these filters.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("response filters: what was applied is what is claimed", () => {
  test("a form with no responses says so", async ({ page }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);
    formId = await createForm(page, `filter-validation-${RUN}`, "Filter validation");

    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(UNFILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);
  });

  test("a flag value the API does not take is not treated as an applied filter", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    // The reported defect. `flagged` reaches the API only as `true` or `false`, so
    // `maybe` was never sent, and the page still announced a filtered empty result for
    // it: a statement about a filter that did not exist.
    await page.goto(`/forms/${formId}/responses?flagged=maybe`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(UNFILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText("Flagged");
    // The toolbar agrees: no flag filter is selected, because none was applied.
    await expect(page.getByRole("button", { name: /Flagged$/ })).toContainText("Any");
  });

  test("a malformed date never reaches the API as an instant", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    // `xyz` used to be concatenated into `xyzT00:00:00.000Z` and sent, so the API
    // answered 400 and the operator lost the whole list to a typo. The absence of the
    // load-failure alert is what proves the request was never made with it.
    await page.goto(`/forms/${formId}/responses?from=xyz`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(UNFILTERED);
    await expect(page.getByText("The responses could not be loaded.")).toHaveCount(0);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText(
      "Submitted from",
    );
  });

  test("both halves of a mixed querystring are handled on their own terms", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    // A valid filter alongside two invalid ones: the valid one applies (so the filtered
    // sentence is true), and the invalid ones are named rather than counted.
    await page.goto(`/forms/${formId}/responses?flagged=true&from=nope&version=abc`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(FILTERED);
    const ignored = page.getByTestId("qcms-responses-ignored-filters");
    await expect(ignored).toContainText("Version");
    await expect(ignored).toContainText("Submitted from");
    await expect(ignored).not.toContainText("Flagged");
  });

  test("a valid filter that matches nothing still says the filtered kind of empty", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    // The control. A date range in the past and a flag filter are both values the API
    // accepts; they match nothing here, and that is exactly what the filtered sentence
    // is for. A fix that made every empty result read as "nothing submitted" would be
    // caught here rather than in production.
    await page.goto(`/forms/${formId}/responses?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(FILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);

    await page.goto(`/forms/${formId}/responses?flagged=true`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(FILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);
  });
});
