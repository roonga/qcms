import type { Locator } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { chooseOption } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { suspendHold } from "./support/membership.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("membership069");

const MEMBER = uniqueAdminEmail("membership069member");

const WORKSPACE_ID = "org_default_workspace";

/** A group name is unique within its workspace, so each run names its own. */
const RUN = Date.now().toString(36);
const GROUP_NAME = `Response viewers ${RUN}`;
const RENAMED = `Response readers ${RUN}`;

let totpSecret = "";
let memberSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL, { siteAdministrator: true });
  await createTestAdmin(MEMBER, { grants: ["forms.viewer"], owner: false });
});

// React Aria hides the checkbox input, so each tick is a click on its label.
async function tick(scope: Locator, label: string, on: boolean): Promise<void> {
  await scope.getByText(label, { exact: true }).click();
  await expect(scope.getByRole("checkbox", { name: label, exact: true })).toBeChecked({
    checked: on,
  });
}

test("the membership area is reachable from the shell's navigation", async ({ page }) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // One workspace, so the area names itself in the singular.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspaces\/[^/]+\/members$/);

  await page.getByTestId("account-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "My access" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your own access" })).toBeVisible();
  await expect(page.getByText("You are a Site administrator", { exact: false })).toBeVisible();

  await expect(
    page.getByText("The role grants no response read, export or erasure anywhere", {
      exact: false,
    }),
  ).toBeVisible();
});

test("a workspace's old address lands on its first section, and each section is its own screen", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}/members$`));

  const rail = page.getByTestId("qcms-workspaces-rail");
  // The switcher in the top bar is the only chooser, so the rail names sections, never a
  // workspace; with one workspace there is no list to go back to either.
  await expect(rail.getByTestId("qcms-rail-context")).toHaveCount(0);
  await expect(rail.locator(`[data-rail-item="workspace:${WORKSPACE_ID}"]`)).toHaveCount(0);
  await expect(page.getByTestId("qcms-workspace-context")).toHaveCount(0);

  const sections = [
    ["members", "Members"],
    ["access-groups", "Access groups"],
    ["settings", "Workspace settings"],
    ["audit", "Access audit"],
    ["assistant-actions", "Assistant actions"],
  ] as const;
  for (const [section, heading] of sections) {
    await rail.locator(`[data-rail-item="section:${section}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}/${section}$`));
    await expect(page.locator("main#main-content h1")).toHaveText(heading);
    await expect(rail.locator(`[data-rail-item="section:${section}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: heading })).toHaveCount(0);
    await expect(page.getByTestId("qcms-mode-exit")).toHaveCount(0);
  }

  // Grant and New are level-2 rows beneath their section, each the one current row on its view.
  for (const [row, heading] of [
    ["section:members:grant", "Grant"],
    ["section:access-groups:new", "New access group"],
  ] as const) {
    await rail.locator(`[data-rail-item="${row}"]`).click();
    await expect(page.locator("main#main-content h1")).toHaveText(heading);
    await expect(rail.locator(`[data-rail-item="${row}"]`)).toHaveAttribute("aria-current", "page");
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("one workspace draws no switcher, keeps the name in the crumb and has no list", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/members`);

  // Counted over the workspaces this caller may open: with one there is no choice to offer.
  await expect(page.getByTestId("qcms-workspace-switcher")).toHaveCount(0);

  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");
  await expect(crumbs).toHaveCount(3);
  await expect(crumbs.nth(0)).toContainText("Workspace");
  await expect(crumbs.nth(1)).toContainText("Default workspace");
  await expect(crumbs.nth(2)).toContainText("Members");

  await page.goto("/workspaces/all");
  await expect(page).toHaveURL(new RegExp(`/workspaces/${WORKSPACE_ID}/members$`));
});

