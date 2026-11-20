import type { Locator, Page } from "@playwright/test";

import { openDbHandle } from "../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";
import { API_BASE_URL, FIXED_INTERNAL_TOKEN } from "../../portal/e2e/support/harness-config.js";

import { createTestAdmin, TEST_PASSWORD, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, freshTotpCode, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// Other specs add Site administrators to the same database, so every promotion here is held:
// the viewer and the approver are two of them, and the count only ever grows.

test.describe.configure({ mode: "serial" });

const VIEWER = uniqueAdminEmail("siteviewer");
const APPROVER = uniqueAdminEmail("siteapprover");
const PROMOTEE = uniqueAdminEmail("sitepromotee");
const UNCLAIMED = uniqueAdminEmail("siteunclaimed");
const WORKSPACE_ADMIN = uniqueAdminEmail("sitewsadmin");
const NOBODY = uniqueAdminEmail("sitenobody");
const WORKSPACE_NAME = `Site config ${Date.now().toString()}`;

let viewerSecret = "";
let approverSecret = "";
let workspaceAdminSecret = "";

async function query<T>(sql: string, values: unknown[]): Promise<T[]> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    return (await handle.query(sql, values)).rows as T[];
  } finally {
    await handle.close();
  }
}

async function userIdOf(email: string): Promise<string> {
  const [row] = await query<{ id: string }>(`select id from "user" where email = $1`, [email]);
  if (row === undefined) throw new Error(`no account for ${email}`);
  return row.id;
}

async function workspaceIdOf(name: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `select id from control."organization" where name = $1`,
    [name],
  );
  if (row === undefined) throw new Error(`no workspace named ${name}`);
  return row.id;
}

function main(page: Page): Locator {
  return page.locator("main#main-content");
}

async function stepUp(dialog: Locator, password: string, secret: string): Promise<void> {
  await dialog.getByLabel(/^Password/u).fill(password);
  await dialog.getByLabel(/^Second factor code/u).fill(await freshTotpCode(secret));
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
}

test.beforeAll(async () => {
  await createTestAdmin(VIEWER, { siteAdministrator: true, name: "Site Viewer" });
  await createTestAdmin(APPROVER, { siteAdministrator: true, name: "Site Approver" });
  await createTestAdmin(PROMOTEE, { name: "Promotee Person" });
  await createTestAdmin(UNCLAIMED, { name: "Unclaimed Candidate", claimed: false });
  await createTestAdmin(WORKSPACE_ADMIN, { name: "Workspace Owner" });
});

test("a Workspace administrator never reaches the new Site configuration screens", async ({
  page,
}) => {
  test.setTimeout(300_000);
  workspaceAdminSecret = await enrollNewAdmin(page, WORKSPACE_ADMIN);
  for (const path of [
    "/site/administrators",
    "/site/approval-requests",
    "/site/audit",
    "/workspaces/new",
  ]) {
    await page.goto(path);
    await expect(page.getByTestId("qcms-denied-recovery"), path).toBeVisible();
    await expect(page.getByTestId("qcms-site-rail"), path).toHaveCount(0);
  }
});

