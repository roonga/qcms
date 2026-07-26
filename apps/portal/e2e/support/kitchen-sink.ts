/**
 * Driving helpers for the kitchen-sink form (task 045). One place for the
 * react-aria control quirks so the flow spec reads as a script: radios and
 * checkboxes sit under a decorative indicator that intercepts pointer events (so
 * click the visible label text, not the input); the NumberField emits per
 * keystroke (type key-by-key); the DatePicker is a segmented DateField in en-US
 * order MM/DD/YYYY that only emits a value once all segments are complete.
 *
 * WHEN each answer posts is ADR-31's commit table, which these helpers encode so
 * a spec reads as a script rather than as event plumbing: booleans and single
 * choice post on change, the date posts when its last segment completes, text and
 * number post on blur, and a multi-choice posts when focus leaves the whole
 * checkbox GROUP (so `checkOption` toggles AND exits). Answer posts are
 * serialized, so we wait for each `/answers` 200 (or the navigation `/step` 200)
 * before the next action. The commit moments themselves are the subject of
 * `commit-moments.pw.ts`; here they are only the driving convention.
 */

import { expect, type Page, type Response } from "@playwright/test";

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

/**
 * Wait until React has hydrated the step, not merely until the SSR markup is
 * visible. The portal's first paint is real server-rendered content (029), so
 * every control is visible and fillable BEFORE any handler is attached: a `fill`
 * that lands in that window sets the DOM value, the controlled re-render throws
 * it away, and no answer is ever posted. React tags each host node it owns with
 * a `__reactFiber$…` / `__reactProps$…` property when it hydrates, so the
 * presence of one on a step control is the attachment signal itself rather than
 * a proxy for it.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid='primary-action']");
    return el !== null && Object.keys(el).some((key) => key.startsWith("__react"));
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

/**
 * Enter a date into the segmented DateField (en-US MM/DD/YYYY), then blur. The
 * date's commit moment is `completion` (ADR-31): a partial date never posts, and
 * the complete one posts once, when editing ends. Typing all eight digits and
 * blurring is therefore one post - see `commit-moments.pw.ts` for why the
 * control's own "value is non-empty" signal cannot be the trigger.
 */
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

/**
 * Clear an ALREADY-ANSWERED date and commit, which retracts it (issue #95).
 *
 * Backspace on a react-aria date segment deletes digit-wise, so one press empties
 * a two-digit month and leaves the date incomplete but not empty: the exact state
 * react-aria never reports through `onChange` (it fires only when a date becomes
 * complete, or when every segment is empty). The adapter reads the displayed
 * segments at the commit moment instead, and posts a null clear, so this waits
 * for that POST like any other answer post.
 */
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

/**
 * Empty an ALREADY-ANSWERED text-like control (TextField, TextArea or
 * NumberField) and commit, which retracts the answer (issue #98, ADR-33).
 *
 * Emptying the box is not the commit: text and number both commit on blur
 * (ADR-31), so the retraction posts when focus leaves, and this waits for that
 * POST like any other answer post. An emptied control reports absence rather than
 * an empty-string answer, so what travels is the same `null` clear a cleared date
 * sends (see `clearDate`).
 */
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

/**
 * Choose a SINGLE-CHOICE radio (an OptionId string) by its visible label. Single
 * choice commits on change, like a boolean, because it can gate a branch
 * (ADR-31, issue #31) - so this waits for the post directly and never blurs. It
 * used to have to focus the radio, press Space and then blur, because a
 * single-choice value is a string and the flow posted every string on blur; that
 * workaround is the regression net here, and its removal is what the fix buys.
 */
export async function chooseSingleChoice(page: Page, label: string): Promise<void> {
  await clickLabelAndAwaitPost(page, label);
}

/**
 * Toggle one checkbox option by its visible label WITHOUT committing the group.
 * A multi-choice commits on group exit (ADR-31), so a toggle posts nothing: only
 * `commitCheckboxGroup` does. The explicit `.focus()` afterwards is what makes
 * that exit deterministic - a pointer click on the decorative label selects the
 * box without necessarily focusing its input, and the group's commit is a FOCUS
 * event.
 */
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

/**
 * Fast-forward through the kitchen-sink form's first two steps with valid
 * answers and land on step 3 ("Your cover"), whose only question is the
 * single-choice one. The flow spec drives those steps with its own assertions;
 * this is the plain set-up for a spec whose subject is step 3.
 *
 * "No" is chosen for the accident question so the number follow-up stays hidden
 * and no extra required question is introduced.
 */
export async function advanceToCoverStep(page: Page, slug: string): Promise<void> {
  await startKitchenSink(page, slug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990"); // 1990-05-17 (en-US MM/DD/YYYY)
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
