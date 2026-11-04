import { expect } from "@playwright/test";

import { test } from "../../portal/e2e/support/gates.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";

const EMAIL = uniqueAdminEmail("filters");
const RUN = Date.now().toString(36);

let formId = "";

let totpSecret = "";

const UNFILTERED = "Nothing has been submitted to this form yet.";
const FILTERED = "No response matches these filters.";

// Only the seed has a published version for the Version select; other tests need the newly created empty form.
const SEEDED_FORM_ID = "frm_auto_quote";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("response filters: what was applied is what is claimed", () => {
  test("a form with no responses says so", async ({ page }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);
    formId = await createForm(page, `filter-validation-${RUN}`, "Filter validation");

    await page.goto(`/operations/forms/${formId}/responses`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(UNFILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);
  });

  test("a flag value the API does not take is not treated as an applied filter", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${formId}/responses?flagged=maybe`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(UNFILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText("Flagged");

    await expect(page.getByRole("button", { name: /Flagged$/ })).toContainText("Any");
  });

  test("a malformed date never reaches the API as an instant", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${formId}/responses?from=xyz`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(UNFILTERED);
    await expect(page.getByText("The responses could not be loaded.")).toHaveCount(0);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toContainText(
      "Submitted from",
    );
  });

  test("both halves of a mixed querystring are handled on their own terms", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${formId}/responses?flagged=true&from=nope&version=abc`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(FILTERED);
    const ignored = page.getByTestId("qcms-responses-ignored-filters");
    await expect(ignored).toContainText("Version");
    await expect(ignored).toContainText("Submitted from");
    await expect(ignored).not.toContainText("Flagged");
  });

  test("a valid filter that matches nothing still says the filtered kind of empty", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${formId}/responses?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(FILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);

    await page.goto(`/operations/forms/${formId}/responses?flagged=true`);
    await expect(page.getByTestId("qcms-responses-empty")).toContainText(FILTERED);
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);
  });

  test("a padded version number leaves the toolbar agreeing with the table", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${SEEDED_FORM_ID}/responses?version=0001`);
    await expect(page.getByRole("button", { name: /Version$/ })).toContainText("v1");
    await expect(page.getByTestId("qcms-responses-ignored-filters")).toHaveCount(0);
  });
});
