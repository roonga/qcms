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

// Use separate configuration and delivery forms to preserve other specs' exact delivery counts.
// Keep delivery responses successful and drain after redelivery so the global dead-letter queue stays clean.
// Respondent submissions require a production release; authoring resets selection to test.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083webhooks");

const RUN = Date.now().toString(36);

const WORKSPACE_ID = "org_default_workspace";

const SEEDED_QUESTION = "q_accident_count";

const ENDPOINT_URL = "https://hooks.example.test/qcms?channel=ops";

const MOVED_URL = "https://hooks.example.test/qcms?channel=audit";

const REVEALED = "Shown once, here only:";

let totpSecret = "";

let configFormId = "";

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

// Reset the shared second-approver switch even after failure: a serial retry and later specs require it off.
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

function pendingPanel(page: Page): Locator {
  return page.getByTestId("qcms-endpoint-proposals");
}

async function openWebhooks(page: Page, form: string): Promise<void> {
  await page.goto(`/forms/${form}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
  await waitForHydration(page);
  await openPanel(page);
}

async function addEndpoint(page: Page, url: string): Promise<void> {
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByTestId("qcms-webhook-url-dialog");
  await dialog.getByRole("textbox", { name: "Endpoint URL" }).fill(url);
  await dialog.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(endpointRow(page, url)).toHaveCount(1);
}

async function buildPublishableForm(page: Page, slug: string): Promise<string> {
  const formId = await createForm(page, slug, "Agent webhooks");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);
  return formId;
}

async function setSecondApprover(page: Page, on: boolean): Promise<void> {
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);
  const control = page.getByRole("checkbox", {
    name: "Require a second approver for production",
    exact: true,
  });

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
  // The respondent mount serves production, so publishing in test alone cannot start a session.
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

  await expect(card(page)).toContainText("step 1's webhookId");
  await expectAxeClean(page, "proposed plan");

  await confirm(page, /^Done\. All 6 steps ran/u);
  await expectStepChips(page, ["Done", "Done", "Done", "Done", "Done", "Done"]);

  await expect(card(page).locator(".qcms-acard__reveal").first()).toContainText(REVEALED);
  await expectAxeClean(page, "done plan");

  await expect(endpointRow(page, MOVED_URL).locator("[data-active]")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 30_000 },
  );

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

  await page.goto(`/forms/${prodFormId}/webhooks`);
  await waitForHydration(page);
  await addEndpoint(page, ENDPOINT_URL);
  await setSecondApprover(page, true);

  const before = await auditTally();
  await openWebhooks(page, prodFormId);
  await propose(page, "plan-pending-at-1", "move the endpoint and resend what is stuck");

  await expect(card(page)).toContainText("Production: changes where respondents");
  await expectWaitingStepStates(page, "Proposed");

  await confirmButton(page).click();

  await expect(cardChip(page)).toHaveText("Pending approval", { timeout: 60_000 });
  await expectStepChips(page, ["Pending approval", "Not run"]);
  await expect(card(page)).toContainText("a different approver has to confirm it");
  await expectAxeClean(page, "pending approval");

  await expect(endpoints(page)).toContainText(ENDPOINT_URL);
  await expect(endpoints(page)).not.toContainText(MOVED_URL);
  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(pendingPanel(page)).toContainText(MOVED_URL);

  expect(auditDelta(before, await auditTally())).toEqual({ "webhook.retarget": 1 });

  await setSecondApprover(page, false);
});
