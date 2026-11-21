import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { API_BASE_URL, FIXED_INTERNAL_TOKEN } from "../../portal/e2e/support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { chooseOption, openRail } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import {
  createWorkspace,
  grantInWorkspace,
  sessionTokenOf,
  type SeededWorkspace,
} from "./support/workspaces.js";

// Named `workspace-*` so it runs after every spec that reads the installation's workspace
// count: this one adds a workspace, and no earlier spec should meet it (issue #1387).

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

const ADMIN = uniqueAdminEmail("auditadmin");
const SECOND = uniqueAdminEmail("auditsecond");
const HOLDER = uniqueAdminEmail("auditholder");
const OTHER_HOLDER = uniqueAdminEmail("auditother");
const NON_ADMIN = uniqueAdminEmail("auditnonadmin");

const GROUP = `Audit readers ${RUN}`;

let workspace: SeededWorkspace;
let adminSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(ADMIN, { name: "Audit Admin", grants: [], owner: false });
  await createTestAdmin(SECOND, { name: "Audit Second", grants: [], owner: false });
  await createTestAdmin(HOLDER, { name: "Audit Holder", grants: [], owner: false });
  await createTestAdmin(OTHER_HOLDER, { name: "Audit Other", grants: [], owner: false });
  await createTestAdmin(NON_ADMIN, { name: "Audit Reader", grants: [], owner: false });

  workspace = await createWorkspace(`Audit ${RUN}`, `audit-${RUN}`, ADMIN);
  for (const email of [ADMIN, SECOND]) {
    await grantInWorkspace(email, workspace.workspaceId, {
      grants: ["forms.viewer"],
      owner: true,
    });
  }
  await grantInWorkspace(NON_ADMIN, workspace.workspaceId, {
    grants: ["forms.viewer"],
    owner: false,
  });
});

function auditTable(page: Page): Locator {
  return page.getByRole("table", { name: /access audit/iu });
}

function auditRows(page: Page): Locator {
  return auditTable(page).getByRole("row");
}

function railFilters(page: Page): Locator {
  return page.getByTestId("qcms-rail-filters");
}

async function openAudit(page: Page, query = ""): Promise<void> {
  await page.goto(`/workspaces/${workspace.workspaceId}/audit${query}`);
  await waitForHydration(page);
}

// React Aria hides the checkbox input, so each tick is a click on its label.
async function tick(scope: Locator, label: string): Promise<void> {
  await scope.getByText(label, { exact: true }).click();
  await expect(scope.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
}

async function grantGroupTo(page: Page, email: string): Promise<void> {
  await page.goto(`/workspaces/${workspace.workspaceId}/members?grant=1`);
  await waitForHydration(page);
  const grant = page.getByTestId("qcms-grant-form");
  await grant.getByRole("textbox", { name: "Email address" }).fill(email);
  await chooseOption(grant, "Access group", `${GROUP} - View responses, in test`);
  await grant.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(page.getByText(`${email} is now in ${GROUP}.`)).toBeVisible();
}

async function applyFilters(page: Page): Promise<void> {
  await railFilters(page).getByRole("button", { name: "Apply" }).click();
  await waitForHydration(page);
}

test("the membership changes two administrators make write their own audit rows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  adminSecret = await enrollNewAdmin(page, ADMIN);

  await page.goto(`/workspaces/${workspace.workspaceId}/access-groups?new=1`);
  await waitForHydration(page);
  const create = page.getByTestId("qcms-access-group-create");
  await create.getByRole("textbox", { name: "Name", exact: true }).fill(GROUP);
  await tick(create, "View responses");
  await tick(create, "test");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText(`The access group ${GROUP} was created`)).toBeVisible();

  await grantGroupTo(page, HOLDER);

  await enrollNewAdmin(page, SECOND);
  await grantGroupTo(page, OTHER_HOLDER);

  await signInWithTotp(page, ADMIN, adminSecret);
  await openAudit(page);
  await expect(
    auditRows(page).filter({ hasText: ADMIN }).filter({ hasText: "Changed an access group" }),
  ).toHaveCount(1);
  await expect(
    auditRows(page).filter({ hasText: ADMIN }).filter({ hasText: "Granted" }),
  ).toHaveCount(1);
  await expect(
    auditRows(page).filter({ hasText: SECOND }).filter({ hasText: "Granted" }),
  ).toHaveCount(1);
});

test("the act filter narrows to one stored kind, and names an act with no rows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, ADMIN, adminSecret);
  await openAudit(page);
  await openRail(page);

  await chooseOption(railFilters(page), "Act", "Granted");
  await applyFilters(page);

  // The filter is the API's own vocabulary, so the address carries the stored kind.
  await expect(page).toHaveURL(/[?&]kind=grant\b/u);
  await expect(auditTable(page)).toContainText(ADMIN);
  await expect(auditTable(page)).toContainText(SECOND);
  await expect(auditTable(page)).not.toContainText("Changed an access group");

  await chooseOption(railFilters(page), "Act", "Exported responses");
  await applyFilters(page);
  await expect(page).toHaveURL(/[?&]kind=export\b/u);
  await expect(auditTable(page)).toHaveCount(0);
  await expect(
    page.getByText("No row in this workspace's audit matches these filters."),
  ).toBeVisible();
});

test("the person filter narrows to one account's acts", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, ADMIN, adminSecret);
  await openAudit(page, "?kind=grant");
  await openRail(page);

  await chooseOption(railFilters(page), "Person", ADMIN);
  await applyFilters(page);

  await expect(page).toHaveURL(/[?&]actor=/u);
  await expect(auditTable(page)).toContainText(ADMIN);
  await expect(auditTable(page)).not.toContainText(SECOND);
  await expect(page.getByTestId("qcms-rail-filters-title")).toContainText("2 active");
});

test("a non-administrator is shown the denied recovery, and the route refuses them too", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, NON_ADMIN);
  await openAudit(page);
  await expect(page.getByTestId("qcms-denied-recovery")).toBeVisible();
  await expect(auditTable(page)).toHaveCount(0);

  const response = await fetch(
    `${API_BASE_URL}/admin/workspaces/${encodeURIComponent(workspace.workspaceId)}/audit`,
    {
      headers: {
        "x-qcms-internal-token": FIXED_INTERNAL_TOKEN,
        "x-qcms-admin-session": await sessionTokenOf(NON_ADMIN),
        "x-qcms-environment": "prod",
      },
    },
  );
  expect(response.status).toBe(403);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("FORBIDDEN");
});
