import type { Page } from "@playwright/test";

import { families } from "../../portal/e2e/support/font-families.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  cancelRuleEditor,
  chooseOption,
  closeRuleEditor,
  createForm,
  field,
  issue,
  issueSummary,
  movePin,
  moveStep,
  openFormDetails,
  openRuleEditor,
  openRulePhase,
  openRules,
  openStep,
  pinLabel,
  pinQuestion,
  rule,
  ruleIds,
  savedStamp,
  saveState,
  targetFilter,
  toggleCheckbox,
  toggleTarget,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import {
  addOption,
  confirmLifecycle,
  createDraft,
  optionIds,
  useRowMenu,
} from "./support/questions.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forms");

let totpSecret = "";

const RUN = Date.now().toString(36);

const AT_FAULT = `e2e-at-fault-accident-${RUN}`;
const ACCIDENT_COUNT = `e2e-accident-count-${RUN}`;
const CLAIM_NOTES = `e2e-claim-notes-${RUN}`;
const COVER_LEVEL = `e2e-cover-level-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

let atFaultYesOption = "";

let coverV1Option = "";

let insuranceFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

test("builds the insurance form through the UI and saves it (exit criterion 1)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await publishQuestion(page, AT_FAULT, "Single choice");
  const options = await optionIds(page);
  atFaultYesOption = options[0] ?? "";
  expect(atFaultYesOption, "the choice question should carry minted option ids").toMatch(/^opt_/u);

  await publishQuestion(page, ACCIDENT_COUNT, "Number");
  await publishQuestion(page, CLAIM_NOTES, "Long text");

  insuranceFormId = await createForm(page, `e2e-vehicle-insurance-${RUN}`, "Vehicle insurance");

  await addStep(page, "Driving history");
  await pinQuestion(page, questionIdFor(AT_FAULT), 1);
  await pinQuestion(page, questionIdFor(ACCIDENT_COUNT), 1);

  await addStep(page, "Claim details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  // Wait before crossing routes: the rules screen reads the stored draft while autosave is debounced.
  await waitForSaved(page);

  await openRules(page);

  await expect(page.getByRole("heading", { level: 1, name: "Rules", exact: true })).toBeAttached();

  // Capture the save baseline before opening the buffered editor; its Save makes one mutation.
  const beforeRule = await savedStamp(page);
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", atFaultYesOption);
  await toggleTarget(page, ruleId, questionIdFor(CLAIM_NOTES), true);
  await closeRuleEditor(page);

  await waitForSaveAfter(page, beforeRule);

  await expect(page.locator("tr[data-rule-id] [data-rule-issues]")).toHaveCount(0);

  await openFormDetails(page);
  await expect(issueSummary(page)).toContainText("has not been checked yet");

  const beforeTitle = await savedStamp(page);
  await field(page, "Form title").fill("Insurance quote");
  await waitForSaveAfter(page, beforeTitle);
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.");

  await page.reload();
  await expect(page.getByRole("button", { name: "Open step Driving history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open step Claim details" })).toBeVisible();
  await openRules(page);
  await expect(page.locator("tr[data-rule-id]")).toHaveCount(1);
  await openStep(page, "Driving history");
  await expect(pinLabel(page, questionIdFor(AT_FAULT), 1)).toBeVisible();
});

test("the builder's rules card reads, and every way out of it crosses to the rules route", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  const lens = page.getByTestId("qcms-rules-lens");
  await expect(lens).toBeVisible();

  await expect(lens.locator(".qcms-rule-action")).toHaveCount(0);
  await expect(lens.locator("button")).toHaveCount(0);

  await expect(lens.locator("[data-rule-count]")).toHaveAttribute("data-rule-count", "1");

  const ruleUrl = (await lens.locator("a[href*='#rule-']").first().getAttribute("href")) ?? "";
  expect(ruleUrl, "a rule line addresses the route, not a bare fragment").toContain(
    `/forms/${insuranceFormId}/rules#rule-`,
  );
  await lens.locator("a[href*='#rule-']").first().click();
  await expect(page).toHaveURL(ruleUrl);
  const anchored = ruleUrl.slice(ruleUrl.indexOf("#") + 1);
  await expect(async () => {
    const focused = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(focused, "the lens line focuses the rule it names").toBe(anchored);
  }).toPass({ timeout: 30_000 });

  await expect(page.locator(`tr[data-rule-id="${anchored.replace("rule-", "")}"]`)).toBeVisible();

  await page.goto(`/forms/${insuranceFormId}`);
  await page.getByTestId("qcms-rules-lens-edit").click();
  await expect(page).toHaveURL(`/forms/${insuranceFormId}/rules`);

  await page.goto(`/forms/${insuranceFormId}`);
  await page.getByTestId("qcms-rules-lens-add").click();
  await expect(page).toHaveURL(/\/rules(?:#new-rule)?$/u);
  const minted = page.locator("section[data-rule-id]");
  await expect(minted, "arriving with #new-rule opens the wizard on a fresh rule").toBeVisible({
    timeout: 30_000,
  });
  await cancelRuleEditor(page);

  await expect(page.locator("tr[data-rule-id]")).toHaveCount(1);
});

