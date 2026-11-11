import { expect, type Locator, type Page } from "@playwright/test";

import { chooseEnvironment } from "./environment.js";
import { fillStable } from "./flow.js";
import { waitForHydration } from "./hydration.js";
import { chooseDestination, chooseSource, openPublishWizard } from "./publish.js";

// Autosave pauses on empty drafts, empty steps and rules without targets.
// A persistable fixture needs a step holding a published question pin.

export function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

export async function createForm(page: Page, slug: string, title: string): Promise<string> {
  await page.goto("/forms/new");
  await waitForHydration(page);

  await fillStable(field(page, "Slug"), slug);
  await fillStable(field(page, "Title"), title);
  await Promise.all([
    page.waitForURL(/\/forms\/frm_/),
    page.getByRole("button", { name: "Create form" }).click(),
  ]);
  const formId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(formId, "the created form should own the URL").toMatch(/^frm_/u);
  return formId;
}

export async function openRail(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) > 0) {
    throw new Error(
      "the rail cannot be reached while a dialog is open - close it first (closeRuleEditor)",
    );
  }
  // All rail-driven interactions inherit this hydration wait, including screens without a disclosure.
  await waitForHydration(page);
  const disclosure = page.locator("details.qcms-rail__disclosure");
  if ((await disclosure.count()) === 0) return;
  // The server starts the rail open; wait for the viewport decision before trusting its open state.
  await expect(disclosure).toHaveAttribute("data-ready", "");
  if ((await disclosure.getAttribute("open")) !== null) return;
  await page.locator("summary.qcms-rail__summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
}

// Publishing alone serves no sessions: release a version into the respondent harness's environment too.
export async function releaseNewestVersion(
  page: Page,
  formId: string,
  environment: "test" | "prod" = "prod",
): Promise<void> {
  await chooseEnvironment(page, environment);
  await openPublishWizard(page, formId);
  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();
  await chooseDestination(destinations, environment);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("qcms-publish-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const result = page.getByTestId("qcms-publish-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.locator(`li[data-environment="${environment}"]`)).toBeVisible();
}

export async function openFormDetails(page: Page): Promise<void> {
  await openRail(page);
  // The rail row is named after the variable form title; its stable identity is the section marker.
  await page.locator('[data-rail-item="section:builder"]').click();
  await expect(field(page, "Form title")).toBeVisible();
}

