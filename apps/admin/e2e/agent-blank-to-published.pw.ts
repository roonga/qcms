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

/**
 * The goal: an editor goes from a blank form to a published one in the lowest environment
 * with the assistant, from the builder (Code Owner, 2026-11-02).
 *
 * It is two cards and not one plan. The first applies the draft alone, so the editor reads
 * the diff and may edit the form; the panel then posts a turn of its own and the assistant
 * asks for approval, proposing one publish per question version the SAVED draft pins
 * unpublished and then the form itself. What this spec pins is the whole walk, the edit
 * made between the two cards reaching the second one, and a cancel on the second card
 * publishing nothing.
 */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agent1205blank");

const RUN = Date.now().toString(36);

/** The run's own question ids, since a question id and a slug are never reused (R6). */
const NEW = `bp${RUN}`;

/** The questions the script writes, which is a patient-registration shape. */
const QUESTION_COUNT = 12;

let totpSecret = "";
let journeyFormId = "";
let cancelFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The first card: a complete form and the step that applies it, alone. */
async function describeTheForm(page: Page, word: string): Promise<void> {
  await propose(
    page,
    "blank-to-published",
    `set up patient registration for the clinic #qcms-fake-new:${word}`,
  );
}

/** The second card, which the panel's own follow-up turn brings. */
async function waitForPublishCard(page: Page, steps: number): Promise<void> {
  await expect(cardSteps(page)).toHaveCount(steps, { timeout: 60_000 });
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
  journeyFormId = await createForm(page, `agent-bp-${RUN}`, "Patient registration");
  await page.goto(`/forms/${journeyFormId}`);
  await openPanel(page);

  const before = await auditTally();
  const previousSave = await savedStamp(page);

  // CARD ONE: the draft alone, with its diff and the server's own two advisory lists. The
  // questions it pins do not exist yet, so the draft cannot publish and the card does not
  // offer to.
  await describeTheForm(page, NEW);
  await expect(cardSteps(page)).toHaveCount(1);
  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expectAxeClean(page, "proposed draft");

  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);

  // CARD TWO: one publish per question the saved draft pins, then the form. Nobody typed
  // anything to ask for it.
  await waitForPublishCard(page, QUESTION_COUNT + 1);
  // Every act is on the card, named in full, rather than a count of them.
  for (const suffix of ["given_name", "allergies", "consent_share"]) {
    await expect(card(page)).toContainText(`q_fake_new_${NEW}_${suffix}`);
  }
  await expect(card(page).getByRole("button", { name: /^Confirm all 13/u })).toBeVisible();
  await expectAxeClean(page, "proposed publish plan");

  await confirm(page, new RegExp(`^Done\\. All ${String(QUESTION_COUNT + 1)} steps ran`, "u"));
  await expectAxeClean(page, "done publish plan");

  // The form is published and serving in the lowest environment, and production is
  // untouched: the plan never named it.
  await expectServing(page, journeyFormId, "v1");
  await expect(
    page.getByTestId("qcms-released-now").locator(`tr[data-environment="prod"]`),
  ).toContainText("Nothing released");

  // One audit row per question, plus the form's own: a batch would have left one row for
  // all of them.
  expect(auditDelta(before, await auditTally())).toEqual({
    "question.publish": QUESTION_COUNT,
    "form.publish": 1,
  });
});

test("publishes what the editor left in the draft, not what the proposal said", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  cancelFormId = await createForm(page, `agent-bp-edit-${RUN}`, "Patient registration");
  const word = `${NEW}e`;
  await page.goto(`/forms/${cancelFormId}`);
  await openPanel(page);

  const previousSave = await savedStamp(page);
  await describeTheForm(page, word);
  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);
  await waitForPublishCard(page, QUESTION_COUNT + 1);

  // The editor reads the diff, decides against one question, and cancels the publish card
  // to go and remove it.
  await cancel(page);
  const beforeEdit = await savedStamp(page);
  await page.goto(`/forms/${cancelFormId}`);
  await openStep(page, "Your GP and consent");
  await usePinRowMenu(page, `q_fake_new_${word}_gp_name`, "remove");
  await waitForSaveAfter(page, beforeEdit);

  // Asking again reads the saved draft, so the question they removed is not in the plan
  // and the eleven they kept are.
  await openPanel(page);
  const before = await auditTally();
  await propose(page, "plan-publish-pins", "publish the questions and then the form");
  await expect(cardSteps(page)).toHaveCount(QUESTION_COUNT);
  await expect(card(page)).not.toContainText(`q_fake_new_${word}_gp_name`);
  await expect(card(page)).toContainText(`q_fake_new_${word}_given_name`);

  await confirm(page, new RegExp(`^Done\\. All ${String(QUESTION_COUNT)} steps ran`, "u"));
  await expectServing(page, cancelFormId, "v1");
  expect(auditDelta(before, await auditTally())).toEqual({
    "question.publish": QUESTION_COUNT - 1,
    "form.publish": 1,
  });
});

test("publishes nothing when the publish card is cancelled", async ({ page }) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const formId = await createForm(page, `agent-bp-cancel-${RUN}`, "Patient registration");
  const word = `${NEW}c`;
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const previousSave = await savedStamp(page);
  await describeTheForm(page, word);
  await confirm(page, /^Done\./u);
  await waitForSaveAfter(page, previousSave);
  await waitForPublishCard(page, QUESTION_COUNT + 1);

  const before = await auditTally();
  await cancel(page);
  await expectAxeClean(page, "cancelled publish plan");

  // Nothing was published: no question moved, no version was frozen, no row was written.
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
  // The propose tool refused it, so the turn ends with prose and no card at all.
  await expect(page.getByTestId("qcms-assistant-streaming")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qcms-assistant-streaming")).toHaveCount(0, { timeout: 60_000 });
  await expect(card(page)).toHaveCount(0);
});
