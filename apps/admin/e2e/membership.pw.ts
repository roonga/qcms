import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("membership069");

const WORKSPACE_ID = "org_default_workspace";

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the membership area is reachable from the shell's navigation", async ({ page }) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Workspaces" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

  await page.getByRole("link", { name: "My access" }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Your own access" })).toBeVisible();
  await expect(
    page.getByText("You hold the installation-wide claim", { exact: false }),
  ).toBeVisible();

  await expect(
    page.getByText("It grants no response read, export or erasure anywhere", { exact: false }),
  ).toBeVisible();
});

test("a workspace page carries its four panels, each named", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  for (const heading of ["Members", "Access groups", "Workspace settings", "Access audit"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  await expect(
    page.getByText("is a label rather than a mechanism", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Nothing reads a name to authorise anything", { exact: false }),
  ).toBeVisible();
});

test("the seed setting's help text says a grant on test responses is a grant on personal data", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  const seed = page.getByLabel("Seed a new editor with dev and test response access");
  await expect(seed).toBeVisible();
  await expect(seed).not.toBeChecked();
  await expect(
    page.getByText("A grant on test responses is a grant on personal data", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("because a test run can involve real respondents", { exact: false }),
  ).toBeVisible();

  await expect(
    page.getByText("turning it on is written to the access audit", { exact: false }),
  ).toBeVisible();
});

test("the two-person switch states all three of its effects", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  const twoPerson = page.getByLabel("Require a second approver for production");
  await expect(twoPerson).toBeVisible();
  await expect(twoPerson).not.toBeChecked();

  for (const effect of [
    "A release to production is refused for the account that published the version",
    "a production endpoint change takes a second approver's confirmation",
    "nobody can grant themselves a responses role",
  ]) {
    await expect(page.getByText(effect, { exact: false })).toBeVisible();
  }
});
