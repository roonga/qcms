import type { Page } from "@playwright/test";

import { openDbHandle } from "../../api/e2e/support/index.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";
import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { waitForHydration as waitForPortalHydration } from "../../portal/e2e/support/hydration.js";
import { answerPosted, fillText } from "../../portal/e2e/support/kitchen-sink.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, openMenu } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  closeRuleEditor,
  createForm,
  pinQuestions,
  rule,
  savedStamp,
  toggleTarget,
  waitForSaveAfter,
} from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft, fillDate, optionIds } from "./support/questions.js";

/** One UI journey, independent of forms-publish's serial fixtures: draft -> test -> prod. */
const EMAIL = uniqueAdminEmail("promotion");
const RUN = Date.now().toString(36);
const CHOICE_SLUG = `e2e-promotion-choice-${RUN}`;
const DETAILS_SLUG = `e2e-promotion-details-${RUN}`;
const FORM_SLUG = `e2e-promotion-${RUN}`;
const CHOICE_ID = `q_${CHOICE_SLUG.replaceAll("-", "_")}`;
const DETAILS_ID = `q_${DETAILS_SLUG.replaceAll("-", "_")}`;
const DETAILS_LABEL = "E2E Short text question";
const PORTAL_ORIGIN = `http://localhost:${String(PORTAL_PORT)}`;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function chooseEnvironment(page: Page, environment: "test" | "prod"): Promise<void> {
  const switcher = page.getByTestId("qcms-environment-switcher");
  await openMenu(switcher.getByRole("button"));
  await page.getByRole("menuitemradio", { name: environment, exact: true }).click();
  await expect(switcher).toHaveAttribute("data-pending", "false");
  await expect(switcher).toHaveAttribute("data-environment", environment);
}

async function releaseVersion(page: Page, environment: "test" | "prod"): Promise<void> {
  await waitForHydration(page);
  await page.getByRole("button", { name: "Release a version…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: /Environment$/u })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", {
      name: environment === "test" ? "Release to prod" : "Release to test",
      exact: true,
    }),
  ).toHaveCount(0);
  await chooseOption(dialog, "Version to release", "v1");
  await expect(dialog).toContainText("This version was released to test.");
  await dialog.getByRole("button", { name: `Release v1 to ${environment}`, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("qcms-release-status")).toContainText(
    `v1 is now released to ${environment}.`,
  );
}

/** Check both rule outcomes, submit, and retain the session id for independent DB checks. */
async function completeForm(page: Page, environment: "test" | "prod"): Promise<string> {
  const prefix = environment === "test" ? "/test" : "";
  await page.waitForURL(new RegExp(`${prefix}/s/ses_[^/]+$`, "u"));
  expect(new URL(page.url()).pathname).toMatch(new RegExp(`^${prefix}/s/ses_[^/]+$`, "u"));
  const sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await waitForPortalHydration(page);
  const details = page.getByRole("textbox", { name: DETAILS_LABEL });
  await expect(details).toHaveCount(0);

  for (const answer of ["Yes, always", "No, never", "Yes, always"]) {
    const recorded = answerPosted(page);
    await page.getByText(answer, { exact: true }).click();
    const response = await recorded;
    expect(new URL(response.url()).pathname).toBe(`${prefix}/s/${sessionId}/answers`);
    await expect(details).toHaveCount(answer === "No, never" ? 0 : 1);
  }

  await fillText(page, DETAILS_LABEL, `Verified in ${environment}`);
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(new RegExp(`${prefix}/done$`, "u"));
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/u);
  return sessionId;
}

