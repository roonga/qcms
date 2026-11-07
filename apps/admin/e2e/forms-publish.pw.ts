import type { Download, Locator, Page, Request } from "@playwright/test";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import {
  TEST_ENVIRONMENT_STORAGE,
  chooseEnvironment,
  environmentChip,
  presetEnvironment,
} from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { domShape, headingTags, withDemotedHeadings } from "./support/dom-shape.js";
import { activeElementId, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  issue,
  issueSummary,
  openStep,
  pinQuestion,
  usePinRowMenu,
  rule,
  ruleIds,
  savedStamp,
  toggleCheckbox,
  toggleTarget,
  validationPanel,
  waitForSaveAfter,
  closeRuleEditor,
  openFormDetails,
  openRules,
} from "./support/forms.js";
import {
  chooseDestination,
  chooseSource,
  openPublishWizard,
  refuseDraftThroughWizard,
  releaseThroughWizard,
} from "./support/publish.js";
import { confirmLifecycle, createDraft, fillDate, optionIds } from "./support/questions.js";

// Keep the reveal rule within one step and after its condition so missing output cannot be mistaken for an unreached step.

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("publish");

let totpSecret = "";

// Ids cannot be reused, and the harness database survives local reruns.
const RUN = Date.now().toString(36);

const AT_FAULT = `e2e-pub-at-fault-${RUN}`;
const ACCIDENT_COUNT = `e2e-pub-accident-count-${RUN}`;
const CLAIM_NOTES = `e2e-pub-claim-notes-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const AT_FAULT_LABEL = "E2E Single choice question";
const COUNT_LABEL = "E2E Number question";
const NOTES_LABEL = "E2E Long text question";

const YES_LABEL = "Yes, always";
const NO_LABEL = "No, never";

let atFaultYesOption = "";
let formId = "";

const FORM_SLUG = `e2e-pub-insurance-${RUN}`;

const FORM_TITLE = "Vehicle insurance";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function watchPreviewCalls(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request: Request) => {
    if (request.url().includes("/draft/preview")) seen.push(request.url());
  });
  return seen;
}

test("publishes a draft and reports what it froze (exit criterion 1)", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await publishQuestion(page, AT_FAULT, "Single choice");
  const options = await optionIds(page);
  atFaultYesOption = options[0] ?? "";
  expect(atFaultYesOption, "the choice question should carry minted option ids").toMatch(/^opt_/u);

  await publishQuestion(page, ACCIDENT_COUNT, "Number");
  await publishQuestion(page, CLAIM_NOTES, "Long text");

  formId = await createForm(page, FORM_SLUG, FORM_TITLE);

  await addStep(page, "Driving history");
  await pinQuestion(page, questionIdFor(AT_FAULT), 1);
  await pinQuestion(page, questionIdFor(ACCIDENT_COUNT), 1);

  await addStep(page, "Claim details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  // Settle the prior pin save before capturing the baseline: it must not satisfy the later rule-save wait.
  // The buffered wizard changes the draft only when Save is pressed.
  const beforeRule = await savedStamp(page);
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", atFaultYesOption);
  await toggleTarget(page, ruleId, questionIdFor(ACCIDENT_COUNT), true);

  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeRule);

  // Reload the server-held draft before publishing so the frozen definition is the one actually persisted.
  await openPublishWizard(page, formId);
  await chooseSource(page, "The shared draft");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, "test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const review = page.getByTestId("qcms-publish-review");
  await expect(review).toBeVisible();
  await expect(page.getByTestId("qcms-freeze-summary")).toHaveText(
    "Freezes 2 steps, 3 pinned questions, 1 rule.",
  );
  await expect(review).toContainText("test");

  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toContainText("Version 1 is published.", { timeout: 30_000 });

  await presetEnvironment(page, "prod");
  await result.getByRole("button", { name: "Open test operations", exact: true }).click();
  await page.waitForURL("**/operations");
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");
});

test("releases a published version to an environment and records it (task 065)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(`/forms/${formId}/releases`);
  await page.waitForURL(`**/forms/${formId}/versions`);
  await chooseEnvironment(page, "prod");
  await expect(page.locator("h1").first()).toHaveText("Versions");

  const now = page.getByTestId("qcms-released-now");
  await expect(now.locator('tr[data-environment="prod"]')).toContainText("Nothing released");
  await expect(now.locator('tr[data-environment="test"]')).toContainText("v1");

  await page.getByTestId("qcms-publish-entry").click();
  await page.waitForURL(`**/forms/${formId}/publish`);
  await releaseThroughWizard(page, { formId, version: 1, environment: "prod" });

  await page.goto(`/forms/${formId}/versions`);
  await expect(now.locator('tr[data-environment="prod"]')).toContainText("v1");

  await expect(now.locator('tr[data-environment="test"]')).toContainText("v1");

  const history = page.getByTestId("qcms-release-history");
  await expect(history.locator('tr[data-environment="prod"]')).toContainText("v1");
  await expect(history.locator('tr[data-rollback="true"]')).toHaveCount(0);

  await expect(history).not.toContainText(ISO_TIMESTAMP);

  const versions = page.getByRole("table", { name: "Published versions" });
  await expect(versions.locator('tr[data-form-version="1"]')).toContainText("prod");
  await expect(versions.locator('tr[data-form-version="1"] td[data-available-in]')).toContainText(
    "prod",
  );

  const filter = page.getByTestId("qcms-history-filter");
  await expect(filter.getByRole("radio", { name: "Every version" })).toBeChecked();
  await filter.getByRole("radio", { name: "Released anywhere" }).check();
  await expect(versions.locator('tr[data-form-version="1"]')).toBeVisible();
});

test("walks the draft's branches in the shared renderer (exit criterion 1)", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/preview`);

  await expect(page.getByTestId("qcms-preview-banner")).toHaveText("Preview - not published");
  const preview = page.getByTestId("qcms-draft-preview");
  await expect(preview.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 30_000 });

  await expect(preview.getByText(COUNT_LABEL)).toHaveCount(0);

  await preview.getByText(YES_LABEL, { exact: true }).click();
  await expect(preview.getByText(COUNT_LABEL)).toBeVisible({ timeout: 30_000 });

  await preview.getByText(NO_LABEL, { exact: true }).click();
  await expect(preview.getByText(COUNT_LABEL)).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: "Reset answers" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(preview.getByText(NOTES_LABEL)).toBeVisible({ timeout: 30_000 });
});

