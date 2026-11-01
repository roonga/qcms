import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { openDbHandle } from "../../api/e2e/support/index.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  card,
  cardChip,
  confirm,
  confirmButton,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { chooseEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { openDeliverer, submitResponse, TestConsumer } from "./support/ops.js";
import { publishDraftThroughWizard, releaseThroughWizard } from "./support/publish.js";

/**
 * Criterion 11 on a form's delivery endpoints and their deliveries: all six D5 kinds
 * confirmed alone and inside one plan, a cancel that configures nothing, the once-only
 * secret a create and a rotation reveal, and the Pending approval state a production
 * endpoint change ends a plan on.
 *
 * ## Two forms, and why the second one has to deliver something
 *
 * The configuration kinds need an endpoint and nothing else, so the first form is created
 * here and never published: nothing is delivered to it and the endpoint is configuration
 * alone, which keeps this form out of the delivery counts `responses-ops.pw.ts` makes.
 *
 * `webhook.redeliver` names a delivery row, which exists only once a response has fanned
 * out to an endpoint. So the second form is published, released and answered, with a
 * consumer of this spec's own answering 200 - nothing dead-letters, so the global
 * dead-letter queue that spec counts never sees a row of ours. Every stretch that
 * redelivers ends by draining the queue again, so this file leaves no delivery a later
 * spec's own pass could push into that queue.
 *
 * ## Everything here acts in production
 *
 * Endpoints, deliveries and the outbox are one environment's own rows, and the respondent
 * mount is production's (SEC-14): a submission can only be made against a form released
 * there. Authoring a form moves the selection to `test`, so each form's set-up moves it
 * back before anything reads or writes an endpoint.
 *
 * ## This file holds the second-approver switch, and leaves it off
 *
 * The last test turns it on to reach Pending approval and turns it back off, which is the
 * invariant `two-person-rule.pw.ts` states for the same switch: `membership.pw.ts` asserts
 * it is unchecked and sorts after this file. The second `afterAll` below is the net under
 * that for a group cut short, where a retry would otherwise meet a switch left on.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083webhooks");

const RUN = Date.now().toString(36);

/** The workspace a bootstrapped installation is seeded with (ADR-41, task 068). */
const WORKSPACE_ID = "org_default_workspace";

/** A published library question, so a one-step draft validates and can be frozen. */
const SEEDED_QUESTION = "q_accident_count";

const ENDPOINT_URL = "https://hooks.example.test/qcms?channel=ops";

/** The target a retarget moves an endpoint to, as the fake's scripts name it. */
const MOVED_URL = "https://hooks.example.test/qcms?channel=audit";

const REVEALED = "Shown once, here only:";

let totpSecret = "";
/** The configuration form: no responses, so no delivery of its own. */
let configFormId = "";
/** The delivering form, with one response fanned out to a consumer of this spec's own. */
let deliverFormId = "";
let deliverSlug = "";

const consumer = new TestConsumer();
let deliverer: ReturnType<typeof openDeliverer> | undefined;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  await consumer.start();
  deliverer = openDeliverer();
});

test.afterAll(async () => {
  await deliverer?.close();
  await consumer.stop();
});

/**
 * Put the switch back to its default whatever happened above.
 *
 * The last test turns it off through the screen's own panel, which is the claim; this is
 * the net under it, and the case it exists for is a retry of a serial group cut short,
 * where the switch would still be on and `membership.pw.ts` asserts it is not. The same
 * shape and the same reasoning as `two-person-rule.pw.ts`'s hook, which records it in full.
 */
test.afterAll(async () => {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query(
      `update control."organization" set "requireSecondApprover" = false where id = $1`,
      [WORKSPACE_ID],
    );
    if (updated.rows.length === 0 && (updated as { rowCount?: number }).rowCount === 0) {
      throw new Error(`the second-approver cleanup matched no workspace for ${WORKSPACE_ID}`);
    }
  } finally {
    await handle.close();
  }
});

function endpoints(page: Page): Locator {
  return page.getByTestId("qcms-webhooks-table");
}

function endpointRow(page: Page, url: string): Locator {
  return endpoints(page).locator("tr").filter({ hasText: url });
}

function deliveries(page: Page): Locator {
  return page.getByTestId("qcms-deliveries-table");
}

/** The panel listing what a production workspace is holding for a second approver. */
function pendingPanel(page: Page): Locator {
  return page.getByTestId("qcms-endpoint-proposals");
}