test("a backward target is flagged instantly and refused by the engine (exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  expect(ruleId, "the saved draft should still carry its rule").toMatch(/^rul_/u);

  await openRuleEditor(page, ruleId);
  const scope = rule(page, ruleId);
  await openRulePhase(page, "then");

  await expect(scope.getByText("Comes before this condition")).toBeVisible();
  await expect(
    scope.getByRole("checkbox", { name: questionIdFor(AT_FAULT), exact: true }),
  ).toBeDisabled();

  await cancelRuleEditor(page);

  await openFormDetails(page);
  await moveStep(page, "Claim details", "up");

  await expect(page.locator("[data-rail-step-select]").first()).toHaveAttribute(
    "data-rail-step-select",
    "Claim details",
  );

  await expect(issueSummary(page)).toContainText("would block a publish", { timeout: 30_000 });
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "then");

  // The short timeout distinguishes immediate client geometry feedback from debounced validation.
  await expect(page.getByTestId("qcms-backward-flag")).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("qcms-backward-flag")).toContainText(questionIdFor(CLAIM_NOTES));

  // Selected ineligible targets must remain clearable or the author cannot repair the rule.
  await expect(
    scope.getByRole("checkbox", { name: questionIdFor(CLAIM_NOTES), exact: true }),
  ).toBeEnabled();

  // A validation verdict proves the client state; a changed save stamp proves persistence before route navigation.
  await closeRuleEditor(page);

  await expect(page.locator(`tr[data-rule-id="${ruleId}"] [data-rule-issues]`)).toBeVisible({
    timeout: 30_000,
  });

  // Read the save stamp before opening the modal, whose overlay blocks the strip.
  const beforeReopen = await savedStamp(page);
  await openRuleEditor(page, ruleId);
  await expect(issue(scope, "RULE_BACKWARD_TARGET")).toBeVisible({ timeout: 30_000 });

  // Restore step order: clearing the only target creates a different refusal and breaks later serial tests.
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeReopen);
  await openFormDetails(page);
  await moveStep(page, "Claim details", "down");

  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.", {
    timeout: 30_000,
  });
  await openRuleEditor(page, ruleId);
  await expect(page.getByTestId("qcms-backward-flag")).toHaveCount(0);
  await closeRuleEditor(page);
});