test("the preview's step DOM deep-matches the portal's (exit criterion 3)", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  // Compare the portal and preview from the same definition and answers; both use the shared renderer.
  // Normalise only deliberate embed differences so a rendering divergence remains visible.

  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);
  await expect(portal.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 60_000 });
  await waitForReactAttached(portal);
  const respondent = await domShape(rendererRoot(portal));
  await portal.close();

  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  await expect(surface.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 60_000 });
  const author = await domShape(surface.locator("form").first());

  expect(author.children.length, "the preview should render controls").toBeGreaterThan(0);

  const respondentHeadings = headingTags(respondent);
  expect(respondentHeadings.length, "the compiled step should carry headings").toBeGreaterThan(0);
  expect(headingTags(author), "the embedded preview demotes by exactly one level").toEqual(
    headingTags(withDemotedHeadings(respondent, 1)),
  );
  expect(headingTags(author), "an embedded document must not claim the page").not.toContain("h1");

  expect(author).toEqual(withDemotedHeadings(respondent, 1));
});

test("history renders the stored compiled document and never previews (exit criterion 4)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const previewCalls = watchPreviewCalls(page);
  await page.goto(`/forms/${formId}/versions`);

  const table = page.getByRole("table", { name: "Published versions" });
  await expect(table).toBeVisible();
  await expect(table).toContainText("v1");

  await expect(table).not.toContainText(ISO_TIMESTAMP);

  await expect(page.locator("h1").first()).toHaveText("Versions");
  await expect(
    page.locator("h1").first(),
    "the form's name is the rail Header's job",
  ).not.toContainText(FORM_SLUG);

  await page.getByRole("link", { name: "View v1" }).click();
  await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("h1").first()).toHaveText("Version 1");

  await expect(
    page.getByRole("heading", { level: 1 }),
    "an embedded document must not claim the page",
  ).toHaveCount(1);
  const versionView = page.getByTestId("qcms-version-view");
  await expect(versionView.locator("h1")).toHaveCount(0);

  expect(await versionView.locator("h2").count()).toBeGreaterThan(0);

  await expect(versionView.locator('[aria-label="Breadcrumb"]')).toHaveCount(0);
  const rail = page.getByTestId("qcms-rail");
  await expect(rail).toContainText(FORM_TITLE);
  await expect(rail.getByRole("link", { name: "All forms", exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: /^Version 1$|^Viewing v1$/u })).toHaveCount(1);

  await expect(page.getByTestId("qcms-version-stored")).toContainText("stored with v1");
  await expect(page.getByTestId("qcms-version-view").getByText(AT_FAULT_LABEL)).toBeVisible();

  expect(previewCalls, "history must not compile anything").toEqual([]);
});

