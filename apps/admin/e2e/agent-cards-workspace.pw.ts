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
import { waitForHydration } from "./support/hydration.js";

// Use an existing second account: the two-person rule can refuse a responses self-grant.
// The fake may fall back to the first visible member when facts reach their row limit.
// Confirm the inverse switch value twice to restore shared workspace policy.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083workspace");

const SUBJECT = uniqueAdminEmail("agentcards083subject");

const WORKSPACE_ID = "org_default_workspace";

const RUN = Date.now().toString(36);

// Group names are unique within the workspace; each block needs its own label.
const ALONE = `${RUN}a`;
const PLANNED = `${RUN}p`;
const CANCELLED = `${RUN}c`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  await createTestAdmin(SUBJECT);
});

function naming(label: string): string {
  return `#qcms-fake-new:${label} #qcms-fake-who:${SUBJECT}`;
}

function groups(page: Page): Locator {
  return page.getByRole("region", { name: "Access groups" });
}

function members(page: Page): Locator {
  return page.getByRole("table", { name: /members/iu });
}

async function grantedHolder(page: Page, label: string): Promise<string> {
  const address = groupRow(page, label).locator("ul li span").first();
  await expect(address, "the grant should have left one holder on the group").toContainText("@");
  return ((await address.textContent()) ?? "").trim();
}

// Scope to this group: new accounts also hold standing workspace groups independently of these grants.
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
  await expect(groupRow(page, ALONE)).toContainText("@admin.test", { timeout: 30_000 });

  const holder = await grantedHolder(page, ALONE);
  await propose(page, "propose-member-role", `make that account an owner ${naming(ALONE)}`);
  const toOwner = ((await card(page).textContent()) ?? "").includes("to forms.owner");
  await confirm(page, /^Done\./u);
  await expect(members(page).getByRole("row").filter({ hasText: holder })).toContainText(
    toOwner ? "Workspace owner" : "Member (grants nothing on its own)",
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

  await openWorkspace(page);
  await expect(twoPerson(page)).toBeChecked();

  await propose(page, "propose-workspace-settings", `turn it off again ${naming(ALONE)}`);
  await confirm(page, /^Done\./u);
  await openWorkspace(page);
  await expect(twoPerson(page)).not.toBeChecked();

  expect(auditDelta(before, await auditTally())).toEqual({
    "member.role": 1,
    "workspace.settings": 2,
  });
});