test("a failed step-up keeps the promotion unsent, and a good one holds it for another Site administrator", async ({
  page,
}) => {
  test.setTimeout(300_000);
  viewerSecret = await enrollNewAdmin(page, VIEWER);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Site configuration" })
    .click();
  const rail = page.getByTestId("qcms-site-rail");
  await rail.getByRole("link", { name: "Site administrators" }).click();
  await expect(page).toHaveURL(/\/site\/administrators$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Site administrators" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Site administrators" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("qcms-site-administrators-table")).toContainText(VIEWER);

  await open(page, `/site/administrators?q=${encodeURIComponent(UNCLAIMED)}`);
  const unclaimed = page.getByRole("button", { name: "Promote Unclaimed Candidate" });
  await expect(unclaimed).toBeDisabled();
  await expect(page.getByTestId("qcms-promote-candidates")).toContainText(
    "Account not claimed yet",
  );

  await open(page, `/site/administrators?q=${encodeURIComponent(PROMOTEE)}`);
  await page.getByRole("button", { name: "Promote Promotee Person" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm to promote Promotee Person" });
  await expect(dialog).toContainText("Needs another Site administrator's approval.");
  const confirm = dialog.getByRole("button", { name: "Promote Promotee Person" });
  await expect(confirm).toBeDisabled();

  const promoteeId = await userIdOf(PROMOTEE);
  const pending = () =>
    query(`select 1 from approval_requests where target = $1 and status = 'pending'`, [promoteeId]);

  await stepUp(dialog, `${TEST_PASSWORD}-wrong`, viewerSecret);
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText("That password and code did not confirm you.");
  await expect(dialog.getByLabel(/^Password/u)).toHaveValue("");
  expect(await pending()).toHaveLength(0);

  await stepUp(dialog, TEST_PASSWORD, viewerSecret);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(
      "Request sent. Waiting for another Site administrator. The request lasts 7 days.",
    ),
  ).toBeVisible();
  expect(await pending()).toHaveLength(1);
  const [role] = await query<{ role: string | null }>(`select role from "user" where id = $1`, [
    promoteeId,
  ]);
  expect(role?.role).toBeNull();
});

test("the requester sees no Approve on their own request, and the route still refuses it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, VIEWER, viewerSecret);
  await open(page, "/site/approval-requests");
  const promoteeId = await userIdOf(PROMOTEE);
  const [held] = await query<{ requestId: string }>(
    `select request_id as "requestId" from approval_requests where target = $1 and status = 'pending'`,
    [promoteeId],
  );
  const card = page.locator(`[data-request="${held?.requestId ?? ""}"]`);
  await expect(card).toContainText(
    "Site Viewer asked to make Promotee Person a Site administrator.",
  );
  await expect(card).toContainText(
    "You made this request, so another Site administrator must approve it.",
  );
  await expect(card.getByRole("button", { name: /^Approve/u })).toHaveCount(0);

  const [session] = await query<{ token: string }>(
    `select token from "session" where "userId" = $1 order by "createdAt" desc limit 1`,
    [await userIdOf(VIEWER)],
  );
  const response = await fetch(
    `${API_BASE_URL}/admin/approval-requests/${encodeURIComponent(held?.requestId ?? "")}/approve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": FIXED_INTERNAL_TOKEN,
        "x-qcms-admin-session": session?.token ?? "",
      },
      body: "{}",
    },
  );
  expect(response.status).toBe(409);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("OWN_REQUEST");
  const [still] = await query<{ status: string }>(
    `select status from approval_requests where request_id = $1`,
    [held?.requestId],
  );
  expect(still?.status).toBe("pending");
});

test("another Site administrator approves it with a step-up, and the Site audit records both", async ({
  page,
}) => {
  test.setTimeout(300_000);
  approverSecret = await enrollNewAdmin(page, APPROVER);
  await open(page, "/site/approval-requests");
  const promoteeId = await userIdOf(PROMOTEE);
  const [held] = await query<{ requestId: string }>(
    `select request_id as "requestId" from approval_requests where target = $1 and status = 'pending'`,
    [promoteeId],
  );
  const card = page.locator(`[data-request="${held?.requestId ?? ""}"]`);
  await card.getByRole("button", { name: /^Approve/u }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm to approve this request" });
  await stepUp(dialog, TEST_PASSWORD, approverSecret);
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main(page).getByText("The request was approved and applied.")).toBeVisible();
  const [role] = await query<{ role: string | null }>(`select role from "user" where id = $1`, [
    promoteeId,
  ]);
  expect(role?.role).toBe("admin");

  await open(page, "/site/approval-requests?status=approved");
  await expect(page.locator(`[data-request="${held?.requestId ?? ""}"]`)).toContainText(
    "Approved by Site Approver.",
  );

  await open(page, "/site/audit?kind=approval");
  const audit = page.getByTestId("qcms-site-audit-table");
  await expect(
    audit.getByRole("row", { name: /Request made: make a Site administrator/u }).first(),
  ).toBeVisible();
  await expect(
    audit.getByRole("row", { name: /Request approved: make a Site administrator/u }).first(),
  ).toBeVisible();
});

test("a row the sweep wrote names the system, never an account", async ({ page }) => {
  await signInWithTotp(page, VIEWER, viewerSecret);
  const [row] = await query<{ id: string }>(
    `insert into control.site_audit (actor, subject, kind, detail)
       values ('system', 'apr_e2e_expired', 'approval', $1) returning id::text`,
    [
      `act=expire kind=demote target=${await userIdOf(APPROVER)} requester=${await userIdOf(VIEWER)}`,
    ],
  );
  await open(page, "/site/audit?kind=approval");
  const line = page.locator(`[data-audit-row="${row?.id ?? ""}"]`);
  await expect(line).toContainText("Request expired: demote a Site administrator");
  await expect(line.locator("[data-system-actor]")).toHaveText("System");
  await expect(line).not.toContainText("account removed");
});

test("New workspace names its refusals, then opens with the four starter groups", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, VIEWER, viewerSecret);
  await open(page, "/site/administrators");
  await page.getByTestId("qcms-site-rail").getByRole("link", { name: "New workspace" }).click();
  await expect(page).toHaveURL(/\/workspaces\/new$/u);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "New workspace" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Site configuration" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByTestId("qcms-site-rail").getByRole("link", { name: "New workspace" }),
  ).toHaveText("New");

  const name = page.getByRole("textbox", { name: /^Workspace name/u });
  const first = page.getByRole("textbox", { name: /^First Workspace administrator/u });
  await expect(first).toHaveValue(VIEWER);
  const create = page.getByRole("button", { name: "Create workspace" });

  await name.fill(WORKSPACE_NAME);
  await first.fill(NOBODY);
  await create.click();
  await expect(main(page).getByRole("alert")).toHaveText("No account has that address.");

  await first.fill(UNCLAIMED);
  await create.click();
  await expect(main(page).getByRole("alert")).toHaveText(
    "That account is disabled or not yet claimed.",
  );
  expect(
    await query(`select 1 from control."organization" where name = $1`, [WORKSPACE_NAME]),
  ).toEqual([]);

  await first.fill(WORKSPACE_ADMIN);
  await create.click();
  const created = page.getByTestId("qcms-workspace-created");
  await expect(created).toContainText(`Workspace ${WORKSPACE_NAME} created.`);
  const groups = created.getByTestId("qcms-starter-groups");
  for (const group of ["Authors", "Publishers", "Response viewers", "Response erasers"]) {
    await expect(groups.getByRole("row", { name: new RegExp(`^${group}`, "u") })).toBeVisible();
  }
  await expect(created.getByTestId("qcms-workspace-checklist").getByRole("link")).toHaveCount(3);
});

test("a Workspace administrator's switch-off is held for an approver", async ({ page }) => {
  test.setTimeout(300_000);
  const workspaceId = await workspaceIdOf(WORKSPACE_NAME);
  await query(`update control."organization" set "requireSecondApprover" = true where id = $1`, [
    workspaceId,
  ]);
  await signInWithTotp(page, WORKSPACE_ADMIN, workspaceAdminSecret);
  await open(page, `/workspaces/${workspaceId}/settings`);
  await page.getByText("Second approval in production", { exact: true }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("waiting for an Approver", { exact: false })).toBeVisible();
});

test("a pending workspace request shows in its workspace's Requests row and under Approval requests", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workspaceId = await workspaceIdOf(WORKSPACE_NAME);
  await signInWithTotp(page, VIEWER, viewerSecret);
  await open(page, `/workspaces/${workspaceId}/audit`);
  await expect(page.getByTestId("qcms-workspace-requests")).toContainText(
    "asked to turn Second approval off.",
  );

  await open(page, "/site/approval-requests?scope=workspace");
  const card = page
    .getByTestId("qcms-approval-requests")
    .getByRole("listitem")
    .filter({ hasText: `asked to turn Second approval off in ${WORKSPACE_NAME}.` });
  await expect(card).toContainText(`Workspace: ${WORKSPACE_NAME}`);
  await card.getByRole("button", { name: /^Approve/u }).click();
  await expect(main(page).getByText("The request was approved and applied.")).toBeVisible();
  const [setting] = await query<{ on: boolean }>(
    `select "requireSecondApprover" as on from control."organization" where id = $1`,
    [workspaceId],
  );
  expect(setting?.on).toBe(false);
});
