import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * The shell's modes in a browser: what each caller's navigation offers, where they land,
 * and what a bookmark into an area they do not hold renders.
 *
 * # What only a browser can report
 *
 * The rules themselves are unit-tested in `lib/shell/modes.test.ts`, exhaustively and
 * without a database. Three facts are not available there:
 *
 *   - a focused mode renders its own header **in place of** the application navigation, so
 *     the normal menus are absent from the document rather than styled away;
 *   - `/` resolves to a different area per caller, which is a redirect chain; and
 *   - a denied bookmark renders a recovery that names nothing it refused.
 *
 * # Why one persona's landing is not asserted here
 *
 * Every account this harness creates holds the installation claim: `role` defaults to
 * `admin` in the auth instance, and the claim resolves as a `forms.owner` grant, which
 * carries `workspace: read`. So no browser persona can hold **nothing**, and the
 * no-grant landing on My access is asserted in the unit suite instead. The personas below
 * differ in the capabilities the harness can actually vary: authoring and operations come
 * from seeded access groups.
 */

test.describe.configure({ mode: "serial" });

/** Every team role plus the owner row: authoring, operations and workspaces. */
const EVERYTHING = uniqueAdminEmail("shellall");
/** `responses.viewer` only: operations, and no authoring. */
const OPERATIONS_ONLY = uniqueAdminEmail("shellops");
/** No access group at all: the claim's workspace administration and nothing else. */
const WORKSPACES_ONLY = uniqueAdminEmail("shellws");

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
  // Settings belongs to the account rather than to an area, so it is under the avatar.
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
  // Absent from the document, not merely hidden: a focused mode must never reveal the
  // normal navigation, and a disabled menu would still name the areas.
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
  // The mode survives a route that belongs to the account rather than to an area, so the
  // authoring menus do not reappear behind a personal screen.
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
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
  // The areas this caller does not hold are named nowhere, in the header or out of it.
  await expect(page.getByRole("link", { name: "Questions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forms" })).toHaveCount(0);
});

test("a workspace-only caller lands in Workspaces with no Exit at all", async ({ page }) => {
  workspacesSecret = await enrollNewAdmin(page, WORKSPACES_ONLY, /\/workspaces$/);

  await page.goto("/");

  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "workspaces");
  // Workspaces is the only area they hold, so there is nowhere for an Exit to go and none
  // is offered: a link to an area they do not hold would name it and then refuse.
  await expect(page.getByTestId("qcms-mode-exit")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Questions" })).toHaveCount(0);
});

test("a denied bookmark offers a permitted route and names nothing it refused", async ({
  page,
}) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page.goto("/operations");

  const denied = page.getByTestId("qcms-denied-recovery");
  await expect(denied).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "You do not have access to this area" }),
  ).toBeVisible();
  // The recovery is one of this caller's own areas, plus My access, which everybody holds.
  await expect(denied.getByRole("link", { name: "Go to an area you can use" })).toBeVisible();
  await expect(denied.getByRole("link", { name: "See what you can access" })).toBeVisible();

  // Nothing about the refused area is resolved: no form slug and no workspace name.
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

test("the Operations landing is reached again by re-entering the mode", async ({ page }) => {
  await signInWithTotp(page, EVERYTHING, everythingSecret);

  await page.goto("/operations");
  await page.getByTestId("qcms-mode-exit").click();
  await expect(page).toHaveURL(/\/questions$/);

  // Re-entering returns to the forms list rather than to anything remembered below it.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Operations" })
    .click();
  await expect(page).toHaveURL(/\/operations$/);
});
