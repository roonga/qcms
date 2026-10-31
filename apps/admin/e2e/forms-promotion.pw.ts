import type { Page } from "@playwright/test";

import { openDbHandle } from "../../api/e2e/support/index.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";
import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { waitForHydration as waitForPortalHydration } from "../../portal/e2e/support/hydration.js";
import { answerPosted, fillText } from "../../portal/e2e/support/kitchen-sink.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { enrollNewAdmin } from "./support/flow.js";
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
import {
  chooseDestination,
  openPublishWizard,
  publishDraftThroughWizard,
} from "./support/publish.js";
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

/**
 * Promote the tested v1 into one destination through the publish wizard (issue #1197).
 *
 * It asserts the two things the old release dialog asserted and the wizard still owes: the
 * destination is chosen here and not taken from the switcher, and a destination this
 * caller cannot release into is absent from the list rather than disabled.
 */
async function releaseVersion(
  page: Page,
  formId: string,
  environment: "test" | "prod",
): Promise<void> {
  await openPublishWizard(page, formId);
  await page.getByRole("radio", { name: "An existing version" }).check();
  await chooseOption(page.getByTestId("qcms-publish-source"), "Version to release", "v1");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, environment);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("Version 1 is released.");
  await expect(result.locator(`li[data-environment="${environment}"]`)).toBeVisible();
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
  // The builder offers no publish of its own at all (Code Owner, 2026-10-31): one entry,
  // and it is the way to the wizard.
  await expect(page.getByRole("button", { name: /^Publish/u })).toHaveCount(0);
  await expect(page.getByTestId("qcms-publish-entry")).toBeVisible();

  // A draft is frozen and released to test in one confirmation, and PROD IS REFUSED in the
  // same list: the default workflow forbids publishing a draft straight into production, so
  // the wizard lists prod disabled with that as the reason rather than omitting it or
  // letting the confirmation refuse it.
  await openPublishWizard(page, formId);
  await page.getByRole("radio", { name: "The shared draft" }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await expect(
    destinations.locator('div[data-environment="prod"][data-eligible="false"]'),
  ).toBeVisible();
  await expect(
    destinations.locator('div[data-environment="prod"] span[data-code="DRAFT_PUBLISH_NOT_ALLOWED"]'),
  ).toBeVisible();
  await expect(destinations.getByRole("checkbox", { name: "prod", exact: true })).toBeDisabled();
  // Cancelling writes nothing, which is the property the whole wizard is built around.
  // Back first, because leaving is offered on the step that has nothing behind it.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(`**/forms/${formId}/versions`);
  const released = page.getByTestId("qcms-released-now");
  await expect(released.locator('tr[data-environment="test"]')).toContainText("Nothing released");

  await publishDraftThroughWizard(page, { formId, version: 1, environment: "test" });
  await page.goto(`/forms/${formId}/versions`);
  await expect(released.locator('tr[data-environment="test"]')).toContainText("v1");
  await expect(released.locator('tr[data-environment="prod"]')).toContainText("Nothing released");

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
  await page.goto(`/forms/${formId}/versions`);
  await expect(released.locator('tr[data-environment="prod"]')).toContainText("Nothing released");
  await chooseEnvironment(page, "prod");
  await page.goto(`/forms/${formId}`);
  await expect(page.getByTestId("qcms-published-form-review")).toBeVisible();
  await expect(page.getByRole("button", { name: /Publish/u })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await page.goto(`/forms/${formId}/versions`);
  await releaseVersion(page, formId, "prod");
  // The wizard ends on its own recorded outcome, so the summary is read back on Versions.
  await page.goto(`/forms/${formId}/versions`);
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
