import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The shell's modes in a browser: what each caller's navigation offers, and where they
 * land.
 *
 * # What only a browser can report
 *
 * The rules themselves are unit-tested in `lib/shell/modes.test.ts`, exhaustively and
 * without a database. Two facts are not available there:
 *
 *   - a focused mode renders its own header **in place of** the application navigation, so
 *     the normal menus are absent from the document rather than styled away; and
 *   - `/` resolves to a different area per caller, which is a redirect chain.
 *
 * # Why one persona's landing, and the denied bookmark, are not asserted here
 *
 * Every account this harness creates holds the installation claim: `role` defaults to
 * `admin` in the auth instance, and the claim resolves as a `forms.owner` grant, which
 * carries `workspace: read`. So no browser persona can hold **nothing**, and the
 * no-grant landing on My access is asserted in the unit suite instead. The personas below
 * differ in the capabilities the harness can actually vary: authoring and operations come
 * from seeded access groups.
 *
 * Since the claim admits a caller to Operations, whose two global queues are its own
 * destinations, no persona here is refused a focused mode either. `permitsPath` and the
 * refusal's recovery are covered by `lib/shell/modes.test.ts` and
 * `app/(shell)/operations-states.test.tsx`.
 */

test.describe.configure({ mode: "serial" });

/** Every team role plus the owner row: authoring, operations and workspaces. */
const EVERYTHING = uniqueAdminEmail("shellall");
/** `responses.viewer` only: operations, and no authoring. */
const OPERATIONS_ONLY = uniqueAdminEmail("shellops");
/** No access group at all: the claim's workspace administration and nothing else. */
const WORKSPACES_ONLY = uniqueAdminEmail("shellws");

/** The workspace a bootstrapped installation is seeded with. */
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

  // Operations first, so the mode is remembered, then back to an authoring screen.
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

  // Decision 3's installation-claim row: no form is discovered, and the two global queues
  // are its own destinations.
  await expect(page.getByTestId("qcms-operations-empty")).toBeVisible();
  await expect(page.getByTestId("qcms-operations-table")).toHaveCount(0);
  const rail = page.getByTestId("qcms-operations-rail");
  await expect(rail.getByRole("link", { name: "Delivery failures" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Erasure log" })).toBeVisible();

  // The leak this guards is an empty answer that resolves an identifier to a title.
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

  // The root restores the context of the area this caller LANDS in, and theirs is
  // authoring: a remembered workspace does not move the landing area itself.
  await page.goto("/");
  await expect(page).toHaveURL(/\/questions$/);
});

test("the root restores the workspace a workspace-only caller was last on", async ({ page }) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page.getByRole("heading", { level: 2, name: "Members" })).toBeVisible();
  // The context is remembered by a client effect, so a server-rendered heading is not
  // evidence it has been written yet.
  await waitForHydration(page);

  // Workspaces IS their landing area, so arriving with no route of their own restores the
  // one they were on. The root is a page and resolves on every arrival; the shell's layout
  // does not re-render on a soft navigation.
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}$`));
});

test("the root falls back to All workspaces when the remembered one is not permitted", async ({
  page,
}) => {
  await signInWithTotp(page, WORKSPACES_ONLY, workspacesSecret, /\/workspaces$/);

  // A cookie left from a grant since revoked. It names a workspace this caller does not
  // administer, so it restores nothing rather than deciding where they land.
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
