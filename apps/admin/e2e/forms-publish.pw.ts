import type { Download, Locator, Page, Request } from "@playwright/test";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { domShape } from "./support/dom-shape.js";
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
  saveState,
  toggleCheckbox,
  toggleTarget,
  waitForSaveAfter,
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
/** The form's slug, which is also the portal's entry path for it. */
const FORM_SLUG = `e2e-pub-insurance-${RUN}`;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Author one question and publish v1. */
async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

/** A raw API timestamp, which no operator-facing table may render (ADR-27). */
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

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

  formId = await createForm(page, FORM_SLUG, "Vehicle insurance");

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
    "Freezes 2 steps, 3 pinned questions, 1 rule.",
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

test("the preview's step DOM deep-matches the portal's (exit criterion 3)", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  /**
   * ## What is compared, and why it is the same document
   *
   * The form published above is one definition seen from two sides. The **portal** serves a
   * respondent the compiled documents stored at publish time (ADR-18), projected onto the
   * API's `visibleQuestions` and drawn by `A2UIStepRenderer`. The **admin preview** compiles
   * the same definition (the draft the API seeds back from the newest published version) and
   * draws it with the same projection and the same renderer.
   *
   * Same definition in, same compiler, same projection, same renderer. If those four are
   * genuinely shared the two DOM subtrees are identical, and this says so. Give the admin
   * its own renderer, its own projection, or its own compiler, and this is what fails -
   * which is the point, because a screenshot could not tell.
   *
   * ## Why not a screenshot
   *
   * The two apps legitimately differ in theme tokens, fonts and surrounding chrome (ADR-30,
   * and 034's preview is deliberately its own styling seam), so a pixel comparison would
   * fail for reasons that are not fidelity while still missing a swapped control that
   * happened to look similar. The comparison is of rendered *structure*: elements, classes,
   * semantic and state attributes and text, with generated ids normalized away
   * (`support/dom-shape.ts`).
   */

  // --- the respondent's side ------------------------------------------------
  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);
  await expect(portal.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 60_000 });
  await waitForReactAttached(portal);
  const respondent = await domShape(rendererRoot(portal));
  await portal.close();

  // --- the author's side ----------------------------------------------------
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  await expect(surface.getByText(AT_FAULT_LABEL)).toBeVisible({ timeout: 60_000 });
  const author = await domShape(surface.locator("form").first());

  // A sanity check first, so a failure below reads as a divergence rather than as two
  // empty trees agreeing with each other.
  expect(author.children.length, "the preview should render controls").toBeGreaterThan(0);
  expect(author).toEqual(respondent);
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
  // ADR-27: what an operator reads is a formatted date, never the wire representation.
  await expect(table).not.toContainText(ISO_TIMESTAMP);

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
  const beforeBreak = (await saveState(page).textContent()) ?? "";
  await toggleTarget(page, ruleId, questionIdFor(AT_FAULT), true);
  // Publish reads the STORED draft, so the wait is about the save landing rather than
  // about the validation panel agreeing (`waitForSaveAfter` records why).
  await waitForSaveAfter(page, beforeBreak);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();

  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  await expect(issue(rejected, "RULE_BACKWARD_TARGET")).toBeVisible();

  // The refusal is SPOKEN, which it was not before issue #377: the work list renders as a
  // sibling of the live region, so publish success and publish error announced and a
  // rejection did not. Three assertions, and they fail for three different reasons.
  const actionsStatus = page.getByTestId("qcms-form-actions-status");
  await expect(actionsStatus).toBeAttached();
  // The pin (#359, #368). Nothing else in the suite says this container is a live region,
  // and nothing can: axe has no rule requiring one to exist, and every content assertion
  // around it passes on a plain `<div>`. Selected by testid rather than by `[aria-live]`,
  // so deleting the attribute makes THIS line red instead of quietly matching nothing.
  await expect(actionsStatus).toHaveAttribute("aria-live", "polite");
  // The repair. Empty on `origin/main`, because the summary sentence did not exist.
  await expect(actionsStatus).toContainText("Publish blocked");
  // And the decision, asserted rather than merely commented: a summary announces, the work
  // list does not. If a later change moves the list inside the region to "fix" the same
  // defect a second time, this is what notices.
  await expect(actionsStatus.getByTestId("qcms-publish-rejected")).toHaveCount(0);

  // Each entry is a link into the builder: activating it puts the author's focus on the
  // rule that caused the refusal, which is what the structured `path` is for.
  await issue(rejected, "RULE_BACKWARD_TARGET").click();
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused, "the issue link should focus its rule").toContain(ruleId);

  // Nothing was frozen: the version list is still what it was before the attempt.
  await page.goto(`/forms/${formId}/versions`);
  await expect(page.getByRole("link", { name: "View v2" })).toHaveCount(0);

  // The same shape one screen over, checked while the draft is still broken (#377). A
  // preview refuses on the same compile as publish, and its work list sat outside its live
  // region for the same reason - which is why this is fixed once, in one shape, for all
  // three of the silent outcomes rather than three times by taste.
  await page.goto(`/forms/${formId}/preview`);
  await expect(page.getByTestId("qcms-preview-rejected")).toBeVisible({ timeout: 60_000 });
  const previewStatus = page.getByTestId("qcms-preview-status");
  await expect(previewStatus).toBeAttached();
  await expect(previewStatus).toHaveAttribute("aria-live", "polite");
  await expect(previewStatus).toContainText("Preview unavailable");
  await expect(previewStatus.getByTestId("qcms-preview-rejected")).toHaveCount(0);

  // Leave the draft publishable again for whatever runs next.
  await page.goto(`/forms/${formId}`);
  const restored = (await ruleIds(page))[0] ?? "";
  const beforeFix = (await saveState(page).textContent()) ?? "";
  await toggleTarget(page, restored, questionIdFor(AT_FAULT), false);
  await waitForSaveAfter(page, beforeFix);
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
  // The expiry promise names its zone where the promise is made. `endOfDay` widens the
  // chosen day to the end of that day in UTC, so an operator who is not on UTC would
  // otherwise be told a day and handed one up to fourteen hours away from it.
  await expect(dialog).toContainText("UTC");
  await fillDate(page, "Expires", "12312030");
  // The react-aria checkbox's real input sits under a decorative indicator that
  // intercepts pointer events, so the label is what gets clicked (`toggleCheckbox`).
  await toggleCheckbox(page, "One-time (stops working after the first use)", true);
  const count = dialog.getByRole("textbox", { name: "How many" });
  await count.click();
  await count.fill("2");
  await dialog.getByRole("button", { name: "Mint", exact: true }).click();

  // The one moment the URLs exist: the API stores a link's state and never its token.
  const minted = page.getByTestId("qcms-minted-links");
  await expect(minted).toBeVisible({ timeout: 30_000 });
  await expect(minted.getByRole("heading", { name: "2 links minted" })).toBeVisible();
  await expect(minted).toContainText("cannot be shown again");

  // The mint was the one outcome on this screen that announced nothing, because the panel
  // holding the URLs is a sibling of the live region (#377). Mint failure, revoke success,
  // revoke failure and the copy note all announced; the thing the operator had just made
  // did not.
  const linksStatus = page.getByTestId("qcms-links-status");
  await expect(linksStatus).toBeAttached();
  // Polite, decided rather than inherited: see the politeness note in `secure-links.tsx`.
  // The announcement is a summary, so the unrecoverable value is not what would be missed.
  await expect(linksStatus).toHaveAttribute("aria-live", "polite");
  await expect(linksStatus).toContainText("2 secure links minted");
  // A URL is never spoken from here. A token read aloud cannot be copied, and reading two
  // of them would bury the one sentence that says the panel is the only chance to.
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

  // Read the BYTES, not just the event: the deliverable promises a CSV of the minted
  // URLs, and the event fires whether or not the blob survived long enough to be
  // transferred.
  //
  // Stated honestly, because it was measured rather than assumed: this does NOT reproduce
  // the revoke-too-early race. Restoring the synchronous `URL.revokeObjectURL` and
  // re-running this whole spec still passes, because Chromium wins that race - which is
  // precisely why the bug reached review. The race is real in other engines and this suite
  // is Chromium-only, so the fix stands on the platform contract rather than on this
  // assertion. What this does buy is the property itself: a truncated or empty export from
  // ANY cause fails here, where checking only the event would not notice.
  const csv = await readDownload(csvFile);
  expect(csv).toContain('"linkId","url","expiresAt"');
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv).toContain("/l/");

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
  // Same ADR-27 assertion as the history table. The CSV downloaded above deliberately
  // keeps ISO: that is a machine artifact, and a spreadsheet wants it.
  await expect(page.getByTestId("qcms-links-table")).not.toContainText(ISO_TIMESTAMP);
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

/**
 * The portal's rendered step: the `form` the A2UI root node produces.
 *
 * `.last()` rather than `.first()`: before hydration the page carries the no-JS fallback
 * form (task 044), which React replaces rather than adopts, so the first match can be the
 * pre-hydration document. The renderer's own form is the last one in the flow page.
 */
function rendererRoot(page: Page): Locator {
  return page.locator("form").last();
}

/**
 * Wait until React owns the rendered tree, so the shape read is the hydrated one.
 *
 * React tags every host node it owns with a `__reactFiber$...` property, which is the
 * attachment signal itself rather than a proxy for it (the same probe the gate captures
 * use). Comparing a server-rendered tree against a hydrated one would be comparing two
 * different things and would fail for a reason that is not fidelity.
 */
async function waitForReactAttached(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    if (form === null) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
}

/**
 * The bytes of a completed download.
 *
 * Playwright hands back a stream rather than a path until the transfer finishes, so this
 * is also the wait: a truncated or empty body arrives here as a short string rather than
 * as a timeout.
 */
async function readDownload(file: Download): Promise<string> {
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}
