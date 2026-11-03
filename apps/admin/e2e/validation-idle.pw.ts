import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issueSummary,
  openFormDetails,
  openStep,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("validation625");
const RUN = Date.now().toString(36);

// Read fixtures inside the test: globalSetup writes the fixture file after test-file collection.
function seededForm(): string {
  return readFixtures().unpublishedPinFormId;
}

const SEEDED_STEP = "stp_history";

const NOT_CHECKED = "This draft has not been checked yet.";
const ALL_CLEAR = "No issues. Everything here would pass a publish.";

let totpSecret = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("a draft with issues does not read as publish-ready before anything has checked it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${seededForm()}`);

  await expect(issueSummary(page)).toContainText(NOT_CHECKED);
  await expect(issueSummary(page)).not.toContainText("would pass a publish");

  await openStep(page, "Driving history");
  await expect(page.locator('[data-pin-issues="unchecked"]')).toHaveCount(2);
  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(0);

  await expect(page.locator("[data-step-issues]")).toHaveCount(0);
});

test("the §7 rail's count and the builder's silence are about the same draft", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/forms/${seededForm()}/versions`);
  const badge = page.locator(`[data-rail-item="step:${SEEDED_STEP}"] [data-rail-issues]`);
  await expect(badge).toHaveAttribute("data-rail-issues", "2");
});

test("a stored, checked, clean draft still says it has not been checked after a reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const questionSlug = `e2e-idle-${RUN}`;
  await createDraft(page, questionSlug, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `idle-${RUN}`, "Untouched draft");
  await addStep(page, "Only step");
  await pinQuestion(page, `q_${questionSlug.replaceAll("-", "_")}`, 1);
  await waitForSaved(page);

  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(1);
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText(ALL_CLEAR, { timeout: 30_000 });

  await page.reload();
  await expect(issueSummary(page)).toContainText(NOT_CHECKED);
  await openStep(page, "Only step");
  await expect(page.locator('[data-pin-issues="unchecked"]')).toHaveCount(1);

  const before = await savedStamp(page);
  await openFormDetails(page);
  await fillStable(field(page, "Form title"), "Untouched draft, renamed");
  await waitForSaveAfter(page, before);
  await expect(issueSummary(page)).toHaveText(ALL_CLEAR, { timeout: 30_000 });
  await openStep(page, "Only step");
  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(1);
});