test("moving a pin re-runs validation and surfaces the broken option ref (exit criterion 3)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await publishQuestion(page, COVER_LEVEL, "Single choice");
  const v1Options = await optionIds(page);
  coverV1Option = v1Options[0] ?? "";
  expect(coverV1Option).toMatch(/^opt_/u);

  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  // Add replacement options first: a choice question must always retain at least one option.
  await addOption(page, "Full cover");
  await addOption(page, "Basic cover");

  await useRowMenu(page, 0, /^Remove option /);
  await useRowMenu(page, 0, /^Remove option /);
  await expect(page.getByRole("textbox", { name: /^Option \d+ label$/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  const v2Options = await optionIds(page);
  expect(v2Options, "v2 should carry different option ids than v1").not.toContain(coverV1Option);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createForm(page, `e2e-cover-choice-${RUN}`, "Cover choice");
  await addStep(page, "Cover");
  await pinQuestion(page, questionIdFor(COVER_LEVEL), 1);
  await addStep(page, "Details");
  await pinQuestion(page, questionIdFor(CLAIM_NOTES), 1);

  const beforeRule = await savedStamp(page);
  const ruleId = await addRule(page);
  const scope = rule(page, ruleId);
  await chooseOption(scope, "Operator", "equals (the whole answer)");
  await chooseOption(scope, "Value", coverV1Option);
  await toggleTarget(page, ruleId, questionIdFor(CLAIM_NOTES), true);
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeRule);

  await expect(page.locator("tr[data-rule-id] [data-rule-issues]")).toHaveCount(0);

  await openFormDetails(page);
  await openStep(page, "Cover");
  const beforeMove = await savedStamp(page);
  await movePin(page, questionIdFor(COVER_LEVEL), 2);

  await expect(pinLabel(page, questionIdFor(COVER_LEVEL), 2)).toBeVisible();
  // Wait for persistence before navigating to the rules screen, which reads the server's draft.
  await waitForSaveAfter(page, beforeMove);

  await openRuleEditor(page, ruleId);

  await expect(issue(scope, "DANGLING_OPTION_REF")).toBeVisible({ timeout: 30_000 });
  await cancelRuleEditor(page);

  await expect(page.locator(`tr[data-rule-id="${ruleId}"] [data-rule-issues]`)).toBeVisible({
    timeout: 30_000,
  });
});

test("the settings panel says a required challenge is unenforceable, and stores it unpressed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await toggleCheckbox(page, "Require a challenge before answering", true);
  await expect(page.getByTestId("qcms-challenge-unenforceable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
    "the settings panel has no save control of its own any more",
  ).toHaveCount(0);

  await expect(saveState(page)).toContainText(/^Last saved /, { timeout: 30_000 });

  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Require a challenge before answering" }),
  ).toBeChecked();
});

test("a settings write the API refuses is said, with no press to have reported it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await toggleCheckbox(page, "Use the deployment's minimum time", false);
  const minSubmit = field(page, "Minimum time before a submit is accepted (milliseconds)");
  await minSubmit.click();
  await minSubmit.fill("7200000");

  await minSubmit.blur();

  await expect(page.getByTestId("qcms-settings-state")).toContainText("could not be saved", {
    timeout: 30_000,
  });

  await expect(saveState(page)).toHaveText("The last save failed.");

  await expect(minSubmit).toHaveValue(/7[\s,.]?200[\s,.]?000/);
});

test("the rule test bench answers with the engine's own verdict", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "test");
  // Both benches share child testids; scope to the wizard's bench rather than the screen's bench.
  const wizardBench = page.getByTestId("qcms-bench");
  const bench = wizardBench.getByTestId("qcms-bench-outcome");

  await chooseOption(rule(page, ruleId), `${questionIdFor(AT_FAULT)}@1`, atFaultYesOption);
  await wizardBench.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(bench).toHaveAttribute("data-outcome", "match", { timeout: 30_000 });
  await expect(bench).toContainText("Matches.");
  await cancelRuleEditor(page);
});

test("the operator picker filters as you type, and keeps the ones that do not apply", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "when");

  const monoToken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
  );
  expect(families(monoToken)[0], `--font-mono resolved to "${monoToken}"`).toBe("JetBrains Mono");
  const editorText = page.getByTestId("qcms-condition-json").locator(".cm-content");
  await expect(editorText).toBeVisible();
  const paneFamily = await editorText.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(families(paneFamily), `the pane resolved to "${paneFamily}"`).toEqual(families(monoToken));

  const operator = page.getByRole("combobox", { name: "Operator" });
  await operator.click();

  await expect(page.getByRole("option", { name: "is at least", exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: "equals (the whole answer)" })).toBeEnabled();

  await operator.fill("at le");
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: "is at least", exact: true })).toBeVisible();
  await expect(
    page.getByRole("option", { name: "at least one instance of a group matches", exact: true }),
  ).toBeVisible();

  await operator.fill("zzzz");
  await expect(page.getByText("No match.")).toBeVisible();

  await operator.press("Escape");
  await expect(page.getByText("No match.")).toBeHidden();
  await cancelRuleEditor(page);
});

