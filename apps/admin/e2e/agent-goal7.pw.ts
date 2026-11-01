import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

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
import { addStep, createForm, pinQuestion, savedStamp, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { submitResponse } from "./support/ops.js";

/**
 * Criterion 13: task 038's goal 7, rehearsed against the fake provider.
 *
 * The launch gate asks a human tester for one assisted run: a change on at least three
 * screens, one single-step card and one multi-step plan each confirmed through the screen's
 * own control, one cancelled proposal that changed nothing, a read-only user offered no
 * write, and no answer value anywhere in the conversation. This file walks that run, so the
 * rehearsal is a suite the gate can be read against rather than a script nobody has run.
 *
 * It is not a second copy of the card matrix. Each screen group's own spec owns its kinds,
 * its states and its axe sweeps; what is here is the **shape of the run**, end to end,
 * across three screens in one sitting.
 *
 * ## The answer value is a planted sentinel
 *
 * The one claim the gate calls launch-blocking cannot be made with a value that might also
 * be an id or a timestamp, so the response this run reads carries a name no other string in
 * the product could be: letters only, because the question's own pattern allows nothing
 * else. Every conversation this file opens is then read in full and must not hold it.
 */

test.describe.configure({ mode: "serial" });

/** The account that performs the run, holding every grant a tester's own would. */
const EMAIL = uniqueAdminEmail("agentgoal7");

/** The read-only account: one viewer grant and no workspace membership. */
const VIEWER = uniqueAdminEmail("agentgoal7viewer");

const RUN = Date.now().toString(36);

/** A published library question with a text answer, so the sentinel has somewhere to live. */
const SEEDED_QUESTION = "q_full_name";

/**
 * The needle the builder's draft proposal searches the library with.
 *
 * It matches exactly one library question by slug and id, so the draft the assistant
 * proposes pins that one and gates nothing behind a rule. That is what lets the run go on
 * to publish the applied draft and answer it with one value.
 */
const NEEDLE = "full";

/**
 * The planted answer. Letters and spaces only: `q_full_name` constrains its answer to
 * `^[A-Za-z][A-Za-z .,'-]{0,99}$`, so a digit would be refused at submission.
 */
const ANSWER = "Zzyxwvu Sentinelanswer";

let totpSecret = "";
let formId = "";
let formSlug = "";
let erased = "";
let kept = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  // One viewer grant and no workspace membership, which is the read-only user goal 7 names.
  await createTestAdmin(VIEWER, { grants: ["forms.viewer"], owner: false });
});

/** The conversation itself, which is what must never hold an answer. */
function turns(page: Page): Locator {
  return page.getByTestId("qcms-assistant-turns");
}

async function expectNoAnswerValue(page: Page, where: string): Promise<void> {
  expect(
    (await turns(page).textContent()) ?? "",
    `an answer value reached the conversation on ${where} (038's goal 7)`,
  ).not.toContain(ANSWER);
}

/** Send one scripted turn that proposes nothing, for the read tools' own sweep. */
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

  // SCREEN ONE, THE BUILDER, and the single-step card: the assistant proposes a draft and
  // the step that applies it runs the builder's own save.
  await page.goto(`/forms/${formId}`);
  await openPanel(page);
  const previousSave = await savedStamp(page);
  await propose(page, "default", `ask for a name up front #qcms-fake-search:${NEEDLE}`);
  await expectWaitingStepStates(page, "Proposed");
  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();
  expect(await savedStamp(page)).not.toBe(previousSave);
  // The draft the run goes on to publish, asserted rather than assumed: it pins the one
  // question the needle matched, which is the one the submission below answers.
  await expect(page.locator("tr.qcms-pinrow")).toHaveCount(1);
  await expect(page.locator(`tr[data-pin-question="${SEEDED_QUESTION}"]`)).toHaveCount(1);

  // SCREEN TWO, THE RELEASES SCREEN, and the multi-step plan: freeze the draft and promote
  // the version step 1 records, each step through that screen's own server action.
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

  // Two responses, one for the confirmed erasure and one for the cancelled proposal. The
  // respondent mount is production's own, which the promotion above is what makes reachable.
  erased = await submitResponse(formSlug, [[SEEDED_QUESTION, ANSWER]]);
  kept = await submitResponse(formSlug, [[SEEDED_QUESTION, ANSWER]]);

  // SCREEN THREE, A RESPONSE SCREEN. Every read tool the screen offers runs first, so the
  // conversation holds everything the assistant can say about a response before anything
  // is proposed about it.
  await page.goto(`/forms/${formId}/responses/${erased}`);
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
  await page.goto(`/forms/${formId}/responses/${kept}`);
  await waitForHydration(page);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-response-erase", "erase this respondent's data");
  await cancel(page);

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(page.getByTestId("qcms-tombstone")).toHaveCount(0);
  // The answers the erasure would have destroyed are still on screen.
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

  // The turn ends in words rather than in a card, because the propose tools were offered no
  // kind this account holds: the grant filter is upstream of the proposal.
  await expect(turns(page)).toContainText("You cannot change anything on this screen", {
    timeout: 120_000,
  });
  await expect(card(page)).toHaveCount(0);
  expect(auditDelta(before, await auditTally())).toEqual({});
});
