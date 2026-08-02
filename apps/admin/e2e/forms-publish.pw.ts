import type { Page, Request } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  issue,
  pinQuestion,
  rule,
  ruleIds,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft, fillDate, optionIds } from "./support/questions.js";

/**
 * Publish, preview, version history and secure links, driven through the browser
 * (task 034, exit criteria 1, 2 and 4).
 *
 * ## Why one journey rather than four specs
 *
 * The four screens are one authoring loop and they depend on each other's output: there is
 * nothing to look at in history until a publish has frozen something, and nothing to mint a
 * link for until a version exists. Splitting them would mean four builds of the same form,
 * which is the slowest part of the run and proves nothing extra. So the form is built once,
 * through the UI, and then walked: publish it, preview it, look at what was frozen, hand
 * out a link, take one back.
 *
 * ## The rule is inside one step, on purpose
 *
 * The wireframe's preview sketch shows the follow-up appearing *beside* the question that
 * revealed it, and that is the interesting case: within one step the reveal is visible
 * without any navigation, so a branch that fails to appear cannot be mistaken for a step
 * that has not been reached. It is also the arrangement ADR-16's forward pass makes
 * meaningful, since the target sits after the question the condition reads.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("publish");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

const AT_FAULT = `e2e-pub-at-fault-${RUN}`;
const ACCIDENT_COUNT = `e2e-pub-accident-count-${RUN}`;
const CLAIM_NOTES = `e2e-pub-claim-notes-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/**
 * The labels `createDraft` gives each question, which is what the renderer shows.
 *
 * The preview and the history view are rendered A2UI, so every assertion about what is on
 * screen there is about a *label*, never about an id: an id is authoring vocabulary and a
 * respondent never sees one.
 */
const AT_FAULT_LABEL = "E2E Single choice question";
const COUNT_LABEL = "E2E Number question";
const NOTES_LABEL = "E2E Long text question";
/** The two options `createDraft` mints for a choice question, by label. */
const YES_LABEL = "Yes, always";
const NO_LABEL = "No, never";

let atFaultYesOption = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Author one question and publish v1. */
async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

/** Every request the browser made to the draft-preview endpoint, for exit criterion 4. */
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

  formId = await createForm(page, `e2e-pub-insurance-${RUN}`, "Vehicle insurance");

  await addStep(page, "Driving history");
  await pinQuestion(page, questionIdFor(AT_FAULT), 1);
  await pinQuestion(page, questionIdFor(ACCIDENT_COUNT), 1);

  await addStep(page, "Claim details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", atFaultYesOption);
  await toggleTarget(page, ruleId, questionIdFor(ACCIDENT_COUNT), true);
  await waitForSaved(page);

  // Publish freezes the draft the SERVER holds, and the confirmation's counts are read
  // from that same stored draft. Reloading first is not a workaround for that, it is the
  // assertion: what is about to be frozen is what a fresh read of the API returns.
  await page.reload();
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  // The confirmation reads the author's own work back to them: what freezes, what
  // happens to sessions already under way (R1), and what the next edit does.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("qcms-freeze-summary")).toHaveText(
    "Freezes 2 steps, 3 pinned questions, 1 rules.",
  );
  await expect(dialog).toContainText("finish on the version they started");

  await dialog.getByRole("button", { name: "Publish v1" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "View version history" })).toBeVisible();
});

