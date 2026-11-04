import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  card,
  confirm,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083draft");

const RUN = Date.now().toString(36);

const SEEDED_QUESTION = "q_accident_count";
const NEEDLE = "accident";

let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function proposeDraft(page: Page): Promise<void> {
  await propose(
    page,
    "default",
    `a short intake for an at-fault accident #qcms-fake-search:${NEEDLE}`,
  );
}

test("shows the diff and both lists, and accepting saves the draft as assisted", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = await createForm(page, `agent-draft-${RUN}`, "Agent draft");

  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const before = await auditTally();
  await proposeDraft(page);
  await expectWaitingStepStates(page, "Proposed");

  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expect(card(page).getByTestId("qcms-acard-diff").locator("li")).not.toHaveCount(0);
  await expect(card(page).getByTestId("qcms-acard-issues")).toContainText("Validation passes");
  await expectAxeClean(page, "proposed draft");

  const previousSave = await savedStamp(page);
  await confirm(page, /^Done\./u);
  await expectAxeClean(page, "done");

  await waitForSaveAfter(page, previousSave);
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();

  expect(auditDelta(before, await auditTally())).toEqual({});
});

test("confirms the draft inside a plan, with the builder's own settings behind it", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const before = await auditTally();
  const previousSave = await savedStamp(page);
  await propose(
    page,
    "plan-apply-draft",
    `tighten this intake and its abuse controls #qcms-fake-search:${NEEDLE}`,
  );
  await expectWaitingStepStates(page, "Proposed");

  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expectAxeClean(page, "proposed plan");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await waitForSaveAfter(page, previousSave);
  await page.goto(`/forms/${formId}`);
  await expect(
    page.getByRole("checkbox", { name: "Require a challenge before answering" }),
  ).toBeChecked();
  expect(auditDelta(before, await auditTally())).toEqual({ "form.settings": 1 });
});

// A local step precedes the referenced step, so card positions differ from token positions.
// Reuse this form: adding a form ahead of other fixtures can displace them from Operations' first page.
test("confirms a plan whose later step references a publish behind the local step", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const before = await auditTally();
  await propose(
    page,
    "plan-apply-draft-release",
    `tighten this intake, freeze it and promote it #qcms-fake-search:${NEEDLE}`,
  );
  await expectWaitingStepStates(page, "Proposed");

  await expect(card(page)).toContainText("step 2's version");

  await confirm(page, /^Done\. All 3 steps ran/u);
  await expectStepChips(page, ["Done", "Done", "Done"]);
  await expectAxeClean(page, "done plan with a local step first");

  expect(auditDelta(before, await auditTally())).toEqual({
    "form.publish": 1,
    "form.release": 1,
  });
});

test("saves nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const stamp = await savedStamp(page);
  await proposeDraft(page);
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(await savedStamp(page)).toBe(stamp);
});
