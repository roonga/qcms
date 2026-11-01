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
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";

/**
 * Criterion 11 on the builder's publish and the releases screen: `form.publish` and
 * `form.release` confirmed alone and inside one plan, a cancel that freezes nothing, and
 * the production band a card shows for a step that changes what respondents are served.
 *
 * ## Why each form is this spec's own
 *
 * A publish freezes a new immutable version and releases it, and a release is refused for
 * a version already serving its destination. Both are facts about one form's history, so
 * a spec sharing the seeded form would pass or fail on how many times the rest of the
 * suite had published it. Each form here is built, published and promoted once.
 */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083releases");

const RUN = Date.now().toString(36);

/** A published library question, so a one-step draft validates and can be frozen. */
const SEEDED_QUESTION = "q_accident_count";

let totpSecret = "";

/** The form the alone paths run on, and the one the plan publishes and promotes. */
let aloneFormId = "";
let planFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** A form with one step and one pinned published question, which is a publishable draft. */
async function buildPublishableForm(page: Page, slug: string): Promise<string> {
  const formId = await createForm(page, slug, "Agent releases");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);
  return formId;
}

/**
 * What each environment is serving, as the versions screen states it. That table is on
 * the versions screen rather than behind the releases wizard, so each act is proposed
 * where its own control lives and read where the screen reports it.
 */
async function expectServing(
  page: Page,
  formId: string,
  serving: Readonly<Record<string, string>>,
): Promise<void> {
  await page.goto(`/forms/${formId}/versions`);
  const now = page.getByTestId("qcms-released-now");
  for (const [environment, text] of Object.entries(serving)) {
    await expect(now.locator(`tr[data-environment="${environment}"]`)).toContainText(text, {
      timeout: 30_000,
    });
  }
}

test("confirms a publish and then a promotion, each changing what the screen serves", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  aloneFormId = await buildPublishableForm(page, `agent-rel-${RUN}`);

  await openPanel(page);
  const before = await auditTally();
  await propose(page, "propose-form-publish", "freeze this draft and put it in test");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");

  await expectServing(page, aloneFormId, { test: "v1", prod: "Nothing released" });

  await page.goto(`/forms/${aloneFormId}/publish`);
  await openPanel(page);
  await propose(page, "propose-form-release", "promote that version to production");
  // A step that changes where respondents' answers are sent says so on the card itself.
  await expect(card(page)).toContainText(
    "Production: changes where respondents' answers are sent.",
  );
  await confirm(page, /^Done\./u);

  await expectServing(page, aloneFormId, { test: "v1", prod: "v1" });
  expect(auditDelta(before, await auditTally())).toEqual({
    "form.publish": 1,
    "form.release": 1,
  });
});

test("freezes nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${aloneFormId}/publish`);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-publish", "freeze this draft and put it in test");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  // Still the one version in each environment: nothing was frozen and nothing promoted.
  await expectServing(page, aloneFormId, { test: "v1", prod: "v1" });
});

test("confirms a publish and a promotion inside one plan, the second step using the first's version", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  planFormId = await buildPublishableForm(page, `agent-rel-plan-${RUN}`);

  await page.goto(`/forms/${planFormId}/publish`);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "plan-releases", "freeze this and promote it to production");
  await expectWaitingStepStates(page, "Proposed");
  // The second step names no version of its own: it runs on the version step 1 records,
  // and the card says so rather than showing a number nothing has decided yet.
  await expect(card(page)).toContainText("step 1's version");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await expectServing(page, planFormId, { test: "v1", prod: "v1" });
  expect(auditDelta(before, await auditTally())).toEqual({
    "form.publish": 1,
    "form.release": 1,
  });
});
