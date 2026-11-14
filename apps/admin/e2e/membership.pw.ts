import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { chooseOption } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("membership069");

const MEMBER = uniqueAdminEmail("membership069member");

const WORKSPACE_ID = "org_default_workspace";

/** A group name is unique within its workspace, so each run names its own. */
const GROUP_NAME = `Response viewers ${Date.now().toString(36)}`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  await createTestAdmin(MEMBER, { grants: ["forms.viewer"], owner: false });
});

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
  await expect(
    page.getByText("You hold the installation-wide claim", { exact: false }),
  ).toBeVisible();

  await expect(
    page.getByText("It grants no response read, export or erasure anywhere", { exact: false }),
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
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups`);
  await waitForHydration(page);

  const create = page.getByTestId("qcms-access-group-create");
  await expect(create.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();

  await chooseOption(create, "Role", "Form viewer");
  await expect(create.getByTestId("qcms-group-no-environments")).toBeVisible();
  await expect(create.getByRole("checkbox", { name: "test", exact: true })).toHaveCount(0);

  await chooseOption(create, "Role", "Form publisher");
  await expect(create.getByTestId("qcms-group-no-environments")).toHaveCount(0);
  await expect(create.getByRole("checkbox", { name: "test", exact: true })).toBeVisible();
});

test("the two-person switch states all three of its effects", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);

  const twoPerson = page.getByLabel("Require a second approver for production");
  await expect(twoPerson).toBeVisible();
  await expect(twoPerson).not.toBeChecked();

  for (const effect of [
    "A release to production is refused for the account that published the version",
    "a production endpoint change takes a second approver's confirmation",
    "nobody can give themselves a response role",
  ]) {
    await expect(page.getByText(effect, { exact: false })).toBeVisible();
  }
});

test("an access group is created with the pickers, granted to a member and taken down again", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups`);
  await waitForHydration(page);

  const create = page.getByTestId("qcms-access-group-create");
  await create.getByRole("textbox", { name: "Name", exact: true }).fill(GROUP_NAME);
  await chooseOption(create, "Role", "Response viewer");
  await expect(create.getByText("Reads and exports responses", { exact: false })).toBeVisible();
  await expect(create.getByText("responses.viewer", { exact: true })).toHaveCount(0);

  // React Aria hides the checkbox input, so each tick is a click on its label.
  const tick = async (label: string, on: boolean): Promise<void> => {
    await create.getByText(label, { exact: true }).click();
    await expect(create.getByRole("checkbox", { name: label, exact: true })).toBeChecked({
      checked: on,
    });
  };

  // A response role names its environments, so the group cannot be saved until one is ticked.
  await expect(create.getByRole("button", { name: "Create group" })).toBeDisabled();
  await tick("test", true);

  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText(`The access group ${GROUP_NAME} was created`)).toBeVisible();

  const row = page
    .getByRole("region", { name: "Access groups" })
    .locator(`[data-group-name="${GROUP_NAME}"]`)
    .first();
  await expect(row.locator("p").first()).toHaveText(GROUP_NAME);
  await expect(row).toContainText("Response viewer, in test");
  await expect(row).toContainText("Nobody");
  await expect(row.getByRole("textbox", { name: "Account address" })).toHaveCount(0);

  await chooseOption(row, "Member", MEMBER);
  await row.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(page.getByText(`${MEMBER} now holds ${GROUP_NAME}.`)).toBeVisible();
  await expect(row).toContainText(MEMBER);

  // Members reads a group by its roles and environments, so two groups of one name are told apart.
  await page.goto(`/workspaces/${WORKSPACE_ID}/members`);
  await expect(
    page
      .getByRole("table", { name: /members/iu })
      .getByRole("row")
      .filter({ hasText: MEMBER }),
  ).toContainText("Response viewer, in test");
  await page.goto(`/workspaces/${WORKSPACE_ID}/access-groups`);
  await waitForHydration(page);

  await row
    .getByRole("listitem")
    .filter({ hasText: MEMBER })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(row).toContainText("Nobody");
  await row.getByRole("button", { name: "Remove group" }).click();
  await expect(page.getByText("The group and every grant it carried were removed")).toBeVisible();
  await expect(row).toHaveCount(0);
});
