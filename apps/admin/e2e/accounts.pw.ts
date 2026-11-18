import type { Locator, Page } from "@playwright/test";

import { openDbHandle } from "../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";
import { API_BASE_URL, FIXED_INTERNAL_TOKEN } from "../../portal/e2e/support/harness-config.js";

import {
  createTestAdmin,
  rewindTotpStep,
  TEST_PASSWORD,
  uniqueAdminEmail,
} from "./support/admin-account.js";
import { enrollNewAdmin, freshTotpCode, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// The harness API has no outbound email, so every act that sends a sign-in link is refused
// here; the email sent state is proven against Mailpit by the full-stack suite.

test.describe.configure({ mode: "serial" });

const VIEWER = uniqueAdminEmail("accountsviewer");
const SECOND_SITE_ADMIN = uniqueAdminEmail("accountssecond");
const SITE_TARGET = uniqueAdminEmail("accountssitetarget");
const MEMBER = uniqueAdminEmail("accountsmember");
const UNCLAIMED = uniqueAdminEmail("accountsunclaimed");
const WORKSPACE_ADMIN = uniqueAdminEmail("accountswsadmin");
const NEVER_CREATED = uniqueAdminEmail("accountsnever");

let viewerSecret = "";

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

function main(page: Page): Locator {
  return page.locator("main#main-content");
}

async function signInAsViewer(page: Page): Promise<void> {
  await signInWithTotp(page, VIEWER, viewerSecret);
}

async function openAccount(page: Page, email: string): Promise<void> {
  await page.goto(`/site/accounts/${encodeURIComponent(await userIdOf(email))}`);
  await waitForHydration(page);
}

test.beforeAll(async () => {
  await createTestAdmin(VIEWER, { siteAdministrator: true, name: "Accounts Viewer" });
  await createTestAdmin(SECOND_SITE_ADMIN, { siteAdministrator: true, name: "Second Site Admin" });
  await createTestAdmin(SITE_TARGET, { siteAdministrator: true, name: "Site Target" });
  await createTestAdmin(MEMBER, { name: "Member Person", owner: true });
  await createTestAdmin(UNCLAIMED, { name: "Unclaimed Person", claimed: false });
  await createTestAdmin(WORKSPACE_ADMIN, { name: "Workspace Admin", owner: true });
});

test("a Workspace administrator never sees Site configuration, and its address is refused", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, WORKSPACE_ADMIN);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Questions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Site configuration" })).toHaveCount(0);

  await page.goto("/site/accounts");
  await expect(page.getByTestId("qcms-denied-recovery")).toBeVisible();
  await expect(page.getByTestId("qcms-accounts-table")).toHaveCount(0);
  await expect(main(page)).not.toContainText(VIEWER);
  await expect(page.getByTestId("qcms-site-rail")).toHaveCount(0);
});

test("the directory lists, searches and filters accounts for a Site administrator", async ({
  page,
}) => {
  test.setTimeout(300_000);
  viewerSecret = await enrollNewAdmin(page, VIEWER);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Site configuration" }).click();
  await expect(page).toHaveURL(/\/site\/accounts$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Site configuration" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const rail = page.getByTestId("qcms-site-rail");
  await expect(rail.getByRole("link", { name: "New account" })).toHaveText("New");

  await page.goto(`/site/accounts?q=${encodeURIComponent(UNCLAIMED)}`);
  const table = page.getByTestId("qcms-accounts-table");
  await expect(table.getByRole("row")).toHaveCount(2);
  const row = table.getByRole("row", { name: /Unclaimed Person/u });
  await expect(row).toContainText(UNCLAIMED);
  await expect(row).toContainText("Unclaimed: link sent");

  await page.goto(`/site/accounts?q=${encodeURIComponent("e2e.accounts")}&status=unclaimed`);
  await expect(table.getByRole("row", { name: /Unclaimed Person/u })).toBeVisible();
  await expect(table.getByRole("row", { name: /Member Person/u })).toHaveCount(0);

  await page.goto(`/site/accounts?q=${encodeURIComponent("e2e.accounts")}&role=site-administrator`);
  await expect(table.getByRole("row", { name: /Site Target/u })).toContainText("Yes");
  await expect(table.getByRole("row", { name: /Member Person/u })).toHaveCount(0);
  await expect(page.getByTestId("qcms-rail-filters-title")).toContainText("2 active");

  await page.goto(`/site/accounts?q=${encodeURIComponent(NEVER_CREATED)}`);
  await expect(page.getByTestId("qcms-accounts-empty")).toBeVisible();
});

test("creating an account is refused while outbound email is not configured", async ({ page }) => {
  await signInAsViewer(page);
  await page.goto("/site/accounts/new");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "New account" })).toBeVisible();
  await page.getByRole("textbox", { name: /^Email/u }).fill(NEVER_CREATED);
  await page.getByRole("textbox", { name: /^Name/u }).fill("Never Created");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(main(page).getByRole("alert")).toHaveText(
    "Accounts cannot be created until email is set up for this site. The first account, made at install, is the only exception.",
  );
  await expect(page.getByRole("textbox", { name: /^Email/u })).toHaveValue(NEVER_CREATED);
  expect(await query(`select id from "user" where email = $1`, [NEVER_CREATED])).toEqual([]);
});