export async function addStep(page: Page, title: string): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await fillStable(field(page, "New step title"), title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open step ${title}` })).toBeVisible();
}

// The builder selects in place; other form routes navigate back using a step fragment.
export async function openStep(page: Page, title: string): Promise<void> {
  await openRail(page);
  const select = page.getByRole("button", { name: `Open step ${title}` });
  if ((await select.count()) > 0) {
    await select.click();
  } else {
    await page
      .locator('[data-rail-group="steps"] [data-rail-item^="step:"]')
      .filter({ hasText: title })
      .first()
      .click();
  }
  await expect(page.getByRole("heading", { name: `Step: ${title}` })).toBeVisible();
}

export function pickerChoice(scope: Locator, questionId: string, version: number): Locator {
  return scope.getByRole("checkbox", { name: `Add ${questionId} version ${String(version)}` });
}

export function pickerCommit(scope: Locator, count: number): Locator {
  const label = count === 1 ? "Add 1 question to step" : `Add ${String(count)} questions to step`;
  return scope.getByRole("button", { name: label });
}

export async function pinQuestion(page: Page, questionId: string, version: number): Promise<void> {
  await pinQuestions(page, [{ questionId, version }]);
}

export async function pinQuestions(
  page: Page,
  pins: readonly { questionId: string; version: number }[],
): Promise<void> {
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const pin of pins) {
    const choice = pickerChoice(dialog, pin.questionId, pin.version);
    await expect(choice).toBeVisible();
    await choice.check();
  }
  await pickerCommit(dialog, pins.length).click();
  await expect(dialog).toBeHidden();
  for (const pin of pins) {
    await expect(pinLabel(page, pin.questionId, pin.version)).toBeVisible();
  }
}

// IDs and versions occupy separate cells, and condition pickers can repeat their text; use the row attributes.
export function pinLabel(page: Page, questionId: string, version: number): Locator {
  return page.locator(`[data-pin-question="${questionId}"][data-pin-version="${String(version)}"]`);
}

// The accessible name must start with the visible version so speech input can target the control.
export function pinVersionTrigger(page: Page, questionId: string, version: number): Locator {
  return page.getByRole("button", {
    name: `v${String(version)}, move pin for ${questionId}`,
    exact: true,
  });
}

export function pinGrip(page: Page, questionId: string): Locator {
  return page.locator(`[data-pin-question="${questionId}"] [data-pin-grip]`);
}

export async function usePinRowMenu(
  page: Page,
  questionId: string,
  action: "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove",
): Promise<void> {
  await waitForHydration(page);
  await pinGrip(page, questionId).click();
  await page.locator(`[role="menuitem"][data-row-menu-item="${action}"]`).click();
}

// The editor mounts at most one row menu at a time, so its key is unambiguous page-wide.
export function pinRowMenuItem(
  page: Page,
  action: "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove",
): Locator {
  return page.locator(`[role="menuitem"][data-row-menu-item="${action}"]`);
}

export async function pinnedOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-pin-question]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pin-question") ?? ""));
}

// Exercise the rail link itself so a broken navigation affordance fails the journey.
export async function openRules(page: Page): Promise<void> {
  await openRail(page);
  await page.locator('[data-rail-item="section:rules"]').click();
  await expect(page).toHaveURL(/\/rules(?:[#?]|$)/u);
  await rulesHeading(page).waitFor();
}

// The heading ID also labels the rule-editor region.
export function rulesHeading(page: Page): Locator {
  return page.locator("#qcms-rules-heading");
}

// Returns the buffered rule ID before any row exists in the draft. Save the wizard to persist it.
export async function addRule(page: Page): Promise<string> {
  await openRules(page);
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  const editing = page.locator("section[data-rule-id]");
  await expect(editing, "Add rule opens the wizard on the rule it minted").toBeVisible();
  const added = (await editing.getAttribute("data-rule-id")) ?? "";
  expect(added, "adding a rule should mint one id").toMatch(/^rul_/u);
  return added;
}

// Returns only rendered rule regions; open the rules route first to read this form's rules.
export async function ruleIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator("tr[data-rule-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-rule-id") ?? ""));
  return ids.filter((id) => id !== "");
}

export function rule(page: Page, ruleId: string): Locator {
  return page.locator(`section[data-rule-id="${ruleId}"]`);
}

export async function openRuleEditor(page: Page, ruleId: string): Promise<void> {
  await openRules(page);
  await page.locator(`tr[data-rule-id="${ruleId}"]`).getByRole("button", { name: "Edit" }).click();
  await expect(rule(page, ruleId)).toBeVisible();
}

export const RULE_PHASES = {
  when: "1. When",
  then: "2. Then show",
  test: "3. Test",
} as const;

export async function openRulePhase(page: Page, phase: keyof typeof RULE_PHASES): Promise<void> {
  await waitForHydration(page);
  const tab = page.getByRole("tab", { name: RULE_PHASES[phase], exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

// Saving commits buffered edits; dismissing through Cancel discards them.
export async function closeRuleEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("section[data-rule-id]")).toHaveCount(0);
}

export async function cancelRuleEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("section[data-rule-id]")).toHaveCount(0);
}

// Try the combobox first: its toggle also matches the Select trigger suffix.
// A Select names its trigger with the current value followed by the label.
export async function chooseOption(scope: Locator, label: string, option: string): Promise<void> {
  await waitForHydration(scope.page());
  const combobox = scope.getByRole("combobox", { name: label, exact: true });
  if ((await combobox.count()) > 0) {
    const field = combobox.first();
    await field.click();
    await scope.page().getByRole("option", { name: option, exact: true }).click();
    await expect(field).toHaveValue(option);
    return;
  }

  const trigger = scope
    .getByRole("button", { name: new RegExp(`${escapeForName(label)}$`) })
    .first();
  await trigger.click();
  await scope.page().getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

function escapeForName(label: string): string {
  return label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Clear target filters before calling; filtered targets may not be mounted.
// Click the label because the kit indicator covers the native checkbox input.
export async function toggleTarget(
  page: Page,
  ruleId: string,
  target: string,
  shouldBeSelected: boolean,
): Promise<void> {
  await openRulePhase(page, "then");
  const scope = rule(page, ruleId);
  const box = scope.getByRole("checkbox", { name: target, exact: true });
  if ((await box.isChecked()) !== shouldBeSelected) {
    await scope.getByText(target, { exact: true }).click();
  }
  await expect(box).toBeChecked({ checked: shouldBeSelected });
}

export function targetFilter(page: Page): Locator {
  return field(page, "Filter targets");
}

export async function toggleCheckbox(
  page: Page,
  label: string,
  shouldBeSelected: boolean,
): Promise<void> {
  // A pre-hydration label click can flip the native checkbox and pass the assertion
  // without updating React state; wait before pressing.
  await waitForHydration(page);
  const box = page.getByRole("checkbox", { name: label, exact: true });
  if ((await box.isChecked()) !== shouldBeSelected) {
    await page.getByText(label, { exact: true }).click();
  }
  await expect(box).toBeChecked({ checked: shouldBeSelected });
}

export async function movePin(page: Page, questionId: string, version: number): Promise<void> {
  await waitForHydration(page);
  // Match the stable suffix because the visible prefix names the current version, which the caller does not supply.
  await page
    .getByRole("button", { name: `move pin for ${questionId}` })
    .first()
    .click();
  await page.getByRole("menuitem", { name: `Move to v${String(version)}`, exact: true }).click();
  await expect(pinLabel(page, questionId, version)).toBeVisible();
}

// Step and group panels have no save strip; temporarily read the form screen and restore the caller's selection.
async function readingSaveState<T>(page: Page, read: () => Promise<T>): Promise<T> {
  const currentGroup = page.locator('[data-rail-group-select][aria-current="page"]');
  const group =
    (await currentGroup.count()) > 0
      ? await currentGroup.getAttribute("data-rail-group-select")
      : null;
  if (group !== null) {
    await openFormDetails(page);
    const value = await read();
    await openGroupPanel(page, group);
    return value;
  }

  const currentStep = page.locator('[data-rail-step-select][aria-current="page"]');
  const step =
    (await currentStep.count()) > 0
      ? await currentStep.getAttribute("data-rail-step-select")
      : null;
  if (step === null) return read();

  await openFormDetails(page);
  const value = await read();
  await openStep(page, step);
  return value;
}

// Only proves the first save of a visit. For later edits, use savedStamp and waitForSaveAfter.
export async function waitForSaved(page: Page): Promise<void> {
  await readingSaveState(page, async () => {
    await expectSavedSentence(page);
  });
}

function pausedNotice(page: Page): Locator {
  return page.getByTestId("qcms-autosave-paused");
}

const PAUSE_HINTS: Readonly<Record<string, string>> = {
  noSteps: "the draft has no steps yet - add one, and pin a published question into it.",
  emptyStep:
    "a step has no pins. The smallest persistable form is one step holding one pin of a " +
    "PUBLISHED question, so a fixture built as createForm + addStep never reaches the server.",
  ruleWithoutTarget:
    'a rule has no "Then show" target. A rule arrives targetless, so commit one before ' +
    "waiting on a save.",
};

// Inspect pause reasons after the save wait fails: a transient empty step during authoring is not a failure.
async function expectSavedSentence(page: Page): Promise<void> {
  try {
    await expect(saveState(page)).toContainText(/^Last saved /, { timeout: 30_000 });
  } catch (cause) {
    await throwPausedAutosave(page, cause);
  }
}

async function throwPausedAutosave(page: Page, cause: unknown): Promise<never> {
  const notice = pausedNotice(page);
  const reason =
    (await notice.count()) > 0 ? await notice.getAttribute("data-paused-reason") : null;
  if (reason === null || reason === "") throw cause;
  const hint = PAUSE_HINTS[reason] ?? "see `unsaveableReason` in `apps/admin/lib/forms/draft.ts`.";
  throw new Error(
    `the draft never saved because AUTOSAVE IS PAUSED (unsaveableReason: ${reason}): ${hint}\n` +
      "See the note on the smallest persistable form at the top of " +
      "`apps/admin/e2e/support/forms.ts`.",
    { cause },
  );
}

export function saveState(page: Page): Locator {
  return page.getByTestId("qcms-save-state");
}

export function saveStatus(page: Page): Locator {
  return page.getByTestId("qcms-save-status");
}

// Keep the expected user-visible sentence independent of the catalog so copy regressions fail the test.
const SAVING = "Saving...";

// Settle armed and in-flight saves before reading the baseline.
// Take it before a gesture that pauses autosave, or a cancelled debounce can leave Saving... stale.
export async function savedStamp(page: Page): Promise<string> {
  return readingSaveState(page, async () => {
    try {
      await expect(saveState(page)).not.toHaveText(SAVING, { timeout: 30_000 });
    } catch (cause) {
      await throwPausedAutosave(page, cause);
    }
    return (await saveStatus(page).getAttribute("data-saved-at")) ?? "";
  });
}

// Pass a settled savedStamp baseline. Compare the machine timestamp because visible labels omit seconds.
export async function waitForSaveAfter(page: Page, previous: string): Promise<void> {
  await readingSaveState(page, async () => {
    try {
      await expect(saveStatus(page)).not.toHaveAttribute("data-saved-at", previous, {
        timeout: 30_000,
      });
    } catch (cause) {
      await throwPausedAutosave(page, cause);
    }
    await expectSavedSentence(page);
  });
}

export function issueSummary(page: Page): Locator {
  return page.getByTestId("qcms-issue-summary");
}

// The heading names the validation region for assistive technology.
export function validationPanel(page: Page): Locator {
  return page.locator('section[aria-labelledby="qcms-validation-heading"]');
}

export function issue(scope: Page | Locator, code: string): Locator {
  return scope.locator(`[data-issue-code="${code}"]`);
}

export async function moveStep(page: Page, title: string, action: "up" | "down"): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: `Actions for step ${title}`, exact: true }).click();
  await page
    .getByRole("menuitem", { name: action === "up" ? "Move up" : "Move down", exact: true })
    .click();
}

export async function addRepeatGroup(page: Page, label: string): Promise<void> {
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add repeating group", exact: true }).click();
  await fillStable(field(page, "New group name"), label);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Repeating group: ${label}` })).toBeVisible();
}

// Group panels exist only on the builder; their rail rows select in place rather than navigating across routes.
export async function openGroupPanel(page: Page, label: string): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: `Open repeating group ${label}` }).click();
  await expect(page.getByRole("heading", { name: `Repeating group: ${label}` })).toBeVisible();
}

export function groupPanel(page: Page): Locator {
  return page.getByTestId("qcms-group-panel");
}

export async function chooseRadio(page: Page, label: string): Promise<void> {
  await waitForHydration(page);
  const radio = page.getByRole("radio", { name: label, exact: true });
  await page.getByText(label, { exact: true }).click();
  await expect(radio).toBeChecked();
}

// Reopening a valued combobox filters to that value; replace its text to expose the requested operator.
export async function chooseConditionOperator(scope: Locator, label: string): Promise<void> {
  await waitForHydration(scope.page());
  const combobox = scope.getByRole("combobox", { name: "Operator", exact: true }).first();
  await combobox.click();
  await fillStable(combobox, label);
  await scope.page().getByRole("option", { name: label, exact: true }).click();
  await expect(combobox).toHaveValue(label);
}
