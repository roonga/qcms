import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { openDbHandle } from "../../api/e2e/support/index.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { chooseSource } from "./support/publish.js";

test.describe.configure({ mode: "serial" });

const PROPOSER = uniqueAdminEmail("twoperson-proposer");

const APPROVER = uniqueAdminEmail("twoperson-approver");

const WORKSPACE_ID = "org_default_workspace";

const FORM_ID = "frm_auto_quote";

const AGREED_URL = "https://agreed-consumer.example/qcms-hook";
const WITHDRAWN_URL = "https://withdrawn-consumer.example/qcms-hook";

let proposerSecret = "";
let approverSecret = "";

let proposalId = "";

test.beforeAll(async () => {
  await createTestAdmin(PROPOSER);
  await createTestAdmin(APPROVER);
});

// Reset the shared switch even after failure: serial retries restart at the test that expects it off.
test.afterAll(async () => {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query(
      `update control."organization" set "requireSecondApprover" = false where id = $1`,
      [WORKSPACE_ID],
    );
    // Fail if no workspace row matched, or cleanup could report success while leaving the switch enabled.
    if (updated.rows.length === 0 && (updated as { rowCount?: number }).rowCount === 0) {
      throw new Error(`the two-person cleanup matched no workspace for ${WORKSPACE_ID}`);
    }
  } finally {
    await handle.close();
  }
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EXTRA_RULES = { "heading-order": { enabled: true } };

async function expectAxeClean(page: Page, state: string): Promise<void> {
  // Normalise scroll before axe hit-testing so the sticky bar does not transiently cover scrolled controls.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
    .analyze();
  expect(
    rulesNotRun(results, Object.keys(EXTRA_RULES)),
    `axe did not load these rules on the ${state} state`,
  ).toEqual([]);
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.help} [${v.nodes
          .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
          .join(" | ")}]`,
    ),
    `axe violations on the ${state} state`,
  ).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page, state: string): Promise<void> {
  const previous = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 320, height: 720 });
  try {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(
      overflow,
      `${state} overflows a 320px viewport by ${String(overflow)}px`,
    ).toBeLessThanOrEqual(0);
  } finally {
    await page.setViewportSize(previous);
  }
}

async function setTwoPersonSwitch(page: Page, on: boolean): Promise<void> {
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);
  const control = twoPersonControl(page);
  // Click the label: React Aria hides the checkbox input, so input-targeted actions cannot reach it.
  if ((await control.isChecked()) !== on) {
    await page.getByText("Require a second approver for production", { exact: true }).click();
  }
  await expect(control).toBeChecked({ checked: on });
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByText("the change is on the access audit", { exact: false })).toBeVisible();
}

function twoPersonControl(page: Page) {
  return page.getByRole("checkbox", {
    name: "Require a second approver for production",
    exact: true,
  });
}

function pendingPanel(page: Page) {
  return page.getByTestId("qcms-endpoint-proposals");
}

function endpointRowFor(page: Page, url: string) {
  return page.getByTestId("qcms-webhooks-table").locator("tr").filter({ hasText: url });
}

function pendingRow(page: Page) {
  return pendingPanel(page).locator(`tr[data-proposal="${proposalId}"]`);
}

test("the sign-in screen is served before anything types into it", async ({ page }) => {
  test.setTimeout(300_000);
  // Warm and hydrate sign-in before typing so dev-server compilation cannot replace the next test's document.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("the switch is off by default, and an owner turns it on through the panel", async ({
  page,
}) => {
  test.setTimeout(300_000);
  proposerSecret = await enrollNewAdmin(page, PROPOSER);

  await page.goto(`/workspaces/${WORKSPACE_ID}`);

  await expect(twoPersonControl(page)).not.toBeChecked();

  await setTwoPersonSwitch(page, true);

  await page.reload();
  await expect(twoPersonControl(page)).toBeChecked();
});

test("a prod endpoint change is stored waiting, and nothing is live", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, PROPOSER, proposerSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByTestId("qcms-webhook-url-dialog");
  await dialog.getByRole("textbox", { name: "Endpoint URL" }).fill(AGREED_URL);
  await dialog.getByRole("button", { name: "Create endpoint" }).click();

  await expect(page.getByTestId("qcms-webhook-pending")).toContainText(
    "Nothing has changed in prod yet",
  );

  await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible();
  await page.getByRole("button", { name: "I have copied it" }).click();

  await expect(pendingPanel(page)).toContainText(AGREED_URL);
  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(pendingPanel(page)).toContainText("Add this endpoint");

  // Assert absence by this URL: other specs' deactivated endpoints can still occupy the shared table.
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(0);

  proposalId =
    (await pendingPanel(page)
      .locator("tr")
      .filter({ hasText: AGREED_URL })
      .getAttribute("data-proposal")) ?? "";
  expect(proposalId, "the pending change owns a row").toMatch(/^wep_/u);

  await expectAxeClean(page, "pending endpoint change");
  await expectNoHorizontalScroll(page, "pending endpoint change");
});

test("the account that proposed it cannot confirm it, and is told why", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, PROPOSER, proposerSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  // Scope to the created proposal id so another spec's pending change cannot make Confirm ambiguous.
  await pendingRow(page).getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("You cannot confirm a change you proposed yourself");

  await expect(dialog.getByTestId("qcms-proposal-environment")).toContainText("In prod");

  await expect(dialog).toContainText("A new endpoint in prod starts receiving deliveries");

  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("qcms-proposal-status")).toContainText(
    "You proposed this change, so you cannot confirm it",
  );

  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(0);
});

test("a second approver confirms it, and the endpoint goes live", async ({ page }) => {
  test.setTimeout(300_000);
  approverSecret = await enrollNewAdmin(page, APPROVER);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  await pendingRow(page).getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(pendingPanel(page)).toHaveCount(0);
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(1);
});

test("either account can withdraw a waiting change, and the endpoint is untouched", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  const row = page.getByTestId("qcms-webhooks-table").locator("tr").filter({ hasText: AGREED_URL });
  await row.getByRole("button", { name: "Change URL" }).click();
  const retarget = page.getByTestId("qcms-webhook-url-dialog");
  await retarget.getByRole("textbox", { name: "Endpoint URL" }).fill(WITHDRAWN_URL);
  await retarget.getByRole("button", { name: "Save the URL" }).click();

  await expect(page.getByTestId("qcms-webhook-pending")).toBeVisible();
  await expect(pendingPanel(page)).toContainText(WITHDRAWN_URL);

  await expect(page.getByTestId("qcms-webhooks-table")).toContainText(AGREED_URL);

  await pendingPanel(page).getByRole("button", { name: "Withdraw" }).click();
  const dialog = page.getByRole("alertdialog");

  await expect(dialog).toContainText("left exactly as it is");
  await dialog.getByRole("button", { name: "Withdraw" }).click();

  await expect(pendingPanel(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-webhooks-table")).toContainText(AGREED_URL);
  expect(await page.content()).not.toContain(WITHDRAWN_URL);
});

test("the publish wizard carries the rule's notice with the switch on", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await page.goto(`/forms/${FORM_ID}/publish`);

  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();

  // Seeded versions have no publishing account, so they must show the unknown-author refusal.
  await expect(destinations.locator('span[data-code="APPROVER_UNKNOWN_AUTHOR"]')).toContainText(
    "was not recorded",
  );

  await expect(destinations.getByRole("checkbox", { name: "prod", exact: true })).toBeDisabled();

  await expectAxeClean(page, "the publish wizard under the two-person rule");
  await expectNoHorizontalScroll(page, "the publish wizard under the two-person rule");
});

test("the publish wizard says nothing about the rule once the switch is off", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await setTwoPersonSwitch(page, false);

  await page.goto(`/forms/${FORM_ID}/publish`);
  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();

  await expect(destinations.locator('span[data-code^="APPROVER_"]')).toHaveCount(0);
  // The seed already serves this version in prod; assert remaining blockers rather than requiring selectability.
  const prod = destinations.locator('div[data-environment="prod"]');
  await expect(prod.locator('span[data-testid="qcms-publish-blocker"]')).toHaveCount(1);
  await expect(prod.locator('span[data-code="ALREADY_RELEASED"]')).toBeVisible();
});
