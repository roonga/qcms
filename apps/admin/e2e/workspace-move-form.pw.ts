import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { API_BASE_URL, FIXED_INTERNAL_TOKEN } from "../../portal/e2e/support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, openMenu, signInWithTotp } from "./support/flow.js";
import { openRail } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import {
  auditDetails,
  createFormIn,
  createWorkspace,
  grantInWorkspace,
  sessionTokenOf,
  setWorkspaceSecondApproval,
  workspaceOf,
  workspaceRequests,
  type SeededWorkspace,
} from "./support/workspaces.js";

// Named `workspace-*` so it runs after every spec that reads the installation's workspace
// count: this one adds workspaces, and no earlier spec should meet them (issue #1387).

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

const MOVER = uniqueAdminEmail("movemover");
const EDITOR = uniqueAdminEmail("moveeditor");
const APPROVER = uniqueAdminEmail("moveapprover");
const GAINER = uniqueAdminEmail("movegainer");
const LOSER = uniqueAdminEmail("moveloser");
const OUTSIDER = uniqueAdminEmail("moveoutsider");

const MOVER_NAME = "Mover Person";
const GAINER_NAME = "Gainer Person";
const LOSER_NAME = "Loser Person";
const OUTSIDER_NAME = "Outsider Person";

const EDIT_FORMS = ["forms.editor"];
const READ_RESPONSES = ["responses.viewer"];

let source: SeededWorkspace;
let destination: SeededWorkspace;
let elsewhere: SeededWorkspace;

let moverSecret = "";
let approverSecret = "";

let previewForm = "";
let appliedForm = "";
let heldForm = "";
let lapsedForm = "";
let ownWorkspaceForm = "";

test.beforeAll(async () => {
  await createTestAdmin(MOVER, { name: MOVER_NAME, grants: [], owner: false });
  await createTestAdmin(EDITOR, { name: "Editor Person", grants: [], owner: false });
  await createTestAdmin(APPROVER, { name: "Approver Person", grants: [], owner: false });
  await createTestAdmin(GAINER, { name: GAINER_NAME, grants: [], owner: false });
  await createTestAdmin(LOSER, { name: LOSER_NAME, grants: [], owner: false });
  // Held in the seeded workspace only, so the preview has somebody outside its two to omit.
  await createTestAdmin(OUTSIDER, { name: OUTSIDER_NAME, grants: READ_RESPONSES, owner: false });

  source = await createWorkspace(`Move source ${RUN}`, `move-source-${RUN}`, MOVER);
  destination = await createWorkspace(`Move destination ${RUN}`, `move-dest-${RUN}`, MOVER);
  elsewhere = await createWorkspace(`Move elsewhere ${RUN}`, `move-else-${RUN}`, MOVER);

  for (const workspace of [source, destination, elsewhere]) {
    await grantInWorkspace(MOVER, workspace.workspaceId, { grants: EDIT_FORMS, owner: true });
  }
  await grantInWorkspace(EDITOR, source.workspaceId, { grants: EDIT_FORMS, owner: false });
  await grantInWorkspace(EDITOR, destination.workspaceId, { grants: EDIT_FORMS, owner: false });
  await grantInWorkspace(APPROVER, source.workspaceId, { grants: ["forms.viewer"], owner: true });
  await grantInWorkspace(GAINER, destination.workspaceId, { grants: READ_RESPONSES });
  await grantInWorkspace(LOSER, source.workspaceId, { grants: READ_RESPONSES });

  previewForm = await createFormIn(source.workspaceId, `move-preview-${RUN}`);
  appliedForm = await createFormIn(source.workspaceId, `move-applied-${RUN}`);
  heldForm = await createFormIn(source.workspaceId, `move-held-${RUN}`);
  lapsedForm = await createFormIn(source.workspaceId, `move-lapsed-${RUN}`);
  ownWorkspaceForm = await createFormIn(source.workspaceId, `move-own-${RUN}`);
});

// Leave the switch off whatever failed: a serial retry restarts at a test that expects it off.
test.afterAll(async () => {
  await setWorkspaceSecondApproval(source.workspaceId, false);
});

function panel(page: Page): Locator {
  return page.getByTestId("qcms-move-form");
}

function requestCard(page: Page, requestId: string): Locator {
  return page.locator(`[data-request="${requestId}"]`);
}

async function openMove(page: Page, formId: string, to?: string): Promise<void> {
  const query = to === undefined ? "" : `?to=${encodeURIComponent(to)}`;
  await page.goto(`/forms/${formId}/move${query}`);
  await waitForHydration(page);
}

