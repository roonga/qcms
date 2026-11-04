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
  openPanel,
  propose,
} from "./support/agent-card.js";
import { pinProposalClock, runOutProposalWindow } from "./support/agent.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// Close and reopen the shared seed in one test so later specs retain an open intake.
// This relies on workers: 1 and fullyParallel: false.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083forms");

const FORM_ID = "frm_auto_quote";

const INTAKE = `/operations/forms/${FORM_ID}/intake`;

const WORKSPACE_ID = "org_default_workspace";

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("confirms a close and a reopen on the Intake screen, changing the screen and recording each act", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.goto(INTAKE);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-close", "close intake in this environment");

  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");
  await expect(page.getByRole("button", { name: /^Reopen in/u })).toBeVisible();

  await propose(page, "propose-form-reopen", "reopen it");
  await confirm(page, /^Done\./u);
  await expect(page.getByRole("button", { name: /^Close in/u })).toBeVisible();

  expect(auditDelta(before, await auditTally())).toEqual({ "form.close": 1, "form.reopen": 1 });
});

test("sends nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(INTAKE);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-close", "close intake in this environment");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});

  await expect(page.getByRole("button", { name: /^Close in/u })).toBeVisible();
});

test("lists each confirmed act in the workspace's assistant audit", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);

  const table = page.getByRole("table", { name: /assistant/iu });
  await expect(table).toContainText("form.close");
  await expect(table).toContainText("form.reopen");

  await expect(table).toContainText(EMAIL);
});

const READ_LABELS: readonly { readonly path: string; readonly labels: readonly string[] }[] = [
  {
    path: `/forms/${FORM_ID}`,
    labels: [
      "Searching the question library",
      "Drafting questions",
      "Drafting the form",
      "Checking the draft",
    ],
  },
  { path: `/operations/forms/${FORM_ID}/links`, labels: ["Counting the links"] },
  {
    path: `/operations/forms/${FORM_ID}/responses`,
    labels: ["Listing the responses", "Counting the responses"],
  },
  { path: `/operations/forms/${FORM_ID}/webhooks`, labels: ["Checking the deliveries"] },
  { path: `/forms/${FORM_ID}/versions`, labels: ["Comparing two versions"] },
  { path: "/forms", labels: ["Searching the forms"] },
  { path: "/webhooks", labels: ["Counting the dead letters"] },
  { path: "/questions", labels: ["Searching the question library"] },
];

test("names every read tool it called in the timeline", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const screen of READ_LABELS) {
    await page.goto(screen.path);
    await openPanel(page);
    await fillStable(
      page.getByTestId("qcms-assistant-composer"),
      "#qcms-fake:read-all read everything you can see here",
    );
    await page.getByTestId("qcms-assistant-send").locator("button").click();
    const turns = page.getByTestId("qcms-assistant-turns");
    await expect(turns).toContainText("I have read everything this screen offers.", {
      timeout: 120_000,
    });
    for (const label of screen.labels) {
      await expect(turns, `${screen.path} did not name ${label}`).toContainText(label);
    }
    await expect(turns).not.toContainText("Working on your request");
  }
});

test("ticks a waiting card into Expired once its window runs out", async ({ page }) => {
  test.setTimeout(300_000);
  await pinProposalClock(page);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(INTAKE);
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-form-close", "close intake in this environment");
  await runOutProposalWindow(page);

  await expect(cardChip(page)).toHaveText("Expired");
  await expect(card(page)).toContainText("Expired - ask again");
  await expect(confirmButton(page)).toBeDisabled();
  await expectAxeClean(page, "expired");
  expect(auditDelta(before, await auditTally())).toEqual({});
});
