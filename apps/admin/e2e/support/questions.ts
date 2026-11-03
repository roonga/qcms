import { expect, type Locator, type Page } from "@playwright/test";

import { fillStable } from "./flow.js";
import { waitForHydration } from "./hydration.js";

export function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

export type QuestionPanelName =
  "content" | "options" | "constraints" | "messages" | "booleanLabels" | "preview";

// Only call on detail screens; creation renders every panel together rather than selecting one.
export async function openPanel(page: Page, panel: QuestionPanelName): Promise<void> {
  await waitForHydration(page);
  const row = page.locator(`[data-rail-panel="${panel}"]`);
  await expect(row, `the rail should offer a ${panel} panel`).toHaveCount(1);
  await openPanelRow(page, row);
}

// Inspect the editor panels: the creation rail also has panel rows, so the rail cannot identify the layout.
async function ensurePanel(page: Page, panel: QuestionPanelName): Promise<void> {
  if ((await page.locator("[data-question-panel]").count()) > 1) return;
  const row = page.locator(`[data-rail-panel="${panel}"]`);
  if ((await row.count()) === 0) return;
  if ((await row.getAttribute("aria-current")) === "page") return;
  await openPanelRow(page, row);
}

async function openPanelRow(page: Page, row: Locator): Promise<void> {
  const disclosure = page.locator("details.qcms-rail__disclosure");
  if ((await disclosure.getAttribute("open")) === null) {
    await page.locator("summary.qcms-rail__summary").click();
  }
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page");
}

export async function chooseType(page: Page, label: string): Promise<void> {
  await waitForHydration(page);
  const picker = page.getByRole("button", { name: /Type$/ });
  await picker.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(picker).toContainText(label);
}

export async function createDraft(page: Page, slug: string, typeLabel: string): Promise<void> {
  await page.goto("/questions/new");
  await fillStable(field(page, "Slug"), slug);
  await chooseType(page, typeLabel);
  await fillStable(field(page, "Label"), `E2E ${typeLabel} question`);
  // Option IDs mint from labels, and the kernel requires at least one option before a choice question can be created.
  if (typeLabel.includes("choice") || typeLabel.includes("Choice")) {
    await addOption(page, "Yes, always");
    await addOption(page, "No, never");
  }
  await Promise.all([
    page.waitForURL(/\/questions\/q_/),
    page.getByRole("button", { name: "Create draft" }).click(),
  ]);
}

// Pending rows have no option ID; they must not count as minted options.
export function pendingRow(page: Page): Locator {
  return page.locator("[data-option-pending] textarea");
}

export function grip(page: Page, index: number): Locator {
  return page.locator(`[data-option-index="${String(index)}"] [data-option-grip]`);
}

// Naming mints an option ID; blur settles the pending row before callers inspect committed options.
export async function addOption(page: Page, label: string): Promise<void> {
  await waitForHydration(page);
  await ensurePanel(page, "options");
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  await fillStable(pendingRow(page), label);
  await pendingRow(page).blur();
  await expect(page.getByRole("textbox", { name: /^Option \d+ label$/ }).last()).toHaveValue(label);
}

// The insertion control is hidden until hover; forcing isolates insertion placement from separately tested reveal behavior.
export async function insertOptionAbove(page: Page, index: number, label: string): Promise<void> {
  await waitForHydration(page);
  await ensurePanel(page, "options");
  await page
    .locator(`[data-option-index="${String(index)}"] .qcms-opt-insert`)
    .first()
    .click({ force: true });
  await expect(pendingRow(page)).toBeFocused();
  await fillStable(pendingRow(page), label);
  await pendingRow(page).blur();
}

export async function moveOptionByKey(page: Page, index: number, key: "ArrowUp" | "ArrowDown") {
  await waitForHydration(page);
  await ensurePanel(page, "options");
  await grip(page, index).focus();
  await grip(page, index).press(key);
}

// A stationary grip click must open its menu without starting a drag.
export async function openRowMenuByPointer(page: Page, index: number): Promise<Locator> {
  await waitForHydration(page);
  await ensurePanel(page, "options");
  await page.locator(".qcms-opt-grid").scrollIntoViewIfNeeded();
  await grip(page, index).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function useRowMenu(page: Page, index: number, item: RegExp): Promise<void> {
  await waitForHydration(page);
  await ensurePanel(page, "options");
  await grip(page, index).focus();
  await grip(page, index).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: item }).click();
}

// digits uses MMDDYYYY regardless of locale. Read the actual segment order from the page,
// not the browser locale: the application provides its own locale.
export async function fillDate(page: Page, label: string, digits: string): Promise<void> {
  await waitForHydration(page);
  // Only question-date bounds have a Constraints panel; other DatePickers share this helper too.
  await ensurePanel(page, "constraints");
  const group = page.getByRole("group", { name: label });
  const parts: Record<string, string> = {
    month: digits.slice(0, 2),
    day: digits.slice(2, 4),
    year: digits.slice(4),
  };
  const order = await group
    .locator('[role="spinbutton"][data-type]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset["type"] ?? ""));
  const typed = order
    .filter((type) => type in parts)
    .map((type) => parts[type])
    .join("");
  await group.getByRole("spinbutton").first().click();
  await page.keyboard.type(typed);
  await expect(group).toContainText(digits.slice(-4));
}

export async function confirmLifecycle(page: Page, open: RegExp, confirm: string): Promise<void> {
  await waitForHydration(page);
  await page.getByRole("button", { name: open }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Open the Options panel before reading IDs, and exclude the uncommitted ghost row.
export async function optionIds(page: Page): Promise<string[]> {
  await ensurePanel(page, "options");
  return page.locator("[data-option-index] .qcms-opt-cell--id").allTextContents();
}

// NumberField commits a programmatic fill on blur. Blur before clicking below it,
// or insertion of a derived field can move the click target between press and release.
export async function setNumericConstraint(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await ensurePanel(page, "constraints");
  await fillStable(field(page, label), value);
  await field(page, label).blur();
}