test("Back and Next walk the wizard's phases without gating them (Code Owner, 2026-08-30)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  await openRuleEditor(page, ruleId);

  const scope = rule(page, ruleId);
  const back = page.getByRole("button", { name: /^Back/ });
  const next = page.getByRole("button", { name: /^Next/ });
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });

  await expect(tab("1. When")).toHaveAttribute("aria-selected", "true");
  await expect(back).toBeDisabled();
  await expect(next).toBeEnabled();

  await next.click();
  await expect(tab("2. Then show")).toHaveAttribute("aria-selected", "true");
  await expect(back).toBeEnabled();

  await next.click();
  await expect(tab("3. Test")).toHaveAttribute("aria-selected", "true");

  await expect(next).toBeDisabled();

  await back.click();
  await expect(tab("2. Then show")).toHaveAttribute("aria-selected", "true");

  await openRulePhase(page, "test");
  await openRulePhase(page, "when");
  await expect(tab("1. When")).toHaveAttribute("aria-selected", "true");
  await expect(back).toBeDisabled();

  const dialogBox = async (): Promise<string> => {
    const box = await scope.boundingBox();
    return `top=${String(Math.round(box?.y ?? -1))} height=${String(Math.round(box?.height ?? -1))}`;
  };
  const atWhen = await dialogBox();
  for (const phase of ["then", "test"] as const) {
    await openRulePhase(page, phase);
    expect.soft(await dialogBox(), `the dialog does not move onto the ${phase} phase`).toBe(atWhen);
  }
  await openRulePhase(page, "when");
  await next.click();
  expect.soft(await dialogBox(), "the dialog does not move when Next is pressed").toBe(atWhen);

  await cancelRuleEditor(page);
});

test("the screen's own bench is expanded under the table, with a picker (Code Owner, 2026-08-30)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);
  await openRules(page);

  const screenBench = page.getByTestId("qcms-bench-screen");
  await expect(screenBench).toBeVisible();

  await expect(page.getByRole("heading", { level: 2, name: "Rule test bench" })).toBeVisible();

  await expect(page.getByTestId("qcms-bench")).toHaveCount(0);

  const ruleId = (await ruleIds(page))[0] ?? "";
  expect(ruleId).not.toBe("");
  await expect(screenBench.getByTestId("qcms-bench-digest")).toContainText(ruleId);

  await chooseOption(screenBench, `${questionIdFor(AT_FAULT)}@1`, atFaultYesOption);
  await screenBench.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(screenBench.getByTestId("qcms-bench-outcome")).toHaveAttribute(
    "data-outcome",
    "match",
    { timeout: 30_000 },
  );
});

test("both panels are in the heading outline, with a digest the panel repeats", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  const settingsHeading = page.getByRole("heading", { level: 2, name: "Form settings" });
  await expect(settingsHeading).toBeVisible();

  const settingsDigest = await page.getByTestId("qcms-settings-digest").innerText();
  const challenge = page.getByRole("checkbox", { name: "Require a challenge before answering" });
  expect(
    settingsDigest.includes("Challenge required"),
    "the settings digest agrees with the checkbox inside the panel",
  ).toBe(await challenge.isChecked());

  await openRules(page);
  const benchRuleId = (await ruleIds(page))[0] ?? "";
  await openRuleEditor(page, benchRuleId);
  await openRulePhase(page, "test");
  const benchHeading = page.getByRole("heading", { level: 3, name: "Rule test bench" });
  await expect(benchHeading).toBeVisible();
  const wizardBench = page.getByTestId("qcms-bench");
  const benchDigest = wizardBench.getByTestId("qcms-bench-digest");
  await expect(benchDigest).toContainText(/reads \d+ question/);
  const reads = Number(/reads (\d+) question/.exec(await benchDigest.innerText())?.[1] ?? "-1");
  await expect(wizardBench.getByTestId("qcms-bench-reference")).toHaveCount(reads);
  await cancelRuleEditor(page);
});

