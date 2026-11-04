import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  cardChip,
  confirm,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";

// Use forms with no links so ordering cannot select another spec's link.
// The empty second form makes the planned revoke fail through the real route with an absent id.

// Serial tests get fresh contexts; set test explicitly so link actions cannot fall back to production.
test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083links");

const RUN = Date.now().toString(36);

let totpSecret = "";

let formId = "";
let emptyFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function linkRows(page: Page): Locator {
  return page.getByTestId("qcms-links-table").locator("tbody tr");
}

test("confirms a mint and a revoke alone, changing the screen and recording each act", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = await createForm(page, `agent-links-${RUN}`, "Agent links");

  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();

  const before = await auditTally();
  await propose(page, "propose-link-mint", "mint two links for this form");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");
  await expect(linkRows(page)).toHaveCount(2, { timeout: 30_000 });

  await propose(page, "propose-link-revoke", "revoke one of them again");
  await confirm(page, /^Done\./u);
  await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible({
    timeout: 30_000,
  });

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1, "link.revoke": 1 });
});

test("mints nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);

  const before = await auditTally();
  const rows = await linkRows(page).count();
  await propose(page, "propose-link-mint", "mint two links for this form");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(linkRows(page)).toHaveCount(rows);
});

test("confirms both kinds inside one plan", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);

  const before = await auditTally();
  const rows = await linkRows(page).count();
  await propose(page, "plan-links", "mint two more and revoke the one still working");
  await expectWaitingStepStates(page, "Proposed");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");
  await expect(linkRows(page)).toHaveCount(rows + 2, { timeout: 30_000 });

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1, "link.revoke": 1 });
});

test("stops at the step that failed and runs nothing after it", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  emptyFormId = await createForm(page, `agent-links-empty-${RUN}`, "Agent links empty");

  await page.goto(`/operations/forms/${emptyFormId}/links`);
  await openPanel(page);
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();

  const before = await auditTally();
  await propose(page, "plan-fails-at-2", "mint one, revoke a link, then mint three");
  await confirm(page, /^Stopped at step 2\./u);

  await expect(cardChip(page)).toHaveText("Stopped at step 2");
  await expectStepChips(page, ["Done", "Failed", "Not run"]);
  await expectAxeClean(page, "failed plan");

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1 });
  await expect(linkRows(page)).toHaveCount(1, { timeout: 30_000 });
});