async function openWorkspaceAudit(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/workspaces/${workspaceId}/audit`);
  await waitForHydration(page);
}

/** Switch the shell to one workspace, which is what scopes the Forms list. */
async function switchWorkspace(page: Page, name: string): Promise<void> {
  await openMenu(page.getByTestId("qcms-workspace-switcher").getByRole("button").first());
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await waitForHydration(page);
}

async function moveRequestFor(formId: string): Promise<{ requestId: string; status: string }> {
  const [request] = await workspaceRequests(source.workspaceId, "move-form", formId);
  if (request === undefined) throw new Error(`no move request was stored for ${formId}`);
  return { requestId: request.requestId, status: request.status };
}

test("the sign-in screen is served before anything types into it", async ({ page }) => {
  test.setTimeout(300_000);
  // Warm and hydrate sign-in before typing so dev-server compilation cannot replace the next test's document.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("the rail offers Move form, and the preview names the affected people by name", async ({
  page,
}) => {
  test.setTimeout(300_000);
  moverSecret = await enrollNewAdmin(page, MOVER);
  await openMove(page, previewForm);

  await openRail(page);
  await expect(page.locator('[data-rail-item="section:move"]')).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The chooser never offers the form's own workspace, so the screen cannot ask for the move
  // the route refuses as MOVE_SAME_WORKSPACE.
  await panel(page)
    .getByRole("button", { name: /Destination workspace$/u })
    .first()
    .click();
  await expect(page.getByRole("option", { name: source.name, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: destination.name, exact: true }).click();

  await panel(page).getByRole("button", { name: "Show who gains access" }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]to=${destination.workspaceId}`, "u"));

  const preview = page.getByTestId("qcms-move-preview");
  await expect(preview).toContainText(`This form moves from ${source.name} to ${destination.name}`);

  const gains = page.getByTestId("qcms-move-gains");
  await expect(gains).toContainText("Gains access: 1 person");
  await expect(gains).toContainText(GAINER_NAME);
  await expect(gains).toContainText("Read responses");

  // The source's administrator and its response viewer both lose what the source gave them.
  const losses = page.getByTestId("qcms-move-losses");
  await expect(losses).toContainText("Loses access: 2 people");
  await expect(losses).toContainText(LOSER_NAME);

  // By name only: the address stands in for a blank name and is never sent beside one.
  await expect(preview).not.toContainText(GAINER);
  await expect(preview).not.toContainText(LOSER);
  // And nobody outside the two workspaces, however much they hold elsewhere.
  await expect(preview).not.toContainText(OUTSIDER_NAME);
});

test("a Workspace administrator of both moves the form, and the destination's list shows it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, MOVER, moverSecret);
  await openMove(page, appliedForm, destination.workspaceId);

  await panel(page)
    .getByRole("button", { name: `Move to ${destination.name}` })
    .click();
  await expect(
    panel(page).getByText(
      `This form moved to ${destination.name}. Recorded in both workspaces' audit.`,
    ),
  ).toBeVisible();

  expect(await workspaceOf(appliedForm)).toBe(destination.workspaceId);
  expect(await auditDetails(source.workspaceId, "setting")).toContain(
    `setting=form-moved-out to=${destination.workspaceId}`,
  );
  expect(await auditDetails(destination.workspaceId, "setting")).toContain(
    `setting=form-moved-in from=${source.workspaceId}`,
  );

  await page.goto("/forms");
  await switchWorkspace(page, destination.name);
  await expect(page.locator(`[data-form-id="${appliedForm}"]`)).toHaveCount(1);

  await switchWorkspace(page, source.name);
  await expect(page.locator(`[data-form-id="${appliedForm}"]`)).toHaveCount(0);
});

test("with Second approval on, the move waits for an Approver and the mover cannot decide it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await setWorkspaceSecondApproval(source.workspaceId, true);
  await signInWithTotp(page, MOVER, moverSecret);
  await openMove(page, heldForm, destination.workspaceId);

  const approval = page.getByTestId("qcms-move-approval");
  await expect(approval).toContainText("Needs an Approver");
  await expect(approval).toContainText(
    `Second approval is on in ${source.name}, so every move waits for someone other than the person moving it.`,
  );
  await expect(approval).toContainText(
    `a Workspace administrator of ${source.name} or a Site administrator`,
  );

  await panel(page).getByRole("button", { name: "Request move" }).click();
  await expect(panel(page).getByText("Waiting for an approver")).toBeVisible();
  expect(await workspaceOf(heldForm)).toBe(source.workspaceId);

  const held = await moveRequestFor(heldForm);
  expect(held.status).toBe("pending");

  await openWorkspaceAudit(page, source.workspaceId);
  const card = requestCard(page, held.requestId);
  await expect(card).toContainText(`${MOVER} asked to move a form out of this workspace.`);
  await expect(card).toContainText("You asked for this, so somebody else decides it.");
  await expect(card.getByRole("button", { name: /^Approve/u })).toHaveCount(0);
});

