import { expect, type Locator, type Page } from "@playwright/test";

import { fillStable } from "./flow.js";

/**
 * Browser steps for the form builder, shared by the build walk, the axe gate and the
 * screenshot capture (task 033).
 *
 * ## Everything is addressed by accessible name
 *
 * Same contract 032's helpers state: the name is what an assistive technology announces,
 * so a locator that used a class would keep passing after the name went missing. The one
 * exception is the small set of `data-testid` hooks on live regions and flags
 * (`qcms-save-state`, `qcms-backward-flag`), which have no stable name of their own
 * because their content is the message.
 *
 * ## Why the rule controls are scoped to a rule
 *
 * A form has many rules and each renders the same three control names (Operator, Question,
 * Value). Every helper here therefore takes the rule's own region, found by its
 * `data-rule-id`, rather than reaching for a name that is ambiguous the moment a second
 * rule exists.
 */

/** One text input of the builder, addressed by its accessible name. */
export function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

/**
 * Create a form and land on its builder.
 *
 * The form id is minted from the slug and is what the URL carries, so the return value is
 * read from the URL rather than recomputed: if the two ever disagreed, this would fail
 * here rather than several assertions later.
 */
export async function createForm(page: Page, slug: string, title: string): Promise<string> {
  await page.goto("/forms");
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

/** Add a step by title, and wait for its row to appear in the rail. */
export async function addStep(page: Page, title: string): Promise<void> {
  await fillStable(field(page, "New step title"), title);
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open step ${title}` })).toBeVisible();
}

/** Select a step in the rail, which is what decides which step the editor is editing. */
export async function openStep(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Open step ${title}` }).click();
  await expect(page.getByRole("heading", { name: `Step: ${title}` })).toBeVisible();
}

/**
 * Pin one question version into the open step, through the library picker.
 *
 * The picker's rows are `questionId@version` and activating a row is the pin, so this is
 * the same interaction an author performs: open, find the row, press it.
 */
export async function pinQuestion(page: Page, questionId: string, version: number): Promise<void> {
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("row")
    .filter({ hasText: questionId })
    .filter({ hasText: `v${String(version)}` })
    .first()
    .click();
  await expect(dialog).toBeHidden();
  await expect(pinLabel(page, questionId, version)).toBeVisible();
}

/**
 * The pin row's `questionId@version` badge.
 *
 * `.first()` is not laziness: the same string is also the label of the condition editor's
 * question picker, so once a rule exists the bare text matches twice and a strict-mode
 * locator throws. The pin row is the first of them in document order, and it is the one
 * every caller here means.
 */
export function pinLabel(page: Page, questionId: string, version: number): Locator {
  return page.getByText(`${questionId}@${String(version)}`, { exact: true }).first();
}

/** Add a rule and return the id the builder minted for it. */
export async function addRule(page: Page): Promise<string> {
  const before = await ruleIds(page);
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await expect(page.locator("[data-rule-id]")).toHaveCount(before.length + 1);
  const after = await ruleIds(page);
  const added = after.find((id) => !before.includes(id));
  expect(added, "adding a rule should mint exactly one new id").toBeDefined();
  return added ?? "";
}

/** Every rule region currently on screen, by id, in document order. */
export async function ruleIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator("[data-rule-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-rule-id") ?? ""));
  return ids.filter((id) => id !== "");
}

/** One rule's region, which every rule-scoped control is found inside. */
export function rule(page: Page, ruleId: string): Locator {
  return page.locator(`section[data-rule-id="${ruleId}"]`);
}

/**
 * Choose a value in one of the vendored `Select` controls.
 *
 * The trigger's accessible name is its **current value followed by its label** - react-aria
 * labels the button with the value element and then the label element, in that order - so
 * the match is a suffix. Getting this backwards costs a five-minute timeout with a call log
 * that only says the locator never resolved, which is what `chooseType` in `questions.ts`
 * encodes as `/Type$/` without saying why.
 */
export async function chooseOption(scope: Locator, label: string, option: string): Promise<void> {
  const trigger = scope
    .getByRole("button", { name: new RegExp(`${escapeForName(label)}$`) })
    .first();
  await trigger.click();
  await scope.page().getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

/** A label used inside a name regex, with the characters a regex would otherwise read. */
function escapeForName(label: string): string {
  return label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tick or untick one `show` target of a rule. */
export async function toggleTarget(
  page: Page,
  ruleId: string,
  target: string,
  shouldBeSelected: boolean,
): Promise<void> {
  const box = rule(page, ruleId).getByRole("checkbox", { name: target, exact: true });
  if ((await box.isChecked()) !== shouldBeSelected) await box.click();
  await expect(box).toBeChecked({ checked: shouldBeSelected });
}

/**
 * Move one pin to another published version (R7: one pin, one version, no bulk).
 *
 * The menu is the only version change the builder has, which is why the helper drives the
 * menu rather than editing anything underneath it.
 */
export async function movePin(page: Page, questionId: string, version: number): Promise<void> {
  await page
    .getByRole("button", { name: `Move pin for ${questionId}` })
    .first()
    .click();
  await page.getByRole("menuitem", { name: `Move to v${String(version)}`, exact: true }).click();
  await expect(pinLabel(page, questionId, version)).toBeVisible();
}

/**
 * Wait for the debounced autosave and the validation round trip behind it to land.
 *
 * The save indicator is the product's own statement that the draft reached the API, so
 * waiting on it is waiting on the thing under test rather than on a sleep. The timeout is
 * generous because `next dev` compiles the server action's route on first use.
 */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("qcms-save-state")).toContainText(/^Saved /, { timeout: 30_000 });
}

/** The issue summary the validation panel announces. */
export function issueSummary(page: Page): Locator {
  return page.getByTestId("qcms-issue-summary");
}

/** One issue code, wherever it is rendered (the panel, a rule, or a pin row). */
export function issue(scope: Page | Locator, code: string): Locator {
  return scope.locator(`[data-issue-code="${code}"]`);
}
