import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("erasure-env");
const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";

let totpSecret = "";

let prodSession = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  // The insurance fixture expects a boolean; a string answer is refused with 422.
  prodSession = await submitResponse(SLUG, [[ACCIDENT, false]]);
});

test("a response's detail offers no other environment when there is nothing elsewhere", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(`/operations/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toBeVisible();

  await expect(page.getByTestId("qcms-erasure-elsewhere")).toHaveCount(0);
});

test("the erasure confirmation names the environment it would act in", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${FORM_ID}/responses/${prodSession}`);

  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();

  await expect(dialog).toContainText("prod");
  await expect(dialog.getByRole("button", { name: "Erase permanently" })).toBeDisabled();
});

test("a response read reaches the selected environment and no other", async ({
  page,
  browserGuard,
}) => {
  test.setTimeout(300_000);
  // Declare only the expected cross-environment 404 so the console gate still rejects other faults.
  browserGuard.expectRequestFailure({
    status: 404,
    url: new RegExp(`/responses/${prodSession}$`),
  });
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();

  await chooseEnvironment(page, "test");
  await page.goto(`/operations/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.locator("body")).not.toContainText("Erase respondent data…");

  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await chooseEnvironment(page, "prod");
  await page.goto(`/operations/forms/${FORM_ID}/responses/${prodSession}`);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toBeVisible();
});

test("an export downloads under the environment it was read from (Q8)", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();

  await chooseEnvironment(page, "test");
  expect((await downloadExport(page)).suggestedFilename()).toBe(`${FORM_ID}-test-v1-responses.csv`);

  await chooseEnvironment(page, "prod");
  expect((await downloadExport(page)).suggestedFilename()).toBe(`${FORM_ID}-prod-v1-responses.csv`);
});

async function downloadExport(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByTestId("qcms-export-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Version$/ }).click();
  await page.getByRole("option", { name: "v1", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByTestId("qcms-export-download").click(),
  ]);
  return download;
}
