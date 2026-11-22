import type { Locator, Page } from "@playwright/test";

import { openDbHandle } from "../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp, warmSignIn } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import {
  archiveWorkspaceDirectly,
  auditDetails,
  createWorkspace,
  type SeededWorkspace,
} from "./support/workspaces.js";

// Named `workspace-*` so it sorts after every spec that reads the installation's workspace
// count. The shared library is one mark across the whole installation, so the holder found
// before the first test is put back after the last.

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

const SITE_ADMIN = uniqueAdminEmail("libsite");
const WORKSPACE_ADMIN = uniqueAdminEmail("libworkspace");

let first: SeededWorkspace;
let second: SeededWorkspace;
let retiring: SeededWorkspace;

let siteSecret = "";
let originalHolder: string | null = null;

async function query<T>(sql: string, values: unknown[] = []): Promise<readonly T[]> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    return (await handle.query<T>(sql, values)).rows;
  } finally {
    await handle.close();
  }
}

async function sharedHolders(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select id from control."organization" where "isShared" order by id`,
  );
  return rows.map((row) => row.id);
}

function panel(page: Page): Locator {
  return page.getByTestId("qcms-shared-library");
}

function confirmation(page: Page): Locator {
  return page.getByTestId("qcms-shared-library-confirm");
}

async function open(page: Page): Promise<void> {
  await page.goto("/site/shared-library");
  await waitForHydration(page);
}

async function choose(page: Page, name: string): Promise<void> {
  await panel(page).getByText(name, { exact: true }).click();
  await expect(panel(page).getByRole("radio", { name, exact: true })).toBeChecked();
}

async function saveAndConfirm(page: Page): Promise<void> {
  await panel(page).getByRole("button", { name: "Save" }).click();
  await confirmation(page).getByRole("button", { name: "Save" }).click();
  await expect(panel(page).getByText("Saved.", { exact: true })).toBeVisible();
  await expect(confirmation(page)).toHaveCount(0);
}

test.beforeAll(async () => {
  await createTestAdmin(SITE_ADMIN, { siteAdministrator: true, name: "Library Site Admin" });
  await createTestAdmin(WORKSPACE_ADMIN, { name: "Library Workspace Admin" });
  first = await createWorkspace(`Library first ${RUN}`, `library-first-${RUN}`, SITE_ADMIN);
  second = await createWorkspace(`Library second ${RUN}`, `library-second-${RUN}`, SITE_ADMIN);
  retiring = await createWorkspace(
    `Library retiring ${RUN}`,
    `library-retiring-${RUN}`,
    SITE_ADMIN,
  );
  [originalHolder = null] = await sharedHolders();
});

test.afterAll(async () => {
  // Two statements: the partial unique index refuses a second marked row mid-statement.
  await query(`update control."organization" set "isShared" = false where "isShared"`);
  if (originalHolder !== null) {
    await query(`update control."organization" set "isShared" = true where id = $1`, [
      originalHolder,
    ]);
  }
});

test("the sign-in screen is served before anything types into it", async ({ page }) => {
  test.setTimeout(300_000);
  await warmSignIn(page);
});

test("an account that is not a Site administrator is turned away", async ({ page }) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, WORKSPACE_ADMIN);
  await open(page);
  await expect(page.getByTestId("qcms-denied-recovery")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-site-rail")).toHaveCount(0);
});

test("cancelling the confirmation leaves the library where it was", async ({ page }) => {
  test.setTimeout(300_000);
  siteSecret = await enrollNewAdmin(page, SITE_ADMIN);
  await open(page);
  await page
    .getByTestId("qcms-site-rail")
    .getByRole("link", { name: "Shared question library" })
    .click();
  await expect(page).toHaveURL(/\/site\/shared-library$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Shared question library" }),
  ).toBeVisible();

  const before = await sharedHolders();
  await choose(page, first.name);
  await panel(page).getByRole("button", { name: "Save" }).click();
  await expect(confirmation(page)).toContainText(
    `Everyone with Edit forms in any workspace will be able to see and pin ${first.name}'s questions.`,
  );
  await expect(confirmation(page)).toContainText(
    `Recorded in the site audit and in ${first.name}'s audit.`,
  );
  await confirmation(page).getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation(page)).toHaveCount(0);
  expect(await sharedHolders()).toEqual(before);
});

test("marking a workspace makes it the holder and records it in both audits", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, SITE_ADMIN, siteSecret);
  await open(page);
  await choose(page, first.name);
  await saveAndConfirm(page);
  expect(await sharedHolders()).toEqual([first.workspaceId]);
  expect(await auditDetails(first.workspaceId, "setting")).toContain(
    `subject=${first.workspaceId} library=marked`,
  );

  await open(page);
  await expect(panel(page).getByRole("radio", { name: first.name, exact: true })).toBeChecked();
  await expect(panel(page).getByRole("button", { name: "Save" })).toBeDisabled();

  await page.goto("/site/audit?kind=library");
  await waitForHydration(page);
  await expect(
    page
      .getByTestId("qcms-site-audit-table")
      .getByRole("row", { name: new RegExp(first.name, "u") })
      .first(),
  ).toBeVisible();
});

test("choosing another workspace hands the library on in one save", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, SITE_ADMIN, siteSecret);
  await open(page);
  await choose(page, second.name);
  await saveAndConfirm(page);
  expect(await sharedHolders()).toEqual([second.workspaceId]);
  expect(await auditDetails(first.workspaceId, "setting")).toContain(
    `subject=${first.workspaceId} library=unmarked`,
  );
  expect(await auditDetails(second.workspaceId, "setting")).toContain(
    `subject=${second.workspaceId} library=marked`,
  );
});

test("None unmarks the holder", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, SITE_ADMIN, siteSecret);
  await open(page);
  await choose(page, "None");
  await panel(page).getByRole("button", { name: "Save" }).click();
  await expect(confirmation(page)).toContainText(
    "Question lists stop showing the Shared tag. Pins in other workspaces stay.",
  );
  await expect(confirmation(page)).not.toContainText("Recorded in the site audit");
  await confirmation(page).getByRole("button", { name: "Save" }).click();
  await expect(panel(page).getByText("Saved.", { exact: true })).toBeVisible();
  expect(await sharedHolders()).toEqual([]);
  expect(await auditDetails(second.workspaceId, "setting")).toContain(
    `subject=${second.workspaceId} library=unmarked`,
  );
});

test("an archived holder is not offered, and saving another hands the library on from it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Archiving refuses the holder, so the fixture archives behind the product's back to
  // reach the state a holder archived before that refusal existed would leave.
  await query(`update control."organization" set "isShared" = true where id = $1`, [
    retiring.workspaceId,
  ]);
  await archiveWorkspaceDirectly(retiring.workspaceId);

  await signInWithTotp(page, SITE_ADMIN, siteSecret);
  await open(page);
  await expect(panel(page)).toContainText("Archived workspaces are not offered.");
  await expect(panel(page).getByRole("radio", { name: retiring.name, exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Save" })).toBeDisabled();

  await choose(page, first.name);
  await saveAndConfirm(page);
  expect(await sharedHolders()).toEqual([first.workspaceId]);
  expect(await auditDetails(retiring.workspaceId, "setting")).toContain(
    `subject=${retiring.workspaceId} library=unmarked`,
  );
});