test("the rule wizard buffers: Cancel discards, Save commits (Code Owner, 2026-08-30)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";

  const sentence = page.locator(`tr[data-rule-id="${ruleId}"] p.qcms-rule-sentence`);
  const before = (await sentence.innerText()).trim();
  expect(before, "the saved rule already reads as a sentence").not.toBe("");

  await openRuleEditor(page, ruleId);
  await toggleTarget(page, ruleId, questionIdFor(ACCIDENT_COUNT), true);
  await cancelRuleEditor(page);
  expect((await sentence.innerText()).trim(), "Cancel leaves the rule as it was").toBe(before);

  await page.reload();
  await openRules(page);
  expect((await sentence.innerText()).trim()).toBe(before);
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "then");
  await expect(
    rule(page, ruleId).getByRole("checkbox", { name: questionIdFor(ACCIDENT_COUNT), exact: true }),
    "the cancelled target is not in the stored rule",
  ).not.toBeChecked();

  await cancelRuleEditor(page);

  const beforeSave = await savedStamp(page);
  await openRuleEditor(page, ruleId);
  await toggleTarget(page, ruleId, questionIdFor(ACCIDENT_COUNT), true);
  await closeRuleEditor(page);
  expect((await sentence.innerText()).trim(), "Save changes what the rule says").not.toBe(before);
  await waitForSaveAfter(page, beforeSave);

  await page.reload();
  await openRules(page);
  await openRuleEditor(page, ruleId);
  await openRulePhase(page, "then");
  await expect(
    rule(page, ruleId).getByRole("checkbox", { name: questionIdFor(ACCIDENT_COUNT), exact: true }),
    "the saved target survives a round trip through the API",
  ).toBeChecked();
  await cancelRuleEditor(page);

  // Restore the shared draft because later serial tests read it.
  const beforeRestore = await savedStamp(page);
  await openRuleEditor(page, ruleId);
  await toggleTarget(page, ruleId, questionIdFor(ACCIDENT_COUNT), false);
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeRestore);
  expect((await sentence.innerText()).trim()).toBe(before);
});

test("Add rule leaves nothing behind when it is cancelled", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const before = await ruleIds(page);

  await addRule(page);
  expect(await ruleIds(page), "the row appears on Save, not on Add").toEqual(before);
  await cancelRuleEditor(page);
  expect(await ruleIds(page)).toEqual(before);

  await expect(page.getByTestId("qcms-autosave-paused")).toHaveCount(0);
});

test("the targets are grouped by step, keep the ineligible ones, and can be filtered", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${insuranceFormId}`);

  await openRules(page);
  const ruleId = (await ruleIds(page))[0] ?? "";
  await openRuleEditor(page, ruleId);
  const scope = rule(page, ruleId);

  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(dialogBox?.width ?? 0, "the rule wizard is wider than the kit's default").toBeGreaterThan(
    900,
  );

  await openRulePhase(page, "then");

  await expect(scope.locator("[data-target-step]")).toHaveCount(3);
  await expect(scope.locator('[data-target-step="stp_driving_history"]')).toHaveCount(2);
  await expect(scope.locator('[data-target-step="stp_claim_details"]')).toHaveCount(1);

  await expect(scope.getByText("Comes before this condition")).toBeVisible();
  await expect(scope.getByText("Comes after this condition")).toBeVisible();
  await expect(
    scope.getByRole("checkbox", { name: questionIdFor(AT_FAULT), exact: true }),
  ).toBeVisible();

  const count = page.getByTestId("qcms-targets-count");
  const total = Number(/of (\d+) targets/.exec(await count.innerText())?.[1] ?? "-1");
  expect(total, "the count states the whole list before anything is typed").toBeGreaterThan(1);

  await fillStable(targetFilter(page), "Claim details");
  await expect(scope.locator("[data-target-step]")).toHaveCount(1);
  await expect(scope.locator('[data-target-step="stp_claim_details"]')).toBeVisible();
  await expect(count).not.toHaveText(new RegExp(`Showing ${String(total)} of`));

  await fillStable(targetFilter(page), "no such target");
  await expect(scope.getByText("No target matches that filter.")).toBeVisible();

  await expect(page.getByTestId("qcms-targets-selected")).toContainText(questionIdFor(CLAIM_NOTES));

  await cancelRuleEditor(page);
});

test("the form library lists the forms that were built", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto("/forms");
  await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: insuranceFormId })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: insuranceFormId })).toContainText(
    "Unpublished draft",
  );
});
