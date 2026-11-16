import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const NOTHING = uniqueAdminEmail("myaccessnothing");

const VIEWER = uniqueAdminEmail("myaccessviewer");

const ERASER = uniqueAdminEmail("myaccesseraser");

const VIEWER_GROUP = "Every environment: forms.viewer";

const ERASER_GROUP = "Every environment: responses.eraser";

test.beforeAll(async () => {
  await createTestAdmin(NOTHING, { grants: [], owner: false, siteAdministrator: false });
  await createTestAdmin(VIEWER, {
    grants: ["forms.viewer"],
    owner: false,
    siteAdministrator: false,
  });
  await createTestAdmin(ERASER, {
    grants: ["responses.eraser"],
    owner: false,
    siteAdministrator: false,
  });
});

test("an account that holds nothing lands on the No access yet home, which names who to ask", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, NOTHING, /\/me\/access$/);

  const home = page.getByTestId("qcms-no-access-home");
  await expect(
    home.getByRole("heading", { name: "You do not have access to any workspace yet." }),
  ).toBeVisible();
  await expect(home).toContainText("Your Site administrator");
  await expect(home).toContainText("A Workspace administrator adds you to an access group.");
  await expect(home.getByRole("link", { name: "My access" })).toHaveAttribute(
    "href",
    "#qcms-my-access-heading",
  );

  const workspace = page.getByTestId("qcms-my-access-workspace");
  await expect(workspace).toContainText("Workspace administrator: No");
  await expect(workspace).toContainText("You have no access in");
  await expect(workspace.getByRole("table")).toHaveCount(0);
});

test("My access explains the caller's own groups and reveals no other person's", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, VIEWER, /\/(forms|questions|me\/access)/);
  await page.goto("/me/access");

  await expect(page.getByTestId("qcms-no-access-home")).toHaveCount(0);
  const workspace = page.getByTestId("qcms-my-access-workspace");
  await expect(workspace).toContainText(`Access groups: ${VIEWER_GROUP}`);

  const table = workspace.getByRole("table", { name: /^What you can do in / });
  await expect(table).toBeVisible();
  const viewForms = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "View forms" }) });
  await expect(viewForms).toContainText(VIEWER_GROUP);
  const erase = table
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "Erase responses" }) });
  await expect(erase).not.toContainText(VIEWER_GROUP);
  await expect(erase).toContainText("No group grants this");

  const main = page.locator("main#main-content");
  await expect(main).not.toContainText(ERASER_GROUP);
  await expect(main).not.toContainText(ERASER);
  await expect(main).not.toContainText("Your Site administrator");
});