test("a refused publish lists every issue and each one moves focus (exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  expect(ruleId).toMatch(/^rul_/u);
  await openStep(page, "Driving history");
  const beforeBreak = await savedStamp(page);
  await usePinRowMenu(page, questionIdFor(ACCIDENT_COUNT), "moveUp");

  await waitForSaveAfter(page, beforeBreak);

  await openFormDetails(page);
  const rejected = validationPanel(page);
  await expect(issue(rejected, "RULE_BACKWARD_TARGET")).toBeVisible({ timeout: 30_000 });

  const entry = issue(rejected, "RULE_BACKWARD_TARGET");
  await expect(entry, "the rule's entry carries the route, not a bare fragment").toHaveAttribute(
    "href",
    `/forms/${formId}/rules#rule-${ruleId}`,
  );
  await entry.click();
  await expect(page).toHaveURL(`/forms/${formId}/rules#rule-${ruleId}`);
  // Poll focus after arrival: the route's focus effect runs after its first paint.
  await expect(async () => {
    const focused = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(focused, "the issue link should focus its rule on the rules screen").toBe(
      `rule-${ruleId}`,
    );
  }).toPass({ timeout: 30_000 });

  await refuseDraftThroughWizard(page, { formId, environment: "test" });
  await expect(page.getByTestId("qcms-publish-rejected")).toContainText(
    /issues? blocks? publishing/u,
  );

  await expect(page.getByRole("link", { name: "Open the builder", exact: true })).toHaveAttribute(
    "href",
    `/forms/${formId}`,
  );

  await page.goto(`/forms/${formId}/versions`);
  await expect(page.getByRole("link", { name: "View v2" })).toHaveCount(0);

  await page.goto(`/forms/${formId}/preview`);
  await expect(page.getByTestId("qcms-preview-rejected")).toBeVisible({ timeout: 60_000 });
  const previewStatus = page.getByTestId("qcms-preview-status");
  await expect(previewStatus).toBeAttached();
  await expect(previewStatus).toHaveAttribute("aria-live", "polite");
  await expect(previewStatus).toContainText("Preview unavailable");
  await expect(previewStatus.getByTestId("qcms-preview-rejected")).toHaveCount(0);

  await page.goto(`/forms/${formId}`);
  await openStep(page, "Driving history");
  const beforeFix = await savedStamp(page);
  await usePinRowMenu(page, questionIdFor(AT_FAULT), "moveUp");
  await waitForSaveAfter(page, beforeFix);
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.", {
    timeout: 30_000,
  });
});

