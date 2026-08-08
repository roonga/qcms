import { expect, type Locator, type Page } from "@playwright/test";

import { fillStable } from "./flow.js";

/**
 * Browser steps for the question library, shared by the lifecycle walk and the axe gate
 * (task 032).
 *
 * ## Why these locators use roles rather than labels
 *
 * The vendored controls append a decorative `*` to a required field's `<label>`, so its
 * text content is "Label *" while its accessible name is "Label" (the asterisk carries
 * `aria-hidden`). An exact `getByLabel("Label")` therefore matches nothing, and because
 * `fillStable` retries inside `toPass`, that surfaces as a bare fifteen-second timeout
 * with no indication of the cause - it cost a run to find. `getByRole` reads the
 * accessible name, which is both correct and the same string an assistive technology
 * announces.
 */

/** One text input of the editor, addressed by its accessible name. */
export function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

/** Pick a question type in the creation form's `Select`. */
export async function chooseType(page: Page, label: string): Promise<void> {
  const picker = page.getByRole("button", { name: /Type$/ });
  await picker.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(picker).toContainText(label);
}

/**
 * Create a draft question of one type and land on its detail screen.
 *
 * The wait is on the URL the create action redirects to, and that redirect is itself part
 * of what is under test: an author who has just named a question should be looking at it.
 */
export async function createDraft(page: Page, slug: string, typeLabel: string): Promise<void> {
  await page.goto("/questions/new");
  await fillStable(field(page, "Slug"), slug);
  await chooseType(page, typeLabel);
  await fillStable(field(page, "Label"), `E2E ${typeLabel} question`);
  // A choice question starts with an empty option list on purpose (an option's id is
  // minted from the label it is added with), and the kernel requires at least one, so
  // creating one means naming its options first.
  if (typeLabel.includes("choice") || typeLabel.includes("Choice")) {
    await addOption(page, "Yes, always");
    await addOption(page, "No, never");
  }
  await Promise.all([
    page.waitForURL(/\/questions\/q_/),
    page.getByRole("button", { name: "Create draft" }).click(),
  ]);
}

/**
 * The pending row: the one the author has opened and not yet named (task 057).
 *
 * It has no `optionId` and therefore no `data-option-index`, which is what makes it
 * addressable separately from every committed row - and what makes "the abandoned ghost row
 * consumed no id" checkable in the browser rather than only in the unit tests.
 */
export function pendingRow(page: Page): Locator {
  return page.locator("[data-option-pending] textarea");
}

/** One row's grip: drag source, Arrow Up/Down reorder, and row-menu trigger in one. */
export function grip(page: Page, index: number): Locator {
  return page.locator(`[data-option-index="${String(index)}"] [data-option-grip]`);
}

/**
 * Open the ghost add-row, name it, and let it settle.
 *
 * The rhythm the frozen card specifies, and the one that carries the Code Owner's minting
 * ruling: pressing "Add option" opens a row that holds NO id, and the id is minted when the
 * row acquires content. Blurring is what settles it, so the assertion below is against a
 * committed row rather than the pending one.
 */
export async function addOption(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(pendingRow(page)).toBeFocused();
  await fillStable(pendingRow(page), label);
  await pendingRow(page).blur();
  await expect(page.getByRole("textbox", { name: /^Option \d+ label$/ }).last()).toHaveValue(label);
}

/**
 * Insert a named option at a row boundary through the pointer path.
 *
 * `index` is the row it lands ABOVE; `options.length` is the ghost add-row at the end. The
 * insert point is invisible at rest and revealed on hover, so the click is forced rather
 * than hover-then-click: what is under test here is where the option lands, and the
 * reveal-on-hover and reveal-on-focus behaviours are asserted on their own elsewhere.
 */
export async function insertOptionAbove(page: Page, index: number, label: string): Promise<void> {
  await page
    .locator(`[data-option-index="${String(index)}"] .qcms-opt-insert`)
    .first()
    .click({ force: true });
  await expect(pendingRow(page)).toBeFocused();
  await fillStable(pendingRow(page), label);
  await pendingRow(page).blur();
}

/** Reorder by keyboard: focus a row's grip and press an arrow, as the card specifies. */
export async function moveOptionByKey(page: Page, index: number, key: "ArrowUp" | "ArrowDown") {
  await grip(page, index).focus();
  await grip(page, index).press(key);
}

/** Open a row's menu from the keyboard (Enter on the focused grip) and pick an item. */
export async function useRowMenu(page: Page, index: number, item: RegExp): Promise<void> {
  await grip(page, index).focus();
  await grip(page, index).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: item }).click();
}

/**
 * Type a date into a `DatePicker`, which has no text input to fill.
 *
 * react-aria renders a date as a row of spinbutton segments, so the value is typed rather
 * than set: focus the first segment and the digits roll through the segments in the order
 * the resolved locale lays them out. `digits` is therefore locale-ordered. The config pins
 * no `locale`, so this is Chromium's default `en-US` and the order is MMDDYYYY; the
 * trailing-year assertion below fails loudly rather than silently if that ever changes.
 */
export async function fillDate(page: Page, label: string, digits: string): Promise<void> {
  const group = page.getByRole("group", { name: label });
  await group.getByRole("spinbutton").first().click();
  await page.keyboard.type(digits);
  await expect(group).toContainText(digits.slice(-4));
}

/** Open a lifecycle confirmation and accept it. */
export async function confirmLifecycle(page: Page, open: RegExp, confirm: string): Promise<void> {
  await page.getByRole("button", { name: open }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Every option id the grid renders, in display order.
 *
 * Scoped to `[data-option-index]` on purpose: a pending row also has an ID cell, and what
 * it renders there is a placeholder rather than an id. Including it would make an
 * abandoned ghost row look like a minted option, which is the exact confusion the deferred
 * minting rule exists to prevent.
 */
export function optionIds(page: Page): Promise<string[]> {
  return page.locator("[data-option-index] .qcms-opt-cell--id").allTextContents();
}

/**
 * Fill one numeric constraint of the editor and COMMIT it, so anything derived from the
 * editor's document has caught up before the next step.
 *
 * A react-aria `NumberField` filled programmatically reports its value on **blur**, not on
 * the input event, so `fillStable` alone leaves the number on screen and absent from the
 * editor's state. Task 048 made that difference visible in two ways, both of which cost a
 * browser run to find: a message field appears when its constraint commits, so a test that
 * fills and immediately looks for the field is racing the commit; and the reflow that
 * insertion causes lands between a following click's mousedown (which fires the blur) and
 * its mouseup, so the two hit different elements and no `click` event fires at all.
 *
 * Blurring here makes the commit the fill's own last step. A test that then clicks a control
 * BELOW the constraints panel should still anchor on the message field it expects, so the
 * click waits for a page that has finished moving.
 */
export async function setNumericConstraint(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await fillStable(field(page, label), value);
  await field(page, label).blur();
}
