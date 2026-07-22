/**
 * Driving helpers for the kitchen-sink form (task 045). One place for the
 * react-aria control quirks so the flow spec reads as a script: radios and
 * checkboxes sit under a decorative indicator that intercepts pointer events (so
 * click the visible label text, not the input); the NumberField commits per
 * keystroke (type key-by-key); the DatePicker is a segmented DateField in en-US
 * order MM/DD/YYYY that only emits a value once all segments are complete; and
 * discrete controls (radios, checkboxes) post immediately on change while text /
 * number / date post on blur. Answer posts are serialized, so we wait for each
 * `/answers` 200 (or the navigation `/step` 200) before the next action.
 */

import { expect, type Page } from "@playwright/test";

/** The kitchen-sink form's three step titles (headings), in order. */
export const KS_STEP_TITLES = ["About you", "Driving history", "Your cover"] as const;

/** Accessible names / labels the renderer emits for each question. */
export const KS = {
  fullName: "Full name",
  dob: "Date of birth",
  accidentGroup: "Any at-fault accident in the last 3 years?",
  count: /how many/i,
  extraDetail: "Anything else about your driving history?",
} as const;

/** Wait for one `POST /answers` to be recorded server-side (status 200). */
export function answerPosted(page: Page): Promise<unknown> {
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
async function blurActive(page: Page): Promise<void> {
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
}

/** Fill a text/textarea control by accessible name, then blur to post it. */
export async function fillText(page: Page, name: string, value: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByRole("textbox", { name }).fill(value);
  await blurActive(page);
  await recorded;
}

/** Enter a date into the segmented DateField (en-US MM/DD/YYYY), then blur. */
export async function enterDate(page: Page, digits: string): Promise<void> {
  const recorded = answerPosted(page);
  const group = page.getByRole("group", { name: KS.dob });
  // Click the month segment directly: react-aria handles the pointer event and
  // makes the segment ready for keyboard entry (a programmatic .focus() on the
  // segment span does not always enable typing). Typing auto-advances the rest.
  const month = group.getByRole("spinbutton", { name: /month/i });
  await month.click();
  await page.keyboard.type(digits); // e.g. "05171990" -> 1990-05-17
  // Confirm the segments actually filled before blurring (guards a missed focus).
  await expect(month).not.toHaveText(/mm/i);
  await blurActive(page);
  await recorded;
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
 * Choose a BOOLEAN radio (Yes/No) by its visible label. A boolean posts
 * immediately on change (it can flip a branch), so wait for the post directly.
 */
export async function chooseRadio(page: Page, label: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByText(label, { exact: true }).click();
  await recorded;
}

/**
 * Choose a SINGLE-CHOICE radio (an OptionId string) by its visible label. A
 * single-choice value is a string, which the portal posts on blur (like text),
 * so the radio must be genuinely FOCUSED (a pointer click on the label can select
 * without focusing) before we blur into the step heading to post it. Focus the
 * radio and select it with Space, then blur.
 */
export async function chooseSingleChoice(page: Page, label: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByRole("radio", { name: label, exact: true }).focus();
  await page.keyboard.press("Space");
  await blurActive(page);
  await recorded;
}

/** Toggle a checkbox option by its visible label (cumulative array; posts each). */
export async function checkOption(page: Page, label: string): Promise<void> {
  const recorded = answerPosted(page);
  await page.getByText(label, { exact: true }).click();
  await recorded;
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