async function openWebhooks(page: Page, form: string): Promise<void> {
  await page.goto(`/forms/${form}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
  await waitForHydration(page);
  await openPanel(page);
}

/** Configure one endpoint through the screen's own dialog, for a fixture rather than a claim. */
async function addEndpoint(page: Page, url: string): Promise<void> {
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByTestId("qcms-webhook-url-dialog");
  await dialog.getByRole("textbox", { name: "Endpoint URL" }).fill(url);
  await dialog.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(endpointRow(page, url)).toHaveCount(1);
}

/** A form with one step and one pinned published question, which is a publishable draft. */
async function buildPublishableForm(page: Page, slug: string): Promise<string> {
  const formId = await createForm(page, slug, "Agent webhooks");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);
  return formId;
}

/** Turn the workspace's second-approver switch on or off through the screen's own panel. */
async function setSecondApprover(page: Page, on: boolean): Promise<void> {
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);
  const control = page.getByRole("checkbox", {
    name: "Require a second approver for production",
    exact: true,
  });
  // The label is what gets pressed: the kit's checkbox hides its own input behind a
  // painted box, so a press aimed at the input is intercepted for its whole timeout.
  if ((await control.isChecked()) !== on) {
    await page.getByText("Require a second approver for production", { exact: true }).click();
  }
  await expect(control).toBeChecked({ checked: on });
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("the change is on the access audit", { exact: false })).toBeVisible();
}

test("confirms an endpoint and then a rotation, each revealing its secret once", async ({
  page,
}) => {
  test.setTimeout(900_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  configFormId = await createForm(page, `agent-hooks-${RUN}`, "Agent webhooks");
  await chooseEnvironment(page, "prod");
  await openWebhooks(page, configFormId);

  const before = await auditTally();
  await propose(page, "propose-webhook-create", "add a delivery endpoint here");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expect(card(page).locator(".qcms-acard__reveal")).toContainText(REVEALED);
  await expectAxeClean(page, "done");
  await expect(endpoints(page)).toContainText(ENDPOINT_URL, { timeout: 30_000 });

  // The rotation names the endpoint the screen listed, which is the turn reading the
  // environment's own rows rather than the control plane's.
  await propose(page, "propose-webhook-rotate", "rotate its signing secret");
  await expect(card(page)).toContainText("Rotate the signing secret of endpoint");
  await confirm(page, /^Done\./u);
  await expect(card(page).locator(".qcms-acard__reveal")).toContainText(REVEALED);

  expect(auditDelta(before, await auditTally())).toEqual({
    "webhook.create": 1,
    "webhook.rotate": 1,
  });
});

test("confirms the deactivation, the reactivation and the retarget, each alone", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWebhooks(page, configFormId);

  const before = await auditTally();
  await propose(page, "propose-webhook-deactivate", "stop delivering to that endpoint");
  await confirm(page, /^Done\./u);
  await expect(endpointRow(page, ENDPOINT_URL).locator("[data-active]")).toHaveAttribute(
    "data-active",
    "false",
    { timeout: 30_000 },
  );

  await propose(page, "propose-webhook-reactivate", "put it back in service");
  await confirm(page, /^Done\./u);
  await expect(endpointRow(page, ENDPOINT_URL).locator("[data-active]")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 30_000 },
  );

  // THE TABLE, not the response. A retarget answers 200 whether it moved the endpoint or
  // wrote the URL the row already held, and the screen's own re-read is the only place the
  // two look different.
  await propose(page, "propose-webhook-retarget", "point it at the audit channel instead");
  await expect(card(page)).toContainText(MOVED_URL);
  await confirm(page, /^Done\./u);
  await expect(endpoints(page)).toContainText(MOVED_URL, { timeout: 30_000 });
  await expect(endpoints(page)).not.toContainText(ENDPOINT_URL);

  expect(auditDelta(before, await auditTally())).toEqual({
    "webhook.deactivate": 1,
    "webhook.reactivate": 1,
    "webhook.retarget": 1,
  });
});

test("configures nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWebhooks(page, configFormId);

  const before = await auditTally();
  const rows = await endpoints(page).locator("tbody tr").count();
  await propose(page, "propose-webhook-create", "add a second delivery endpoint");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(endpoints(page).locator("tbody tr")).toHaveCount(rows);
  await expect(card(page).locator(".qcms-acard__reveal")).toHaveCount(0);
  // The endpoint is where the retarget above left it, so the cancel moved nothing either.
  await expect(endpoints(page)).toContainText(MOVED_URL);
});

test("confirms a redelivery alone, and drains the queue again afterwards", async ({ page }) => {
  test.setTimeout(900_000);
  const drain = deliverer;
  expect(drain, "the delivery harness is opened once for this file").toBeDefined();
  if (drain === undefined) return;

  await signInWithTotp(page, EMAIL, totpSecret);
  deliverSlug = `agent-hooks-live-${RUN}`;
  deliverFormId = await buildPublishableForm(page, deliverSlug);
  // Frozen where it was authored, then promoted into production: the respondent mount is
  // production's own, so without that release a session cannot be started at all.
  await publishDraftThroughWizard(page, {
    formId: deliverFormId,
    version: 1,
    environment: "test",
  });
  await chooseEnvironment(page, "prod");
  await releaseThroughWizard(page, { formId: deliverFormId, version: 1, environment: "prod" });

  await page.goto(`/forms/${deliverFormId}/webhooks`);
  await waitForHydration(page);
  await addEndpoint(page, consumer.url());

  await submitResponse(deliverSlug, [[SEEDED_QUESTION, 2]]);
  await drain.sweep();
  expect(consumer.received.length, "the submission reached this spec's consumer").toBe(1);

  await openWebhooks(page, deliverFormId);
  await expect(deliveries(page).locator('[data-status="delivered"]')).toHaveCount(1);

  const before = await auditTally();
  await propose(page, "propose-webhook-redeliver", "send that delivery again");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");
  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);

  // Due again, with its attempt record cleared: that is what the screen's own Redeliver
  // button leaves, and what the worker picks up on the next pass.
  await expect(deliveries(page).locator('[data-status="pending"]')).toHaveCount(1, {
    timeout: 30_000,
  });

  await drain.sweep();
  expect(consumer.received.length, "the redelivery reached the consumer too").toBe(2);
  await page.reload();
  await expect(deliveries(page).locator('[data-status="delivered"]')).toHaveCount(1);
  await expect(deliveries(page).locator('[data-status="deadLettered"]')).toHaveCount(0);

  expect(auditDelta(before, await auditTally())).toEqual({ "webhook.redeliver": 1 });
});

test("confirms all six kinds inside one plan, every later step naming what the first made", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const drain = deliverer;
  expect(drain, "the delivery harness is opened once for this file").toBeDefined();
  if (drain === undefined) return;

  await signInWithTotp(page, EMAIL, totpSecret);
  await chooseEnvironment(page, "prod");
  await openWebhooks(page, deliverFormId);

  const before = await auditTally();
  await propose(page, "plan-webhooks", "set an endpoint up and work the queue");
  await expectWaitingStepStates(page, "Proposed");
  // Four of the six steps name the endpoint step 1 configures rather than an id of their own.
  await expect(card(page)).toContainText("step 1's webhookId");
  await expectAxeClean(page, "proposed plan");

  await confirm(page, /^Done\. All 6 steps ran/u);
  await expectStepChips(page, ["Done", "Done", "Done", "Done", "Done", "Done"]);
  // Two of the six reveal a secret, so the assertion names one rather than the set.
  await expect(card(page).locator(".qcms-acard__reveal").first()).toContainText(REVEALED);
  await expectAxeClean(page, "done plan");

  // The endpoint the plan configured is at the retarget's target and back in service.
  await expect(endpointRow(page, MOVED_URL).locator("[data-active]")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 30_000 },
  );

  // And the queue the last step re-armed is drained, so nothing this spec queued is left
  // for a later spec's own pass to dead-letter.
  await drain.sweep();
  await page.reload();
  await expect(deliveries(page).locator('[data-status="pending"]')).toHaveCount(0);
  await expect(deliveries(page).locator('[data-status="deadLettered"]')).toHaveCount(0);

  expect(auditDelta(before, await auditTally())).toEqual({
    "webhook.create": 1,
    "webhook.retarget": 1,
    "webhook.deactivate": 1,
    "webhook.reactivate": 1,
    "webhook.rotate": 1,
    "webhook.redeliver": 1,
  });
});

test("ends the plan on Pending approval when production holds the change", async ({ page }) => {
  test.setTimeout(900_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const prodFormId = await createForm(page, `agent-hooks-prod-${RUN}`, "Agent webhooks");
  await chooseEnvironment(page, "prod");

  // The endpoint is configured before the switch goes on: with it on, a production create
  // is held too, and what this test is about is a change proposed against a live endpoint.
  await page.goto(`/forms/${prodFormId}/webhooks`);
  await waitForHydration(page);
  await addEndpoint(page, ENDPOINT_URL);
  await setSecondApprover(page, true);

  const before = await auditTally();
  await openWebhooks(page, prodFormId);
  await propose(page, "plan-pending-at-1", "move the endpoint and resend what is stuck");
  // The production band is on the step's own environment line, which is where a card says
  // what a production act changes.
  await expect(card(page)).toContainText("Production: changes where respondents");
  await expectWaitingStepStates(page, "Proposed");

  await confirmButton(page).click();
  // Terminal for the plan: the change is stored, the endpoint is as it was, and the step
  // after it is never sent.
  await expect(cardChip(page)).toHaveText("Pending approval", { timeout: 60_000 });
  await expectStepChips(page, ["Pending approval", "Not run"]);
  await expect(card(page)).toContainText("a different approver has to confirm it");
  await expectAxeClean(page, "pending approval");

  // Nothing live: the endpoint still delivers exactly as it did, and what is waiting is on
  // the screen's own panel.
  await expect(endpoints(page)).toContainText(ENDPOINT_URL);
  await expect(endpoints(page)).not.toContainText(MOVED_URL);
  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(pendingPanel(page)).toContainText(MOVED_URL);

  // A held change writes its row like any other confirmed step, and the step that was
  // never sent writes none.
  expect(auditDelta(before, await auditTally())).toEqual({ "webhook.retarget": 1 });

  // The switch goes back off, which is the state every later spec reads.
  await setSecondApprover(page, false);
});
