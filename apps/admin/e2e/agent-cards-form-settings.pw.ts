import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  confirm,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083settings");

const RUN = Date.now().toString(36);

const SEEDED_QUESTION = "q_accident_count";

const CHALLENGE = "Require a challenge before answering";

let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("confirms a settings change alone, which the screen then reads back", async ({ page }) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = await createForm(page, `agent-settings-${RUN}`, "Agent settings");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  await openPanel(page);
  await propose(page, "propose-form-publish", "freeze this draft and put it in test");
  await confirm(page, /^Done\./u);

  const before = await auditTally();
  await propose(page, "propose-form-settings", "require a challenge and a slower submit");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");

  await page.goto(`/forms/${formId}`);
  await expect(page.getByRole("checkbox", { name: CHALLENGE })).toBeChecked();

  await expect(page.getByText("Challenge required, minimum time 1500 ms")).toBeVisible();

  expect(auditDelta(before, await auditTally())).toEqual({ "form.settings": 1 });
});

test("changes nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-settings", "require a challenge and a slower submit");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
});

test("confirms the close and the reopen inside one plan, on the Availability screen", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/availability`);
  await openPanel(page);
  await expect(page.getByRole("button", { name: /^Close in/u })).toBeVisible();

  const before = await auditTally();
  await propose(page, "plan-intake", "close intake and reopen it");
  await expectWaitingStepStates(page, "Proposed");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await expect(page.getByRole("button", { name: /^Close in/u })).toBeVisible({ timeout: 30_000 });
  expect(auditDelta(before, await auditTally())).toEqual({
    "form.close": 1,
    "form.reopen": 1,
  });
});