test("an unclaimed account offers Resend link and Disable, and the resend is refused without email", async ({
  page,
}) => {
  await signInAsViewer(page);
  await openAccount(page, UNCLAIMED);
  await expect(page.getByRole("heading", { level: 1, name: "Unclaimed Person" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset sign-in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disable account" })).toBeEnabled();
  await page.getByRole("button", { name: "Resend link" }).click();
  const dialog = page.getByRole("dialog", { name: "Resend the sign-in link to Unclaimed Person?" });
  await expect(dialog).toContainText("The earlier link stops working.");
  await dialog.getByRole("button", { name: "Resend link" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Email is not set up for this site, so no sign-in link can be sent.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("disabling an account shows what it holds, ends it at once, and offers Reactivate", async ({
  page,
}) => {
  await signInAsViewer(page);
  await openAccount(page, MEMBER);
  const holdings = page.getByTestId("qcms-account-holdings");
  await expect(holdings).toBeVisible();
  await expect(holdings.getByRole("listitem").first()).toBeVisible();

  await page.getByRole("button", { name: "Disable account" }).click();
  const dialog = page.getByRole("dialog", { name: "Disable Member Person?" });
  await expect(dialog.getByTestId("qcms-disable-holdings")).toBeVisible();
  await expect(dialog.getByTestId("qcms-step-up")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Disable account" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Account disabled. Every session has ended.")).toBeVisible();
  await expect(main(page).locator("[data-account-status]")).toHaveText("Disabled");
  await expect(page.getByRole("button", { name: "Disable account" })).toHaveCount(0);

  const [row] = await query<{ disabledAt: Date | null }>(
    `select "disabledAt" from "user" where email = $1`,
    [MEMBER],
  );
  expect(row?.disabledAt).not.toBeNull();

  await page.getByRole("button", { name: "Reactivate account" }).click();
  const reactivate = page.getByRole("dialog", { name: "Reactivate Member Person?" });
  await expect(reactivate).toContainText("not a Site administrator, even if it was one");
  await reactivate.getByRole("button", { name: "Reactivate account" }).click();
  await expect(reactivate.getByRole("alert")).toHaveText(
    "Email is not set up for this site, so no sign-in link can be sent.",
  );
});

test("disabling a Site administrator takes a step-up, and a failed one sends nothing", async ({
  page,
}) => {
  await signInAsViewer(page);
  await openAccount(page, SITE_TARGET);
  await page.getByRole("button", { name: "Disable account" }).click();
  const dialog = page.getByRole("dialog", { name: "Disable Site Target?" });
  await expect(dialog).toContainText("Needs another Site administrator's approval.");
  const confirm = dialog.getByRole("button", { name: "Disable account" });
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/^Password/u).fill(`${TEST_PASSWORD}-wrong`);
  await dialog.getByLabel(/^Second factor code/u).fill(await freshTotpCode(viewerSecret));
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText("That password and code did not confirm you.");
  await expect(dialog.getByLabel(/^Password/u)).toHaveValue("");
  const pending = async () =>
    query(`select 1 from approval_requests where target = $1 and status = 'pending'`, [
      await userIdOf(SITE_TARGET),
    ]);
  expect(await pending()).toHaveLength(0);

  await rewindTotpStep(VIEWER);
  await dialog.getByLabel(/^Password/u).fill(TEST_PASSWORD);
  await dialog.getByLabel(/^Second factor code/u).fill(await freshTotpCode(viewerSecret));
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(
      "Request sent. Waiting for another Site administrator. The request lasts 7 days.",
    ),
  ).toBeVisible();
  await expect(main(page).locator("[data-account-status]")).toHaveText("Active");
  expect(await pending()).toHaveLength(1);
});

test("the last active Site administrator's Disable is disabled with the reason, and the route still refuses it", async ({
  page,
}) => {
  await signInAsViewer(page);
  const viewerId = await userIdOf(VIEWER);
  const others = await query<{ id: string }>(
    `update "user" set role = null
       where role = 'admin' and id <> $1 and "disabledAt" is null and "claimedAt" is not null
       returning id`,
    [viewerId],
  );
  try {
    await openAccount(page, VIEWER);
    const disable = page.getByRole("button", { name: "Disable account" });
    await expect(disable).toBeDisabled();
    await expect(page.getByTestId("qcms-account-disable")).toContainText(
      "Accounts Viewer is the last active Site administrator, who cannot be disabled.",
    );

    const [session] = await query<{ token: string }>(
      `select token from "session" where "userId" = $1 order by "createdAt" desc limit 1`,
      [viewerId],
    );
    const response = await fetch(
      `${API_BASE_URL}/admin/accounts/${encodeURIComponent(viewerId)}/disable`,
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
    expect(["LAST_SITE_ADMINISTRATOR", "OWN_ACCOUNT"]).toContain(body.error?.code);
    const [row] = await query<{ disabledAt: Date | null }>(
      `select "disabledAt" from "user" where id = $1`,
      [viewerId],
    );
    expect(row?.disabledAt).toBeNull();
  } finally {
    await query(`update "user" set role = 'admin' where id = any($1)`, [
      others.map((entry) => entry.id),
    ]);
  }
});