test("an Approver of the source applies the held move", async ({ page }) => {
  test.setTimeout(300_000);
  approverSecret = await enrollNewAdmin(page, APPROVER);
  const held = await moveRequestFor(heldForm);

  await openWorkspaceAudit(page, source.workspaceId);
  const card = requestCard(page, held.requestId);
  await expect(card).toContainText("Needs an Approver");
  await card.getByRole("button", { name: /^Approve/u }).click();

  await expect(
    page.getByTestId("qcms-workspace-requests").getByText("The request was approved and applied."),
  ).toBeVisible();
  expect(await workspaceOf(heldForm)).toBe(destination.workspaceId);
  await setWorkspaceSecondApproval(source.workspaceId, false);
});

test("a mover who administers neither workspace waits for an Approver", async ({ page }) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, EDITOR);
  await openMove(page, lapsedForm, destination.workspaceId);

  // The rule is off again, so this move waits only because the mover administers neither.
  await expect(page.getByTestId("qcms-move-approval")).toContainText(
    `You are not a Workspace administrator of ${source.name}, so this move waits for one.`,
  );
  await panel(page).getByRole("button", { name: "Request move" }).click();
  await expect(panel(page).getByText("Waiting for an approver")).toBeVisible();

  expect((await moveRequestFor(lapsedForm)).status).toBe("pending");
  expect(await workspaceOf(lapsedForm)).toBe(source.workspaceId);
});

test("the form leaves the source while that request is still waiting", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, MOVER, moverSecret);
  await openMove(page, lapsedForm, elsewhere.workspaceId);
  await panel(page)
    .getByRole("button", { name: `Move to ${elsewhere.name}` })
    .click();
  await expect(panel(page).getByText(`This form moved to ${elsewhere.name}`)).toBeVisible();

  expect(await workspaceOf(lapsedForm)).toBe(elsewhere.workspaceId);
  expect((await moveRequestFor(lapsedForm)).status).toBe("pending");
});

test("the Approver's decision lapses the move the form outran", async ({ page }) => {
  test.setTimeout(300_000);
  const held = await moveRequestFor(lapsedForm);
  await signInWithTotp(page, APPROVER, approverSecret);
  await openWorkspaceAudit(page, source.workspaceId);
  await requestCard(page, held.requestId)
    .getByRole("button", { name: /^Approve/u })
    .click();
  await expect(
    page.getByTestId("qcms-workspace-requests").getByText("The request was not approved"),
  ).toBeVisible();

  // Stored, not only reported: the request ends undecided and the form stays where it went.
  expect((await moveRequestFor(lapsedForm)).status).toBe("lapsed");
  expect(await workspaceOf(lapsedForm)).toBe(elsewhere.workspaceId);

  await page.reload();
  await waitForHydration(page);
  const decided = requestCard(page, held.requestId);
  await expect(decided).toContainText(
    "what the request asked for had moved, so nothing was applied",
  );
  await expect(decided.getByRole("button", { name: /^Approve/u })).toHaveCount(0);
});

test("the route refuses a move to the form's own workspace", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, MOVER, moverSecret);
  await openMove(page, ownWorkspaceForm);
  await expect(panel(page)).toContainText("Only workspaces where you hold Edit forms are listed.");

  const response = await fetch(
    `${API_BASE_URL}/admin/forms/${encodeURIComponent(ownWorkspaceForm)}/workspace`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": FIXED_INTERNAL_TOKEN,
        "x-qcms-admin-session": await sessionTokenOf(MOVER),
        "x-qcms-environment": "prod",
      },
      body: JSON.stringify({ workspaceId: source.workspaceId }),
    },
  );
  expect(response.status).toBe(409);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("MOVE_SAME_WORKSPACE");

  expect(await workspaceOf(ownWorkspaceForm)).toBe(source.workspaceId);
  expect(await auditDetails(source.workspaceId, "setting")).not.toContain(
    `setting=form-moved-out to=${source.workspaceId}`,
  );
});
