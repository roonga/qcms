import { expect, type Locator, type Page, type Response } from "@playwright/test";

import { waitForHydration } from "./hydration.js";

/** The kitchen-sink form's three step titles (headings), in order. */
export const KS_STEP_TITLES = ["About you", "Driving history", "Your cover"] as const;

/** Accessible names / labels the renderer emits for each question. */
export const KS = {
  fullName: "Full name",
  dob: "Date of birth",
  accidentGroup: "Any at-fault accident in the last 3 years?",
  count: /how many/i,
  optionalCover: "Which optional cover do you want?",
  extraDetail: "Anything else about your driving history?",
  bodyType: "What body type is the vehicle?",
  overnightParking: "Where is the vehicle usually parked overnight?",
} as const;

/** Wait for one `POST /answers` to be recorded server-side (status 200). */
export function answerPosted(page: Page): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
}

/** Wait for a navigation `GET /step` (Continue/Back) to be served (status 200). */
export function stepServed(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (r) => r.url().includes("/step") && r.request().method() === "GET" && r.status() === 200,
  );
}

/**
 * Blur the focused control so text / number / date answers post. Blurring the
 * active element directly (rather than clicking a neutral element) is
 * deterministic: it always moves focus out of the field's wrapper and fires its
 * onBlur, regardless of layout or overlays.
 */
export async function blurActive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
}

/** Start the kitchen-sink flow anonymously and land on step 1 (About you). */
export async function startKitchenSink(page: Page, slug: string): Promise<void> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("textbox", { name: KS.fullName })).toBeVisible();
  await waitForHydration(page);
}

/** Fill a text/textarea control by accessible name, then blur to post it. */
export async function fillText(page: Page, name: string, value: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByRole("textbox", { name }).fill(value);
  await blurActive(page);
  await recorded;
}

/** A calendar day's three parts, as react-aria tags its segments. */
export type DatePartName = "day" | "month" | "year";

export async function dateSegmentOrder(group: Locator): Promise<DatePartName[]> {
  const types = await group
    .locator('[role="spinbutton"][data-type]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset["type"] ?? ""));
  return types.filter(
    (type): type is DatePartName => type === "day" || type === "month" || type === "year",
  );
}

/**
 * Split `MMDDYYYY` digits into parts. The callers have always written dates this way, and
 * keeping the argument stable means only this helper knows the field's real order.
 */
export function dateParts(digits: string): Record<DatePartName, string> {
  return { month: digits.slice(0, 2), day: digits.slice(2, 4), year: digits.slice(4) };
}

export async function enterDate(page: Page, digits: string): Promise<void> {
  const recorded = answerPosted(page);
  const group = page.getByRole("group", { name: KS.dob });
  const order = await dateSegmentOrder(group);
  const parts = dateParts(digits);
  const first = group.getByRole("spinbutton", { name: new RegExp(order[0] ?? "month", "i") });
  await first.click();
  await page.keyboard.type(order.map((part) => parts[part]).join("")); // e.g. 17/05/1990
  await expect(group.getByRole("spinbutton", { name: /month/i })).not.toHaveText(/mm/i);
  await blurActive(page);
  await recorded;
}

export async function clearDate(page: Page): Promise<void> {
  const retracted = answerPosted(page);
  const group = page.getByRole("group", { name: KS.dob });
  const month = group.getByRole("spinbutton", { name: /month/i });
  await month.click();
  await page.keyboard.press("Backspace");
  await expect(month).toHaveText(/mm/i);
  await blurActive(page);
  await retracted;
}

export async function clearText(page: Page, name: string | RegExp): Promise<void> {
  const retracted = answerPosted(page);
  const field = page.getByRole("textbox", { name });
  await field.click();
  await field.fill("");
  await blurActive(page);
  await retracted;
}

/** Type into the NumberField key-by-key (per-keystroke commit), then blur. */
export async function answerNumber(page: Page, value: string): Promise<void> {
  const recorded = answerPosted(page);
  const count = page.getByRole("textbox", { name: KS.count });
  await count.click();
  await count.pressSequentially(value);
  await blurActive(page);
  await recorded;
}

/**
 * Click a control by its visible label and wait for the answer POST it triggers.
 * Shared by the controls whose commit moment is `change` (ADR-31): a boolean or
 * single-choice radio, either of which can flip a branch on selection.
 */
async function clickLabelAndAwaitPost(page: Page, label: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByText(label, { exact: true }).click();
  await recorded;
}

/**
 * Choose a BOOLEAN radio (Yes/No) by its visible label. A boolean posts
 * immediately on change (it can flip a branch), so wait for the post directly.
 */
export async function chooseRadio(page: Page, label: string): Promise<void> {
  await clickLabelAndAwaitPost(page, label);
}

export async function chooseSingleChoice(page: Page, label: string): Promise<void> {
  await clickLabelAndAwaitPost(page, label);
}

export async function chooseFromSelect(
  page: Page,
  questionId: string,
  optionLabel: string,
): Promise<void> {
  const recorded = answerPosted(page);
  await page.locator(`[data-qcms-field="${questionId}"] button[aria-haspopup="listbox"]`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
  await recorded;
}

export async function toggleOption(page: Page, label: string): Promise<void> {
  await page.getByText(label, { exact: true }).click();
  await page.getByRole("checkbox", { name: label, exact: true }).focus();
}

/**
 * Commit the focused checkbox group by moving focus out of it, and wait for the
 * single post that commit makes. Blurring the active element leaves the group
 * with `relatedTarget === null` (a click on the page background, or a tab out of
 * the document), which `FieldBlur`'s containment check treats as leaving.
 */
export async function commitCheckboxGroup(page: Page): Promise<void> {
  const recorded = answerPosted(page);
  await blurActive(page);
  await recorded;
}

/**
 * Select a checkbox option and commit the group (the cumulative array posts once,
 * on exit). Two options in a row therefore cost two posts here; a spec that cares
 * about the cadence itself uses `toggleOption` + `commitCheckboxGroup` directly.
 */
export async function checkOption(page: Page, label: string): Promise<void> {
  await toggleOption(page, label);
  await commitCheckboxGroup(page);
}

export async function advanceToCoverStep(page: Page, slug: string): Promise<void> {
  await startKitchenSink(page, slug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");
  await checkOption(page, "Breakdown");
  await continueStep(page);
}

/** Click Continue and wait for the next step to be served. */
export async function continueStep(page: Page): Promise<void> {
  const served = stepServed(page);
  await page.getByTestId("primary-action").click();
  await served;
}

/** Click Back and wait for the previous step to be served. */
export async function backStep(page: Page): Promise<void> {
  const served = stepServed(page);
  await page.getByTestId("back-action").click();
  await served;
}