test("the environment picker appears only for a role whose acts are bound to one", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups?new=1`);
  await waitForHydration(page);

  const create = page.getByTestId("qcms-access-group-create");
  await expect(create.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();

  await tick(create, "View forms", true);
  await tick(create, "Edit forms", true);
  await expect(create.getByTestId("qcms-group-no-environments")).toBeVisible();
  await expect(create.getByRole("checkbox", { name: "test", exact: true })).toHaveCount(0);

  await tick(create, "Publish forms", true);
  await expect(create.getByTestId("qcms-group-no-environments")).toHaveCount(0);
  await expect(create.getByRole("checkbox", { name: "test", exact: true })).toBeVisible();
});

test("the two-person switch states all three of its effects", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);

  const twoPerson = page.getByLabel("Second approval in production");
  await expect(twoPerson).toBeVisible();
  await expect(twoPerson).not.toBeChecked();

  for (const effect of [
    "A publish to production is refused for the account that froze the version",
    "a production endpoint change takes an Approver's confirmation",
    "nobody can give themselves a response role",
  ]) {
    await expect(page.getByText(effect, { exact: false })).toBeVisible();
  }
});

test("a group is created, granted by address, re-confirmed, renamed, revoked and deleted", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups?new=1`);
  await waitForHydration(page);

  const create = page.getByTestId("qcms-access-group-create");
  await create.getByRole("textbox", { name: "Name", exact: true }).fill(GROUP_NAME);
  await tick(create, "View responses", true);
  // A response role names its environments, so the group cannot be saved until one is ticked.
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(create.getByRole("alert")).toContainText("Choose at least one environment");
  await tick(create, "test", true);
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText(`The access group ${GROUP_NAME} was created`)).toBeVisible();

  // Grant by exact address; an address that cannot be added gets the one generic answer.
  await page.goto(`/workspaces/${WORKSPACE_ID}/members?grant=1`);
  await waitForHydration(page);
  const grant = page.getByTestId("qcms-grant-form");
  await grant.getByRole("textbox", { name: "Email address" }).fill(`nobody.${RUN}@admin.test`);
  await chooseOption(grant, "Access group", `${GROUP_NAME} - View responses, in test`);
  await grant.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(
    page.getByText("No active account can be added with that address", { exact: false }),
  ).toBeVisible();

  await grant.getByRole("textbox", { name: "Email address" }).fill(MEMBER);
  await expect(grant.getByTestId("qcms-access-preview")).toContainText("View responses in test");
  await grant.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(page.getByText(`${MEMBER} is now in ${GROUP_NAME}.`)).toBeVisible();

  // A reset suspends the hold; the person's sheet carries the tag and the re-confirm.
  await suspendHold(WORKSPACE_ID, GROUP_NAME, MEMBER, MEMBER);
  await page.goto(`/workspaces/${WORKSPACE_ID}/members?q=${encodeURIComponent(MEMBER)}`);
  await waitForHydration(page);
  const row = page
    .getByRole("table", { name: /members/iu })
    .getByRole("row")
    .filter({
      hasText: MEMBER,
    });
  await expect(row).toContainText(GROUP_NAME);
  await expect(row).toContainText("Suspended");
  await row.getByRole("button", { name: /^Open / }).click();
  const sheet = page.getByTestId("qcms-person-sheet");
  await expect(sheet.getByTestId("qcms-access-explanation")).toBeVisible();
  await sheet.getByRole("button", { name: new RegExp(`^Re-confirm .* in ${GROUP_NAME}$`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Re-confirm", exact: true }).click();
  await expect(page.getByText(`in ${GROUP_NAME}.`, { exact: false })).toBeVisible();
  await expect(row).not.toContainText("Suspended");

  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups`);
  await waitForHydration(page);
  await page.getByRole("button", { name: `Open ${GROUP_NAME}`, exact: true }).click();
  await page.getByTestId("qcms-group-sheet").getByRole("button", { name: "Change" }).click();
  const form = page.getByTestId("qcms-group-form");
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(RENAMED);
  await expect(form.getByRole("checkbox", { name: "Production", exact: true })).not.toBeChecked();
  await form.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByText(`Saved ${RENAMED}.`)).toBeVisible();
  const renamed = page.locator(`[data-group-name="${RENAMED}"]`);
  await expect(renamed).toContainText("test");
  await expect(renamed).not.toContainText("prod");

  await page.getByRole("button", { name: `Open ${RENAMED}`, exact: true }).click();
  await page
    .getByTestId("qcms-group-sheet")
    .getByRole("button", { name: `Revoke this access group from ${MEMBER}` })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Revoke ${RENAMED}` })
    .click();
  await expect(renamed).toContainText("Nobody");

  // A revoke leaves the group's sheet open, because the group is still its subject.
  await page.getByTestId("qcms-group-sheet").getByRole("button", { name: "Delete group" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Delete ${RENAMED}` })
    .click();
  await expect(page.getByText("The group and every grant it carried were removed")).toBeVisible();
  await expect(renamed).toHaveCount(0);
});

test("Re-confirm is never offered on your own suspended membership", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups?new=1`);
  await waitForHydration(page);
  const own = `Own hold ${RUN}`;
  const create = page.getByTestId("qcms-access-group-create");
  await create.getByRole("textbox", { name: "Name", exact: true }).fill(own);
  await tick(create, "View responses", true);
  await tick(create, "test", true);
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText(`The access group ${own} was created`)).toBeVisible();

  await page.goto(`/workspaces/${WORKSPACE_ID}/members?grant=1`);
  await waitForHydration(page);
  const grant = page.getByTestId("qcms-grant-form");
  await grant.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
  await chooseOption(grant, "Access group", `${own} - View responses, in test`);
  await grant.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(page.getByText(`${EMAIL} is now in ${own}.`)).toBeVisible();

  await suspendHold(WORKSPACE_ID, own, EMAIL, MEMBER);
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups`);
  await waitForHydration(page);
  await page.getByRole("button", { name: `Open ${own}`, exact: true }).click();
  const sheet = page.getByTestId("qcms-group-sheet");
  await expect(sheet.getByTestId("qcms-suspended-tag")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Re-confirm/u })).toHaveCount(0);
  await expect(sheet).toContainText("You cannot re-confirm your own membership.");

  await sheet.getByRole("button", { name: "Delete group" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Delete ${own}` })
    .click();
  await expect(page.locator(`[data-group-name="${own}"]`)).toHaveCount(0);
});

test("a person who administers nothing is shown the denied recovery, not the lists", async ({
  page,
}) => {
  memberSecret = await enrollNewAdmin(page, MEMBER);
  expect(memberSecret).not.toBe("");
  for (const section of ["members", "access-groups"]) {
    await page.goto(`/workspaces/${WORKSPACE_ID}/${section}`);
    await expect(page.getByTestId("qcms-denied-recovery")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  }
});
