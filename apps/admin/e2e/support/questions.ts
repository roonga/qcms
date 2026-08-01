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

/** Name and append one option, which is the only moment its id is minted. */
export async function addOption(page: Page, label: string): Promise<void> {
  await fillStable(field(page, "New option label"), label);
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByRole("textbox", { name: /^Label for option / }).last()).toHaveValue(label);
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

/** Every option id the option list editor renders, in display order. */
export function optionIds(page: Page): Promise<string[]> {
  return page.locator(".qcms-option-row__id").allTextContents();
}
