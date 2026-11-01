import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  confirm,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * Criterion 11 on the workspace administration screen: all six D8 kinds confirmed alone
 * and inside a plan, a cancel that creates no group, and the panels reading back what
 * each act changed.
 *
 * ## The second account is this spec's own, and the directive names it
 *
 * A grant is to an account that exists, and ADR-41 refuses a responses self-grant while
 * the second-approver switch is on. So this spec creates an account of its own and names
 * it to the fake with `#qcms-fake-who:`, rather than the scripts carrying a canned
 * address no installation has.
 *
 * ## The switch is flipped and put back
 *
 * `requireSecondApprover` governs the two-person rule for every later spec in the run, so
 * the settings kind is proposed as the value the switch does not hold: confirming it
 * twice flips it and restores it, and the second flip is the restore rather than a
 * second assertion.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083workspace");

/** The account the grants name: it exists, and it is not the one confirming. */
const SUBJECT = uniqueAdminEmail("agentcards083subject");

/** The workspace a bootstrapped installation is seeded with (ADR-41, task 068). */
const WORKSPACE_ID = "org_default_workspace";

const RUN = Date.now().toString(36);

/** One label per block, because a group name is unique within its workspace. */
const ALONE = `${RUN}a`;
const PLANNED = `${RUN}p`;
const CANCELLED = `${RUN}c`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  await createTestAdmin(SUBJECT);
});

/** The directive tail every turn here carries: the group's label and the account. */
function naming(label: string): string {
  return `#qcms-fake-new:${label} #qcms-fake-who:${SUBJECT}`;
}

function groups(page: Page): Locator {
  return page.getByRole("region", { name: "Access groups" });
}

function members(page: Page): Locator {
  return page.getByRole("table", { name: /members/iu });
}

/**
 * One group's own row. Scoped rather than asserted against the whole panel, because a new
 * account is seeded into the workspace's standing groups and would be listed as a holder
 * of those whatever this spec granted or revoked.
 */
function groupRow(page: Page, label: string): Locator {
  return groups(page)
    .getByRole("listitem")
    .filter({ hasText: `test.responses.viewer.${label}` })
    .first();
}

function twoPerson(page: Page): Locator {
  return page.getByRole("checkbox", { name: "Require a second approver for production" });
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);
  await openPanel(page);
}

test("confirms all six kinds one card at a time, each read back by its own panel", async ({
  page,
}) => {
  test.setTimeout(900_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await openWorkspace(page);

  const before = await auditTally();
  await propose(page, "propose-access-group-create", `add a viewer group ${naming(ALONE)}`);
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");
  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");
  await expect(groupRow(page, ALONE)).toContainText("Nobody", { timeout: 30_000 });

  await propose(page, "propose-access-grant", `give it to that account ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await expect(groupRow(page, ALONE)).toContainText(SUBJECT, { timeout: 30_000 });

  await propose(page, "propose-member-role", `make that account an owner ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await expect(members(page).getByRole("row").filter({ hasText: SUBJECT })).toContainText(
    "Workspace owner",
    { timeout: 30_000 },
  );

  await propose(page, "propose-access-revoke", `take the group back again ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await expect(groupRow(page, ALONE)).toContainText("Nobody", { timeout: 30_000 });

  await propose(page, "propose-access-group-remove", `remove that group ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await expect(groups(page)).not.toContainText(`test.responses.viewer.${ALONE}`, {
    timeout: 30_000,
  });

  expect(auditDelta(before, await auditTally())).toEqual({
    "access.groupCreate": 1,
    "access.grant": 1,
    "member.role": 1,
    "access.revoke": 1,
    "access.groupRemove": 1,
  });
});

test("creates no group when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWorkspace(page);

  const before = await auditTally();
  await propose(page, "propose-access-group-create", `add a viewer group ${naming(CANCELLED)}`);
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(groups(page)).not.toContainText(`test.responses.viewer.${CANCELLED}`);
});

test("confirms a group's whole life inside one plan, each step naming what the first made", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWorkspace(page);

  const before = await auditTally();
  await propose(page, "plan-workspace", `set a group up and take it down ${naming(PLANNED)}`);
  await expectWaitingStepStates(page, "Proposed");
  // Three of the four steps name the group step 1 records rather than an id of their own.
  await expect(page.locator(".qcms-acard")).toContainText("step 1's teamId");

  await confirm(page, /^Done\. All 4 steps ran/u);
  await expectStepChips(page, ["Done", "Done", "Done", "Done"]);
  await expectAxeClean(page, "done plan");
  await expect(groups(page)).not.toContainText(`test.responses.viewer.${PLANNED}`, {
    timeout: 30_000,
  });

  expect(auditDelta(before, await auditTally())).toEqual({
    "access.groupCreate": 1,
    "access.grant": 1,
    "access.revoke": 1,
    "access.groupRemove": 1,
  });
});

test("confirms a role change and the second-approver switch inside one plan, then puts the switch back", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openWorkspace(page);

  await expect(twoPerson(page)).not.toBeChecked();

  const before = await auditTally();
  await propose(page, "plan-workspace-settings", `re-role them and turn it on ${naming(ALONE)}`);
  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  // Read on a fresh visit: the settings panel seeds its switches once and then carries the
  // operator's own unsaved choice, so a change made anywhere else is on screen at the next
  // read rather than under their hand.
  await openWorkspace(page);
  await expect(twoPerson(page)).toBeChecked();

  // The restore, which is also this kind's own alone path: the script proposes the value
  // the switch does not hold, so one more card puts the workspace back as it was.
  await propose(page, "propose-workspace-settings", `turn it off again ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await openWorkspace(page);
  await expect(twoPerson(page)).not.toBeChecked();

  expect(auditDelta(before, await auditTally())).toEqual({
    "member.role": 1,
    "workspace.settings": 2,
  });
});
