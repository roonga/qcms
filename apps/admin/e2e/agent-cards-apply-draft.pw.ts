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

/**
 * Criterion 11 for `apply-draft`, the one kind that carries a document rather than
 * arguments: the diff against the working draft and the server's two advisory lists on
 * the card, an Accept that saves the draft and marks it assisted, a plan that applies the
 * draft and then changes the form's own settings, and a cancel that saves nothing.
 *
 * ## Why the plan carries a second kind
 *
 * The propose tool keeps one draft-applying step per plan, so this kind can only be
 * confirmed inside a plan beside a kind of another sort. The settings step is the builder
 * screen's own, which is what keeps the plan one screen's work.
 *
 * ## Why it leaves no audit row
 *
 * The step is local: the builder's own save completes it, so it reaches no route, carries
 * no token and writes no `control.agent_actions` row. The row this task's audit is for
 * records an act performed against the API, and the draft save is the screen's own.
 *
 * `agent-assist.pw.ts` carries the journey this kind belongs to, from the proposal through
 * the unchanged human publish. What is here is the rest of the card's matrix: its waiting
 * states measured by axe, and the cancel path.
 */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083draft");

const RUN = Date.now().toString(36);

/** The seeded insurance questions, which are published and which the needle below finds. */
const SEEDED_QUESTION = "q_accident_count";
const NEEDLE = "accident";

let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The turn the builder's own card comes from: a draft proposal, then the step applying it. */
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
  // A draft to diff against, so the proposal is a change rather than trivially all new.
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  await page.goto(`/forms/${formId}`);
  await openPanel(page);

  const before = await auditTally();
  await proposeDraft(page);
  await expectWaitingStepStates(page, "Proposed");

  // The document the step carries: the diff in full, and the server's own verdict on it.
  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expect(card(page).getByTestId("qcms-acard-diff").locator("li")).not.toHaveCount(0);
  await expect(card(page).getByTestId("qcms-acard-issues")).toContainText("Validation passes");
  await expectAxeClean(page, "proposed draft");

  const previousSave = await savedStamp(page);
  await confirm(page, /^Done\./u);
  await expectAxeClean(page, "done");

  // Accepting is the builder's own draft save, and the human who publishes is told what
  // they are signing.
  await waitForSaveAfter(page, previousSave);
  await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();

  // A local step reaches no route, so it leaves no row in the agent audit.
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
  // The document is on the step that applies it, inside the plan rather than beside it.
  await expect(card(page).getByTestId("qcms-acard-draft")).toBeVisible();
  await expectAxeClean(page, "proposed plan");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  // The draft step is the builder's own save and the settings step reached a route, so the
  // screen reads one back and the audit holds a row for the other alone.
  await waitForSaveAfter(page, previousSave);
  await page.goto(`/forms/${formId}`);
  await expect(
    page.getByRole("checkbox", { name: "Require a challenge before answering" }),
  ).toBeChecked();
  expect(auditDelta(before, await auditTally())).toEqual({ "form.settings": 1 });
});

/**
 * The local step sits before a reference, so the step a reference names is at one index on
 * the card and another in the token: the card's third step runs on the version its second
 * records, and the token binds only two steps.
 */
test("confirms a plan whose later step references a publish behind the local step", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const planFormId = await createForm(page, `agent-draft-rel-${RUN}`, "Agent draft release");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  await page.goto(`/forms/${planFormId}`);
  await openPanel(page);

  const before = await auditTally();
  await propose(
    page,
    "plan-apply-draft-release",
    `tighten this intake, freeze it and promote it #qcms-fake-search:${NEEDLE}`,
  );
  await expectWaitingStepStates(page, "Proposed");
  // Named by its place on the card, which is the plan's own order rather than the token's.
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

  // The draft is as it was: nothing was saved, so the strip still reads the same instant.
  expect(await savedStamp(page)).toBe(stamp);
});
