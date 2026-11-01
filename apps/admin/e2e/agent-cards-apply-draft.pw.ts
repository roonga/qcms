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
 * the card, an Accept that saves the draft and marks it assisted, and a cancel that saves
 * nothing.
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
