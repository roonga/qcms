import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  card,
  cardChip,
  cardSteps,
  confirm,
  confirmButton,
  expectAxeClean,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  createForm,
  openStep,
  savedStamp,
  usePinRowMenu,
  waitForSaveAfter,
} from "./support/forms.js";

// Keep slugs sorted last: Operations shows 25 rows by slug, shared with other specs' fixtures.

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agent1205blank");

const RUN = Date.now().toString(36);

const QUESTION_COUNT = 12;

let totpSecret = "";
let journeyFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function describeTheForm(page: Page, word: string): Promise<void> {
  await propose(
    page,
    "blank-to-published",
    `set up patient registration for the clinic #qcms-fake-new:${word}`,
  );
}

async function waitForPublishCard(page: Page, steps: number): Promise<void> {
  await expect(cardSteps(page)).toHaveCount(steps, { timeout: 120_000 });
  await expect(cardChip(page)).toHaveText("Proposed");
}

async function expectServing(page: Page, formId: string, text: string): Promise<void> {
  await page.goto(`/forms/${formId}/versions`);
  await expect(
    page.getByTestId("qcms-released-now").locator(`tr[data-environment="test"]`),
  ).toContainText(text, { timeout: 30_000 });
}

test("takes a blank form to a published one in test, through two cards", async ({ page }) => {
  test.setTimeout(900_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  journeyFormId = await createForm(page, `zzz-bp-${RUN}`, "Patient registration");
  await page.goto(`/forms/${journeyFormId}`);
  await openPanel(page);

  const before = await auditTally();
  const previousSave = await savedStamp(page);

  await describeTheForm(page, `bp${RUN}`);
  await expect(cardSteps(page)).toHaveCount(1);
  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expectAxeClean(page, "proposed draft");

  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);

  await waitForPublishCard(page, QUESTION_COUNT + 1);

  for (const suffix of ["given_name", "allergies", "consent_share"]) {
    await expect(card(page)).toContainText(`q_fake_new_bp${RUN}_${suffix}`);
  }
  await expect(card(page).getByRole("button", { name: /^Confirm all 13/u })).toBeVisible();
  await expectAxeClean(page, "proposed publish plan");

  await confirm(page, new RegExp(`^Done\\. All ${String(QUESTION_COUNT + 1)} steps ran`, "u"));
  await expectAxeClean(page, "done publish plan");

  await expectServing(page, journeyFormId, "v1");
  await expect(
    page.getByTestId("qcms-released-now").locator(`tr[data-environment="prod"]`),
  ).toContainText("Nothing released");

  expect(auditDelta(before, await auditTally())).toEqual({
    "question.publish": QUESTION_COUNT,
    "form.publish": 1,
  });
});

test("cancels the publish card, then publishes what the editor left in the draft", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const formId = await createForm(page, `zzz-bp-edit-${RUN}`, "Patient registration");
  const word = `bp${RUN}e`;
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const previousSave = await savedStamp(page);
  await describeTheForm(page, word);
  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);
  await waitForPublishCard(page, QUESTION_COUNT + 1);

  const beforeCancel = await auditTally();
  await cancel(page);
  await expectAxeClean(page, "cancelled publish plan");
  expect(auditDelta(beforeCancel, await auditTally())).toEqual({});
  await expectServing(page, formId, "Nothing released");

  await page.goto(`/forms/${formId}`);
  const beforeEdit = await savedStamp(page);
  await openStep(page, "Your GP and consent");
  await usePinRowMenu(page, `q_fake_new_${word}_gp_name`, "remove");
  await waitForSaveAfter(page, beforeEdit);

  await openPanel(page);
  const before = await auditTally();
  await propose(page, "plan-publish-pins", "publish the questions and then the form");
  await expect(cardSteps(page)).toHaveCount(QUESTION_COUNT);
  await expect(card(page)).not.toContainText(`q_fake_new_${word}_gp_name`);
  await expect(card(page)).toContainText(`q_fake_new_${word}_given_name`);

  await confirm(page, new RegExp(`^Done\\. All ${String(QUESTION_COUNT)} steps ran`, "u"));
  await expectServing(page, formId, "v1");
  expect(auditDelta(before, await auditTally())).toEqual({
    "question.publish": QUESTION_COUNT - 1,
    "form.publish": 1,
  });
});

test("refuses the publish card after the editor changes the saved draft", async ({ page }) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const formId = await createForm(page, `zzz-bp-moved-${RUN}`, "Patient registration");
  const word = `bp${RUN}m`;
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const previousSave = await savedStamp(page);
  await describeTheForm(page, word);
  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);
  await waitForPublishCard(page, QUESTION_COUNT + 1);

  const beforeEdit = await savedStamp(page);
  await openStep(page, "Your GP and consent");
  await usePinRowMenu(page, `q_fake_new_${word}_gp_name`, "remove");
  await waitForSaveAfter(page, beforeEdit);

  const before = await auditTally();
  await confirmButton(page).click();
  await expect(card(page).locator(".qcms-acard__result")).toHaveText(/^Stopped at step 1\./u, {
    timeout: 60_000,
  });
  await expect(card(page)).toContainText("saved draft has changed");
  await expectAxeClean(page, "refused publish plan");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expectServing(page, formId, "Nothing released");
});

test("refuses to publish a question this form's draft does not pin", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${journeyFormId}`);
  await openPanel(page);

  await page
    .getByTestId("qcms-assistant-composer")
    .fill("#qcms-fake:propose-question-publish-foreign publish that other question");
  await page.getByTestId("qcms-assistant-send").locator("button").click();

  await expect(page.getByTestId("qcms-assistant-streaming")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qcms-assistant-streaming")).toHaveCount(0, { timeout: 60_000 });
  await expect(card(page)).toHaveCount(0);
});
