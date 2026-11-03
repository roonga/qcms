import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

const EVERYTHING = uniqueAdminEmail("shellall");

const OPERATIONS_ONLY = uniqueAdminEmail("shellops");

const WORKSPACES_ONLY = uniqueAdminEmail("shellws");

const WORKSPACE_ID = "org_default_workspace";

let everythingSecret = "";
let workspacesSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EVERYTHING);
  await createTestAdmin(OPERATIONS_ONLY, { grants: ["responses.viewer"], owner: false });
  await createTestAdmin(WORKSPACES_ONLY, { grants: [], owner: false });
});

test("the application navigation offers the areas the caller holds", async ({ page }) => {
  everythingSecret = await enrollNewAdmin(page, EVERYTHING);

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Questions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Forms" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Operations" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Workspaces" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("the avatar menu carries Settings and My access", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page.getByTestId("account-menu").getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  const access = page.getByRole("menuitem", { name: "My access" });
  await expect(access).toBeVisible();
  await access.click();

  await expect(page.getByRole("heading", { level: 1, name: "My access" })).toBeVisible();
});

test("entering Operations replaces the application navigation with its own header", async ({
  page,
}) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Operations" })
    .click();

  const header = page.getByTestId("qcms-mode-header");
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("data-mode", "operations");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
});

test("Exit leaves Operations for an area the caller holds", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);
  await page.goto("/operations");

  await page.getByTestId("qcms-mode-exit").click();

  await expect(page).toHaveURL(/\/questions$/);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByTestId("qcms-mode-header")).toHaveCount(0);
});

test("account settings opened inside Operations keep the mode", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);
  await page.goto("/operations");

  await page.getByTestId("account-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
});

test("Settings opened from normal mode after a focused visit shows no focused header", async ({
  page,
}) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page.goto("/operations");
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await page.getByTestId("qcms-mode-exit").click();
  await expect(page).toHaveURL(/\/questions$/);

  await page.getByTestId("account-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("qcms-mode-header")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("entering Workspaces replaces the navigation too, and Exit returns", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Workspaces" })
    .click();

  const header = page.getByTestId("qcms-mode-header");
  await expect(header).toHaveAttribute("data-mode", "workspaces");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

  await page.getByTestId("qcms-mode-exit").click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("an Operations-only caller lands in Operations and is offered no authoring menu", async ({
  page,
}) => {
  await enrollNewAdmin(page, OPERATIONS_ONLY, /\/operations$/);

  await page.goto("/");

  await expect(page).toHaveURL(/\/operations$/);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(page.getByRole("link", { name: "Questions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forms" })).toHaveCount(0);
});

test("a workspace-only caller lands in Workspaces with no Exit at all", async ({ page }) => {
  workspacesSecret = await enrollNewAdmin(page, WORKSPACES_ONLY, /\/workspaces$/);

  await page.goto("/");

  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "workspaces");
  await expect(page.getByTestId("qcms-mode-exit")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Questions" })).toHaveCount(0);
});

test("a caller holding only the claim gets the queues, no form rows and no names", async ({
  page,
}) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page.goto("/operations");

  await expect(page.getByTestId("qcms-operations-empty")).toBeVisible();
  await expect(page.getByTestId("qcms-operations-table")).toHaveCount(0);
  const rail = page.getByTestId("qcms-operations-rail");
  await expect(rail.getByRole("link", { name: "Delivery failures" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Erasure log" })).toBeVisible();

  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toContain("org_default_workspace");
  expect(body).not.toContain("frm_");
});

test("a rejected workspace bookmark still has All workspaces", async ({ page }) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page.goto("/workspaces/ws_not_a_workspace");

  await expect(page.getByText("No such workspace, or you do not manage it")).toBeVisible();
  await page.getByRole("link", { name: "All workspaces" }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});

test("the root lands an authoring caller in authoring, whatever a mode remembered", async ({
  page,
}) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByRole("heading", { level: 2, name: "Members" })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/questions$/);
});

test("the root restores the workspace a workspace-only caller was last on", async ({ page }) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByRole("heading", { level: 2, name: "Members" })).toBeVisible();
  // Wait for hydration: the remembered context is written by a client effect, not by server rendering.
  await waitForHydration(page);

  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}$`));
});

test("the root falls back to All workspaces when the remembered one is not permitted", async ({
  page,
}) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page
    .context()
    .addCookies([{ name: "qcms-shell-workspace", value: "ws_revoked", url: ADMIN_BASE_URL }]);
  await page.goto("/");

  await expect(page).toHaveURL(/\/workspaces$/);
});

test("the Operations landing is reached again by re-entering the mode", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page.goto("/operations");
  await page.getByTestId("qcms-mode-exit").click();
  await expect(page).toHaveURL(/\/questions$/);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Operations" })
    .click();
  await expect(page).toHaveURL(/\/operations$/);
});
