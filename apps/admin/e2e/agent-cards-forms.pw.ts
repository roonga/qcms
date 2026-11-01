import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditCount,
  auditedKinds,
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

/**
 * Criterion 11 on the form screen: an act proposed there is confirmed, changes the screen
 * and leaves its audit row; a cancel sends nothing; and the card's waiting states are axe
 * clean. It also covers the two reads that belong with them: the timeline's own label for
 * each read tool the turn called, and the workspace audit that lists what was confirmed.
 *
 * ## Why these claims are browser claims
 *
 * The API's suite asserts the token, the route and the audit row over HTTP, and the card's
 * fold and rendering are asserted from invented props in Vitest. Neither can see the one
 * thing this file is for: that a card proposed on a real screen, confirmed by a real press,
 * reaches that screen's own server action and that the screen then shows what changed. A
 * kind can be whole on both sides of that seam and wired to nothing.
 *
 * ## The fixture is left as it was found
 *
 * Closing the seeded form's intake is workspace state every later spec reads, so the close
 * and the reopen are one test: the pair restores what it changed, and the suite runs
 * `workers: 1` with `fullyParallel: false` so no other file is mid-run between them.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083forms");

/** The seeded insurance fixture, released to the default test environment by the seed. */
const FORM_ID = "frm_auto_quote";

/** The workspace a bootstrapped installation is seeded with, whose audit reads the rows. */
const WORKSPACE_ID = "org_default_workspace";

/** Set by the first test; the rest sign in again, since serial shares no browser context. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("confirms a close and a reopen on the form screen, changing the screen and recording each act", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.goto(`/forms/${FORM_ID}`);
  await openPanel(page);

  const before = await auditCount();
  await propose(page, "propose-form-close", "close intake in this environment");
  // While the card waits every step shares the card's state, so the heading chip says it
  // once and each step keeps its state word for assistive technology alone (issue #1131).
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");
  await expect(page.getByRole("button", { name: /^Reopen in/u })).toBeVisible();

  await propose(page, "propose-form-reopen", "reopen it");
  await confirm(page, /^Done\./u);
  await expect(page.getByRole("button", { name: /^Close in/u })).toBeVisible();

  const kinds = await auditedKinds();
  expect(kinds.length - before).toBe(2);
  expect(kinds.slice(-2)).toEqual(["form.close", "form.reopen"]);
});

test("sends nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${FORM_ID}`);
  await openPanel(page);

  const before = await auditCount();
  await propose(page, "propose-form-close", "close intake in this environment");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(await auditCount()).toBe(before);
  // The screen still offers the close it was never asked to perform.
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
  // The act is recorded as the account's own, which is what the row is for (Q12).
  await expect(table).toContainText(EMAIL);
});

/**
 * Each screen's read tools, by the label the timeline owes them. A read tool with no copy
 * of its own falls back to one sentence for all of them, which is what this asserts
 * against rather than a row count.
 */
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
  { path: `/forms/${FORM_ID}/links`, labels: ["Counting the links"] },
  {
    path: `/forms/${FORM_ID}/responses`,
    labels: ["Listing the responses", "Counting the responses"],
  },
  { path: `/forms/${FORM_ID}/webhooks`, labels: ["Checking the deliveries"] },
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
  await page.goto(`/forms/${FORM_ID}`);
  await openPanel(page);

  const before = await auditCount();
  await propose(page, "propose-form-close", "close intake in this environment");
  await runOutProposalWindow(page);

  await expect(cardChip(page)).toHaveText("Expired");
  await expect(card(page)).toContainText("Expired - ask again");
  await expect(confirmButton(page)).toBeDisabled();
  await expectAxeClean(page, "expired");
  expect(await auditCount()).toBe(before);
});
