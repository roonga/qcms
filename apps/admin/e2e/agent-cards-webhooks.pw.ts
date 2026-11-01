import type { Locator, Page } from "@playwright/test";

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
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * Criterion 11 on a form's delivery endpoints, as far as this round carries it:
 * `webhook.create` and `webhook.rotate` confirmed alone, a cancel that configures
 * nothing, and the once-only secret both reveal on the card and nowhere else.
 *
 * The rotate is what proves the screen's facts: it names the endpoint the screen listed,
 * so a turn that could not see one would rotate nothing. The endpoints a form has are the
 * environment's own data, and this context read them from the control plane until the
 * card matrix asked for one by id.
 *
 * ## Why the form has no responses
 *
 * An endpoint on a form that collects responses fans every submission out to it, so a
 * target nothing answers would leave failing deliveries and dead letters in a queue the
 * operations suite counts. This form is created here and never published, so nothing is
 * delivered and the endpoint is configuration alone.
 *
 * ## What is not here
 *
 * `webhook.retarget`, `webhook.deactivate`, `webhook.reactivate`, `webhook.redeliver` and
 * the Pending approval state, each with the reason, in `HANDOFF.md`.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083webhooks");

const RUN = Date.now().toString(36);

const ENDPOINT_URL = "https://hooks.example.test/qcms?channel=ops";

const REVEALED = "Shown once, here only:";

let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function endpoints(page: Page): Locator {
  return page.getByTestId("qcms-webhooks-table");
}

async function openWebhooks(page: Page, form: string): Promise<void> {
  await page.goto(`/forms/${form}/webhooks`);
  await expect(page.getByTestId("qcms-webhook-config")).toBeVisible();
  await waitForHydration(page);
  await openPanel(page);
}

test("confirms an endpoint and then a rotation, each revealing its secret once", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = await createForm(page, `agent-hooks-${RUN}`, "Agent webhooks");
  await openWebhooks(page, formId);

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

test("configures nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWebhooks(page, formId);

  const before = await auditTally();
  const rows = await endpoints(page).locator("tbody tr").count();
  await propose(page, "propose-webhook-create", "add a second delivery endpoint");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(endpoints(page).locator("tbody tr")).toHaveCount(rows);
  await expect(card(page).locator(".qcms-acard__reveal")).toHaveCount(0);
});