test("walks the draft's branches in the shared renderer (exit criterion 1)", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/preview`);

  await expect(page.getByTestId("qcms-preview-banner")).toHaveText("Preview - not published");
  const preview = page.getByTestId("qcms-draft-preview");
  await expect(preview.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 30_000 });

  // The follow-up is hidden until the condition matches: the API's forward pass says so,
  // and the pane projects the compiled document onto that answer with the portal's own
  // `documentForVisible`.
  await expect(preview.getByText(COUNT_LABEL)).toHaveCount(0);

  await preview.getByText(YES_LABEL, { exact: true }).click();
  await expect(preview.getByText(COUNT_LABEL)).toBeVisible({ timeout: 30_000 });

  // And it goes away again, so the reveal is a statement about the answers rather than a
  // latch the pane got stuck in.
  await preview.getByText(NO_LABEL, { exact: true }).click();
  await expect(preview.getByText(COUNT_LABEL)).toHaveCount(0, { timeout: 30_000 });

  // Reset clears the walk without reloading, and the second step is reachable.
  await page.getByRole("button", { name: "Reset answers" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(preview.getByText(NOTES_LABEL)).toBeVisible({ timeout: 30_000 });
});

test("history renders the stored compiled document and never previews (exit criterion 4)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  const previewCalls = watchPreviewCalls(page);
  await page.goto(`/forms/${formId}/versions`);

  const table = page.getByRole("grid", { name: "Published versions" });
  await expect(table).toBeVisible();
  await expect(table).toContainText("v1");

  await page.getByRole("link", { name: "View v1" }).click();
  await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qcms-version-stored")).toContainText("stored with v1");
  await expect(page.getByTestId("qcms-version-view").getByText(AT_FAULT_LABEL)).toBeVisible();

  // Exit criterion 4, stated as a network fact: a history page reads the audit copy
  // (ADR-18). If it ever recompiled, this is where it would show.
  expect(previewCalls, "history must not compile anything").toEqual([]);
});

test("a refused publish lists every issue and each one moves focus (exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  // Break the draft the way an author breaks it: point the rule at the question its own
  // condition reads, which the forward pass cannot honour (ADR-16).
  const ruleId = (await ruleIds(page))[0] ?? "";
  expect(ruleId).toMatch(/^rul_/u);
  await toggleTarget(page, ruleId, questionIdFor(AT_FAULT), true);
  await waitForSaved(page);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /^Publish v/ }).click();

  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  await expect(issue(rejected, "RULE_BACKWARD_TARGET")).toBeVisible();

  // Each entry is a link into the builder: activating it puts the author's focus on the
  // rule that caused the refusal, which is what the structured `path` is for.
  await issue(rejected, "RULE_BACKWARD_TARGET").click();
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused, "the issue link should focus its rule").toContain(ruleId);

  // Nothing was frozen: the version list is still what it was before the attempt.
  await page.goto(`/forms/${formId}/versions`);
  await expect(page.getByRole("link", { name: "View v2" })).toHaveCount(0);

  // Leave the draft publishable again for whatever runs next.
  await page.goto(`/forms/${formId}`);
  await toggleTarget(page, (await ruleIds(page))[0] ?? "", questionIdFor(AT_FAULT), false);
  await waitForSaved(page);
});

test("mints, copies, exports and revokes a secure link (exit criterion 1)", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/links`);

  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();
  await page.getByRole("button", { name: "Mint links" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await fillDate(page, "Expires", "12312030");
  await dialog.getByRole("checkbox", { name: /One-time/ }).click();
  const count = dialog.getByRole("textbox", { name: "How many" });
  await count.click();
  await count.fill("2");
  await dialog.getByRole("button", { name: "Mint", exact: true }).click();

  // The one moment the URLs exist: the API stores a link's state and never its token.
  const minted = page.getByTestId("qcms-minted-links");
  await expect(minted).toBeVisible({ timeout: 30_000 });
  await expect(minted.getByRole("heading", { name: "2 links minted" })).toBeVisible();
  await expect(minted).toContainText("cannot be shown again");

  await minted.getByRole("button", { name: "Copy URL" }).first().click();
  await expect(page.getByText("Link copied to the clipboard.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard, "the copied value should be a link URL").toContain("/l/");

  const download = page.waitForEvent("download");
  await minted.getByRole("button", { name: "Download as CSV" }).click();
  expect((await download).suggestedFilename()).toContain("links.csv");

  await minted.getByRole("button", { name: "Done" }).click();
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
});

test("closes the form to new sessions and reopens it (deliverable: close/reopen)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  await page.getByRole("button", { name: "Close form" }).click();
  const dialog = page.getByRole("alertdialog");
  // R1 taught in the copy: closing is about sessions that have not started.
  await expect(dialog).toContainText("Sessions already under way keep going");
  await dialog.getByRole("button", { name: "Close it" }).click();

  await expect(page.getByTestId("qcms-form-closed")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Reopen form" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen it" }).click();
  await expect(page.getByTestId("qcms-form-closed")).toHaveCount(0, { timeout: 30_000 });
});