test("mints, copies, exports and revokes a secure link (exit criterion 1)", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/links`);
  await chooseEnvironment(page, "prod");

  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();
  await page.getByRole("button", { name: "Mint links" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await expect(dialog).toContainText("UTC");
  await fillDate(page, "Expires", "12312030");

  await toggleCheckbox(page, "One-time (stops working after the first use)", true);
  const count = dialog.getByRole("textbox", { name: "How many" });
  await count.click();
  await count.fill("2");
  await dialog.getByRole("button", { name: "Mint for prod", exact: true }).click();

  const minted = page.getByTestId("qcms-minted-links");
  await expect(minted).toBeVisible({ timeout: 30_000 });
  await expect(minted.getByRole("heading", { name: "2 links minted" })).toBeVisible();
  await expect(minted).toContainText("cannot be shown again");

  // Poll focus after the mint dialog closes: React Aria restores focus a frame after the panel mounts.
  // The one-time URLs must remain reachable after that restoration.
  await expect
    .poll(() => activeElementId(page), {
      message: "a successful mint should land the operator on the panel it just made",
      timeout: 10_000,
    })
    .toBe("qcms-minted-heading");

  const linksStatus = page.getByTestId("qcms-links-status");
  await expect(linksStatus).toBeAttached();

  await expect(linksStatus).toHaveAttribute("aria-live", "polite");
  await expect(linksStatus).toContainText("2 secure links minted");
  // Keep token URLs out of live announcements; only the outcome sentence should be spoken.
  await expect(linksStatus).not.toContainText("/l/");
  await expect(linksStatus.getByTestId("qcms-minted-links")).toHaveCount(0);

  await minted.getByRole("button", { name: "Copy URL" }).first().click();
  await expect(page.getByText("Link copied to the clipboard.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard, "the copied value should be a link URL").toContain("/l/");

  const download = page.waitForEvent("download");
  await minted.getByRole("button", { name: "Download as CSV" }).click();
  const csvFile = await download;
  expect(csvFile.suggestedFilename()).toContain("links.csv");

  // Read downloaded bytes to prove the blob transferred. Chromium can still pass with synchronous revocation,
  // so this browser check does not establish the object-URL revocation timing.
  const csv = await readDownload(csvFile);
  expect(csv).toContain('"linkId","url","expiresAt"');
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv).toContain("/l/");

  await minted.getByRole("button", { name: "Done" }).click();

  await expect
    .poll(() => activeElementId(page), { message: "focus should leave the dismissed panel" })
    .not.toBe("qcms-minted-heading");
  await expect(page.getByRole("button", { name: "Mint links" })).toBeFocused();

  const table = page.getByTestId("qcms-links-table");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByText("Active").first()).toBeVisible();

  await table.getByRole("button", { name: "Revoke" }).first().click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("finishes normally");
  await confirm.getByRole("button", { name: "Revoke it" }).click();
  await expect(page.getByText("That link is revoked.")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible();

  await expect(page.getByTestId("qcms-links-table")).not.toContainText(ISO_TIMESTAMP);
});

test("closes the form to new sessions and reopens it (deliverable: close/reopen)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/availability`);
  await chooseEnvironment(page, "prod");

  await page.getByRole("button", { name: "Close to new responses in prod" }).click();
  const dialog = page.getByRole("alertdialog");

  await expect(dialog).toContainText("finish on the version they started on");

  await expect(dialog).toContainText("Every other environment is unaffected");
  await dialog.getByRole("button", { name: "Close it in prod" }).click();

  await expect(page.getByTestId("qcms-form-closed")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Reopen in prod" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen it in prod" }).click();
  await expect(page.getByTestId("qcms-form-closed")).toHaveCount(0, { timeout: 30_000 });
});

// Read the last form inside the step card: hydration replaces the fallback, and the header has its own form.
function rendererRoot(page: Page): Locator {
  return page.getByTestId("step-card").locator("form").last();
}

// Probe the same rendered-step form used for comparison. The header can hydrate while the step is still fallback.
// React's __reactFiber property proves attachment to that node.
async function waitForReactAttached(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="step-card"] form');
    const form = forms[forms.length - 1];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
}

// Reading the completed stream also waits for transfer; the download event alone cannot prove intact bytes.
async function readDownload(file: Download): Promise<string> {
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}
