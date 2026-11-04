import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { chooseEnvironment } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  card,
  confirm,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
  typeConfirmation,
} from "./support/agent-card.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  openRail,
  pinQuestion,
  savedStamp,
  waitForSaved,
} from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { submitResponse } from "./support/ops.js";

// Plant an answer distinguishable from ids and timestamps so a conversation leak is observable.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentgoal7");

const VIEWER = uniqueAdminEmail("agentgoal7viewer");

const RUN = Date.now().toString(36);

const SEEDED_QUESTION = "q_full_name";

// The search needle must select exactly one question so the applied draft can publish and accept one answer.
const NEEDLE = "full";

// The sentinel must contain only letters and spaces to satisfy q_full_name's answer pattern.
const ANSWER = "Zzyxwvu Sentinelanswer";

let totpSecret = "";
let formId = "";
let formSlug = "";
let erased = "";
let kept = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);

  await createTestAdmin(VIEWER, { grants: ["forms.viewer"], owner: false });
});

function turns(page: Page): Locator {
  return page.getByTestId("qcms-assistant-turns");
}

async function expectNoAnswerValue(page: Page, where: string): Promise<void> {
  expect(
    (await turns(page).textContent()) ?? "",
    `an answer value reached the conversation on ${where} (038's goal 7)`,
  ).not.toContain(ANSWER);
}

async function send(page: Page, script: string, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), `#qcms-fake:${script} ${message}`);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

test("changes the builder, the releases screen and a response screen in one run", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formSlug = `agent-goal7-${RUN}`;
  formId = await createForm(page, formSlug, "Assisted run");
  await addStep(page, "About you");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  const before = await auditTally();

  await page.goto(`/forms/${formId}`);
  await openPanel(page);
  const previousSave = await savedStamp(page);
  await propose(page, "default", `ask for a name up front #qcms-fake-search:${NEEDLE}`);
  await expectWaitingStepStates(page, "Proposed");
  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();
  expect(await savedStamp(page)).not.toBe(previousSave);

  await openRail(page);
  await expect(page.getByRole("button", { name: "Open step Driving history" })).toBeVisible();

  await page.goto(`/forms/${formId}/publish`);
  await openPanel(page);
  await propose(page, "plan-releases", "freeze this and promote it to production");
  await expect(card(page)).toContainText("step 1's version");
  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);

  await page.goto(`/forms/${formId}/versions`);
  await expect(
    page.getByTestId("qcms-released-now").locator('tr[data-environment="prod"]'),
  ).toContainText("v1", { timeout: 30_000 });

  erased = await submitResponse(formSlug, [[SEEDED_QUESTION, ANSWER]]);
  kept = await submitResponse(formSlug, [[SEEDED_QUESTION, ANSWER]]);

  await chooseEnvironment(page, "prod");

  await page.goto(`/operations/forms/${formId}/responses/${erased}`);
  await waitForHydration(page);
  await openPanel(page);
  await expect(page.getByTestId("qcms-locked-answers")).toContainText(ANSWER);
  await send(page, "read-all", "read everything you can see here");
  await expect(turns(page)).toContainText("I have read everything this screen offers.", {
    timeout: 120_000,
  });
  await expectNoAnswerValue(page, "the response screen's read turn");

  await propose(page, "propose-response-erase", "erase this respondent's data");
  await typeConfirmation(page, erased);
  await confirm(page, /^Done\./u);
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expectNoAnswerValue(page, "the response screen's erasure");

  expect(auditDelta(before, await auditTally())).toEqual({
    "form.publish": 1,
    "form.release": 1,
    "response.erase": 1,
  });
});

test("changes nothing when the tester cancels a proposal", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await chooseEnvironment(page, "prod");
  await page.goto(`/operations/forms/${formId}/responses/${kept}`);
  await waitForHydration(page);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-response-erase", "erase this respondent's data");
  await cancel(page);

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(page.getByTestId("qcms-tombstone")).toHaveCount(0);

  await expect(page.getByTestId("qcms-locked-answers")).toContainText(ANSWER);
  await expectNoAnswerValue(page, "the cancelled erasure");
});

test("offers a read-only user no write at all", async ({ page }) => {
  test.setTimeout(600_000);
  await enrollNewAdmin(page, VIEWER);

  await page.goto(`/forms/${formId}`);
  await waitForHydration(page);
  await openPanel(page);

  const before = await auditTally();
  await send(page, "read-only-user", "close this form for me");

  await expect(turns(page)).toContainText("You cannot change anything on this screen", {
    timeout: 120_000,
  });
  await expect(card(page)).toHaveCount(0);
  expect(auditDelta(before, await auditTally())).toEqual({});
});
