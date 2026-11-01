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

/**
 * Criterion 11 on the links screen: `link.mint` and `link.revoke` confirmed alone and
 * inside one plan, a cancel that mints nothing, and the states a partly run plan reaches.
 *
 * ## Why this group works on forms it creates
 *
 * The seeded insurance form carries five fixture links in four states, and which of them
 * sorts first is not this spec's to decide: a revoke aimed at "the first link" would
 * revoke whichever row the list happened to return, and a plan meant to fail at its
 * revoke would succeed the day that order changed. Each form here starts with no links,
 * so every state on screen is one of this spec's own acts.
 *
 * The second form exists only to be empty: `plan-fails-at-2` names the link the screen
 * listed, and on a form with none it names an absent id, which is a 404 from the links
 * route itself rather than a simulated failure. That is how the Failed and Not run states
 * are reached through the product's own refusal.
 */

/**
 * Every test starts in `test`, because a link acts in the switcher's environment and a
 * serial test gets a fresh context: without this the first test would work in the
 * environment `createForm` moved it to and the next would silently be in production.
 */
test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083links");

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

/** Set by the first test; the rest sign in again, since serial shares no browser context. */
let totpSecret = "";

/** The form this spec mints on, and the empty one the failing plan runs against. */
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

  // The facts the next turn reads are the API's own, so the link just minted is already
  // the one a revoke names: no reload stands between the two turns.
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

  // Only the step that committed left a row, and the step after the failure never ran.
  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1 });
  await expect(linkRows(page)).toHaveCount(1, { timeout: 30_000 });
});