test("publishes a draft, verifies it in test, then promotes the same version to prod", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, EMAIL);

  await createDraft(page, CHOICE_SLUG, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/u, "Publish");
  const yesOption = (await optionIds(page))[0] ?? "";
  expect(yesOption).toMatch(/^opt_/u);
  await createDraft(page, DETAILS_SLUG, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/u, "Publish");

  await chooseEnvironment(page, "test");
  const formId = await createForm(page, FORM_SLUG, "Promotion journey");
  await addStep(page, "Your details");
  await pinQuestions(page, [
    { questionId: CHOICE_ID, version: 1 },
    { questionId: DETAILS_ID, version: 1 },
  ]);
  const beforeRule = await savedStamp(page);
  const ruleId = await addRule(page);
  await chooseOption(rule(page, ruleId), "Operator", "equals (the whole answer)");
  await chooseOption(rule(page, ruleId), "Value", yesOption);
  await toggleTarget(page, ruleId, DETAILS_ID, true);
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeRule);

  await page.goto(`/forms/${formId}/preview`);
  await expect(page.getByTestId("qcms-preview-banner")).toHaveText("Preview - not published");
  await expect(
    page.getByTestId("qcms-draft-preview").getByText("E2E Single choice question"),
  ).toBeVisible();

  await page.goto(`/forms/${formId}`);
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish to test", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Publish to test", exact: true })
    .click();
  await expect(page.getByText("Published as v1 and released to test.")).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/forms/${formId}/releases`);
  const released = page.getByTestId("qcms-released-now");
  await expect(released.locator('tr[data-environment="test"]')).toContainText("v1");
  await expect(released.locator('tr[data-environment="prod"]')).toContainText("Nothing released");
  await page.getByRole("button", { name: "Release a version…" }).click();
  await expect(
    page.getByRole("alertdialog").getByRole("button", { name: "Release to prod", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("alertdialog").getByRole("button", { name: /Environment$/u }),
  ).toHaveCount(0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();

  // Non-prod has no anonymous entry: mint a real environment-scoped link through admin.
  await page.goto(`/forms/${formId}/links`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Mint links", exact: true }).click();
  await fillDate(page, "Expires", "12312030");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mint for test", exact: true })
    .click();
  const minted = page.getByTestId("qcms-minted-links");
  await expect(minted).toBeVisible();
  const testLink = new URL(await minted.locator("code").innerText());
  expect(testLink.pathname).toMatch(/^\/test\/l\//u);
  // The API fixture uses an example public host; exercise its minted path on the harness portal.
  await page.goto(`${PORTAL_ORIGIN}${testLink.pathname}`);
  const testSession = await completeForm(page, "test");

  // Return to admin on the same gated page. Promotion selects the tested v1 explicitly.
  await page.goto(`/forms/${formId}/releases`);
  await expect(released.locator('tr[data-environment="prod"]')).toContainText("Nothing released");
  await chooseEnvironment(page, "prod");
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-published-form-review")).toBeVisible();
  await expect(page.getByRole("button", { name: /Publish/u })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await page.goto(`/forms/${formId}/releases`);
  await releaseVersion(page, "prod");
  for (const environment of ["test", "prod"]) {
    await expect(released.locator(`tr[data-environment="${environment}"]`)).toContainText("v1");
  }
  const history = page.getByTestId("qcms-release-history");
  await expect(history.locator("tbody tr")).toHaveCount(2);
  const promotion = history.locator('tr[data-environment="prod"][data-version="1"]');
  await expect(promotion.locator("td").nth(3)).toHaveText("test");
  await page.goto(`/forms/${formId}/versions`);
  const versions = page.getByRole("table", { name: "Published versions" });
  await expect(versions.locator("tbody tr")).toHaveCount(1);
  await expect(versions.locator('tr[data-form-version="1"]')).toContainText("test");
  await expect(versions.locator('tr[data-form-version="1"]')).toContainText("prod");

  await page.goto(`${PORTAL_ORIGIN}/f/${FORM_SLUG}`);
  await page.getByRole("button", { name: "Start" }).click();
  const prodSession = await completeForm(page, "prod");

  const db = openDbHandle(readFixtures().databaseUrl);
  try {
    for (const [environment, sessionId] of [
      ["test", testSession],
      ["prod", prodSession],
    ] as const) {
      const result = await db.query<{
        form_id: string;
        form_version: number;
        content_hash: string;
      }>(
        `select s.form_id, s.form_version, sub.content_hash
         from data_${environment}.sessions s
         join data_${environment}.submissions sub using (session_id)
         where s.session_id = $1`,
        [sessionId],
      );
      expect(result.rows).toEqual([
        {
          form_id: formId,
          form_version: 1,
          content_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      ]);
    }
  } finally {
    await db.close();
  }
});
