import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  enrollNewAdmin,
  fillStable,
  openMenu,
  signInWithTotp,
  warmSignIn,
} from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import {
  createFormIn,
  createWorkspace,
  formCountIn,
  grantInWorkspace,
  type SeededWorkspace,
} from "./support/workspaces.js";

// Named `workspace-*` so it runs after every spec that reads the installation's workspace
// count: this one adds workspaces, and no earlier spec should meet them (issue #1387).

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

const ADMIN = uniqueAdminEmail("archiveadmin");

const EDIT_FORMS = ["forms.editor"];

let closing: SeededWorkspace;
let keeping: SeededWorkspace;

let adminSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(ADMIN, { name: "Archive Admin", grants: [], owner: false });
  closing = await createWorkspace(`Archive closing ${RUN}`, `archive-closing-${RUN}`, ADMIN);
  keeping = await createWorkspace(`Archive keeping ${RUN}`, `archive-keeping-${RUN}`, ADMIN);
  for (const workspace of [closing, keeping]) {
    await grantInWorkspace(ADMIN, workspace.workspaceId, { grants: EDIT_FORMS, owner: true });
  }
  formId = await createFormIn(closing.workspaceId, `archive-form-${RUN}`);
});

function archivePanel(page: Page): Locator {
  return page.locator('section[aria-labelledby="qcms-archive-heading"]');
}

async function openArchive(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/workspaces/${workspaceId}/archive`);
  await waitForHydration(page);
}

async function switchWorkspace(page: Page, name: string): Promise<void> {
  await openMenu(page.getByTestId("qcms-workspace-switcher").getByRole("button").first());
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await waitForHydration(page);
}

test("the sign-in screen is served before anything types into it", async ({ page }) => {
  test.setTimeout(300_000);
  await warmSignIn(page);
});

test("archiving is refused inline while the workspace still owns a form", async ({ page }) => {
  test.setTimeout(300_000);
  adminSecret = await enrollNewAdmin(page, ADMIN);
  await openArchive(page, closing.workspaceId);

  const blockers = page.getByTestId("qcms-archive-blockers");
  await expect(blockers).toContainText("Cannot archive yet");
  await expect(blockers).toContainText(
    "1 form is still in this workspace, closed and never-published ones included.",
  );
  await expect(page.getByRole("button", { name: `Archive ${closing.name}` })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: `Type ${closing.name}` })).toBeDisabled();
  expect(await formCountIn(closing.workspaceId)).toBe(1);
});

test("once the form has moved out, the typed name archives the workspace", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, ADMIN, adminSecret);

  await page.goto(`/forms/${formId}/move?to=${keeping.workspaceId}`);
  await waitForHydration(page);
  const move = page.getByTestId("qcms-move-form");
  await move.getByRole("button", { name: `Move to ${keeping.name}` }).click();
  await expect(move.getByText(`This form moved to ${keeping.name}`)).toBeVisible();
  expect(await formCountIn(closing.workspaceId)).toBe(0);

  await openArchive(page, closing.workspaceId);
  await expect(page.getByTestId("qcms-archive-blockers")).toHaveCount(0);
  await expect(archivePanel(page)).toContainText(`Archiving ${closing.name} cannot be undone.`);

  // A name that does not match keeps the act off and says why.
  const typed = page.getByRole("textbox", { name: `Type ${closing.name}` });
  const archive = page.getByRole("button", { name: `Archive ${closing.name}` });
  await fillStable(typed, `${closing.name} and more`);
  await expect(archivePanel(page)).toContainText(`Type ${closing.name} exactly`);
  await expect(archive).toBeDisabled();

  await fillStable(typed, closing.name);
  await expect(archive).toBeEnabled();
  await archive.click();
  await expect(
    archivePanel(page).getByText(
      `${closing.name} is archived. Nothing was deleted, and there is no unarchive.`,
    ),
  ).toBeVisible();
});

test("the archived workspace reads as archived and refuses a new form", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, ADMIN, adminSecret);

  await openArchive(page, closing.workspaceId);
  await expect(
    archivePanel(page).getByText("This workspace is archived. There is no unarchive."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: `Archive ${closing.name}` })).toHaveCount(0);

  // An archived workspace grants nothing, so its Forms list offers no form and no create.
  await page.goto("/forms");
  await switchWorkspace(page, closing.name);
  await expect(page.getByTestId("qcms-forms-empty")).toContainText(
    `No forms you can see in ${closing.name}`,
  );
  await expect(page.getByRole("link", { name: "New form" })).toHaveCount(0);

  // The missing control is a courtesy; the route behind it answers for itself.
  await page.goto("/forms/new");
  await waitForHydration(page);
  await fillStable(page.getByRole("textbox", { name: "Slug", exact: true }), `blocked-${RUN}`);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(
    page.getByText("That workspace is archived, so it takes no further change."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/forms\/new$/u);
  expect(await formCountIn(closing.workspaceId)).toBe(0);
});
