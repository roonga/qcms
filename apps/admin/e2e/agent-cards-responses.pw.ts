import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

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
  irreversibleBand,
  openPanel,
  propose,
  typeConfirmation,
} from "./support/agent-card.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { openDeliverer, openResponses, submitResponse } from "./support/ops.js";

// Erasure is irreversible and unflagging consumes a disposition; use a fresh session per path.
// Export hand-off holds Running while its dialog remains open, giving axe a stable measurement.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083responses");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

let totpSecret = "";

let flaggedAlone = "";
let flaggedInPlan = "";
let erasableAlone = "";
let keptOnCancel = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  const deliverer = openDeliverer();
  try {
    const honeypotField = deliverer.honeypotField;
    const answers = [
      [ACCIDENT, true],
      [COUNT, 2],
    ] as const;
    flaggedAlone = await submitResponse(SLUG, answers, { honeypotField });
    flaggedInPlan = await submitResponse(SLUG, answers, { honeypotField });
    erasableAlone = await submitResponse(SLUG, answers);
    keptOnCancel = await submitResponse(SLUG, answers);
  } finally {
    await deliverer.close();
  }
});

function detail(sessionId: string): string {
  return `/operations/forms/${FORM_ID}/responses/${sessionId}`;
}

// The dialog can hold focus itself; descendant-only :focus matching misses that state.
async function focusIsInDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active !== null && active.closest('[role="dialog"]') !== null;
  });
}

test("confirms a release and then an erasure, each changing the screen it was proposed on", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.goto(detail(flaggedAlone));
  await waitForHydration(page);
  await openPanel(page);
  await expect(page.getByRole("button", { name: "Release the withheld event" })).toBeVisible();

  const before = await auditTally();
  await propose(page, "propose-response-unflag", "release the event this one withheld");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");
  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);

  await expect(page.getByRole("button", { name: "Release the withheld event" })).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.goto(detail(erasableAlone));
  await waitForHydration(page);
  await openPanel(page);
  await propose(page, "propose-response-erase", "erase this respondent's data");

  await expect(irreversibleBand(page)).toContainText("This cannot be undone");
  await expectAxeClean(page, "proposed erasure");
  await typeConfirmation(page, erasableAlone);

  await confirm(page, /^Done\./u);
  await expectAxeClean(page, "done");
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qcms-tombstone")).toContainText(erasableAlone);

  expect(auditDelta(before, await auditTally())).toEqual({
    "response.unflag": 1,
    "response.erase": 1,
  });
});

test("erases nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(detail(keptOnCancel));
  await waitForHydration(page);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-response-erase", "erase this respondent's data");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(page.getByTestId("qcms-tombstone")).toHaveCount(0);

  await expect(page.getByTestId("qcms-locked-answers")).toBeVisible();
});

test("confirms a release and an erasure inside one plan", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(detail(flaggedInPlan));
  await waitForHydration(page);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "plan-responses", "release it and then erase it");
  await expectWaitingStepStates(page, "Proposed");

  await expect(irreversibleBand(page)).toHaveCount(1);
  await typeConfirmation(page, flaggedInPlan);

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });

  expect(auditDelta(before, await auditTally())).toEqual({
    "response.unflag": 1,
    "response.erase": 1,
  });
});

test("hands the export off to the screen's own dialog, with the card's filters filled", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openResponses(page, FORM_ID);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-response-export", "export these as a long csv");
  await expect(card(page)).toContainText("This step finishes on the screen itself");
  await expectAxeClean(page, "proposed hand-off");

  await confirmButton(page).click();

  await expect(cardChip(page)).toHaveText("Running 1 of 1");
  const dialog = page.getByTestId("qcms-export-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "CSV Format" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Long (default) CSV shape" })).toBeVisible();

  await expect.poll(() => focusIsInDialog(page)).toBe(true);
  await expectAxeClean(page, "running hand-off");

  expect(auditDelta(before, await auditTally())).toEqual({});
});

test("confirms a mint and then hands the export off, as the last step of a plan", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openResponses(page, FORM_ID);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "plan-export-last", "mint a link and then export these");
  await confirmButton(page).click();

  await expect(page.getByTestId("qcms-export-dialog")).toBeVisible({ timeout: 60_000 });
  await expect(cardChip(page)).toHaveText("Running 2 of 2");
  await expectStepChips(page, ["Done", "Running"]);
  await expectAxeClean(page, "running plan");

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1 });
});
