import { expect, type Locator, type Page } from "@playwright/test";

import { fillStable } from "./flow.js";

/**
 * Browser steps for the form builder, shared by the build walk and accessibility suite.
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
 *
 * Since issue 685 the fields are on `/forms/new` rather than in a card on the library
 * screen, and this one line is the whole of that change for the twenty-odd specs that
 * reach a builder through here. The control names did not move with the fields, which is
 * deliberate: "Slug", "Title" and "Create form" are what an assistive technology
 * announces, so keeping them means this helper still asserts the same contract it did
 * before the screen moved.
 */
export async function createForm(page: Page, slug: string, title: string): Promise<string> {
  await page.goto("/forms/new");
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
 * The picker's control for one choosable row: a CHECKBOX since issue 660.
 *
 * The row used to BE the control (`onRowAction`); contract §2 retired that and issue 570
 * gave the row a named button, because a picker has no address to link to. Issue 660 made
 * the dialog multi-select, so the row control now stages a choice rather than committing
 * it and a checkbox is what states that. What did NOT change is the accessible name:
 * locating by it is deliberate, because it is the same string a screen-reader author
 * hears, so a regression that leaves the column full of bare unnamed checkboxes fails here
 * rather than in a manual pass.
 */
export function pickerChoice(scope: Locator, questionId: string, version: number): Locator {
  return scope.getByRole("checkbox", { name: `Add ${questionId} version ${String(version)}` });
}

/** The dialog's one commit control, whose label carries the count it is about to add. */
export function pickerCommit(scope: Locator, count: number): Locator {
  const label = count === 1 ? "Add 1 question to step" : `Add ${String(count)} questions to step`;
  return scope.getByRole("button", { name: label });
}

/** Pin one question version into the open step, through the library picker. */
export async function pinQuestion(page: Page, questionId: string, version: number): Promise<void> {
  await pinQuestions(page, [{ questionId, version }]);
}

/**
 * Pin several question versions in ONE trip through the picker, which is what issue 660
 * added and what every caller of `pinQuestion` used to have to do one dialog at a time.
 */
export async function pinQuestions(
  page: Page,
  pins: readonly { questionId: string; version: number }[],
): Promise<void> {
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

/**
 * The pin row for one question at one version.
 *
 * Addressed by the row's own data attributes rather than by a `questionId@version` string
 * (issue 517). The ownership grid splits that string into its two columns because the two
 * halves have different owners - the id belongs to the question library and the version to
 * the form - so there is no longer one text node carrying both. Reading the attributes is
 * also what the text match was working around: the same string is the label of the
 * condition editor's question picker too, so `getByText` matched twice once a rule existed
 * and needed `.first()` to stay out of strict mode.
 */
export function pinLabel(page: Page, questionId: string, version: number): Locator {
  return page.locator(`[data-pin-question="${questionId}"][data-pin-version="${String(version)}"]`);
}

/** One pin row's grip: its reorder keys, and the only route to its row menu. */
export function pinGrip(page: Page, questionId: string): Locator {
  return page.locator(`[data-pin-question="${questionId}"] [data-pin-grip]`);
}

/**
 * Open a pin row's grip menu and choose one of its five entries.
 *
 * The grip is `aria-haspopup="menu"` and opens on Enter, Space or a click; the menu it
 * opens is the APG pattern by hand (`components/row-menu.tsx`), so its items are real
 * `menuitem` roles and are addressed as such.
 */
export async function usePinRowMenu(
  page: Page,
  questionId: string,
  action: "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove",
): Promise<void> {
  await pinGrip(page, questionId).click();
  await page.locator(`[role="menuitem"][data-row-menu-item="${action}"]`).click();
}

/**
 * One entry of whichever pin row menu is currently open.
 *
 * Addressed page-wide rather than scoped to a row, the way `usePinRowMenu` addresses it:
 * the step editor renders at most one menu at a time, so the key alone is unambiguous.
 */
export function pinRowMenuItem(
  page: Page,
  action: "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove",
): Locator {
  return page.locator(`[role="menuitem"][data-row-menu-item="${action}"]`);
}

/** The pinned question ids of the open step, in the order the form serves them. */
export async function pinnedOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-pin-question]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pin-question") ?? ""));
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

/**
 * Tick or untick one `show` target of a rule.
 *
 * Clicked by its visible label rather than by the checkbox itself, which is the convention
 * `questions-lifecycle.pw.ts` and `apps/portal/e2e/support/kitchen-sink.ts` both encode for
 * the same vendored control: react-aria puts a decorative indicator over the real input, so
 * a click aimed at the input is intercepted. The assertion still reads the input, because
 * checked-ness is what is being asserted.
 */
export async function toggleTarget(
  page: Page,
  ruleId: string,
  target: string,
  shouldBeSelected: boolean,
): Promise<void> {
  const scope = rule(page, ruleId);
  const box = scope.getByRole("checkbox", { name: target, exact: true });
  if ((await box.isChecked()) !== shouldBeSelected) {
    await scope.getByText(target, { exact: true }).click();
  }
  await expect(box).toBeChecked({ checked: shouldBeSelected });
}

/** Tick or untick a checkbox anywhere on the page, by its visible label. */
export async function toggleCheckbox(
  page: Page,
  label: string,
  shouldBeSelected: boolean,
): Promise<void> {
  const box = page.getByRole("checkbox", { name: label, exact: true });
  if ((await box.isChecked()) !== shouldBeSelected) {
    await page.getByText(label, { exact: true }).click();
  }
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
 *
 * Since issue 518 the indicator is the builder's ambient save strip rather than a sentence
 * inside the validation panel. The testid did not move with it: it names the sentence, and
 * the sentence is the same one.
 */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(saveState(page)).toContainText(/^Saved /, { timeout: 30_000 });
}

/** The save indicator's current sentence. */
export function saveState(page: Page): Locator {
  return page.getByTestId("qcms-save-state");
}

/** The ambient save strip, which carries the machine-readable instant of the last save. */
export function saveStatus(page: Page): Locator {
  return page.getByTestId("qcms-save-status");
}

/**
 * The instant of the last successful autosave, or `""` before the first one this visit.
 *
 * The attribute rather than the sentence, and that is the whole point of the attribute:
 * see `waitForSaveAfter`.
 */
export async function savedStamp(page: Page): Promise<string> {
  return (await saveStatus(page).getAttribute("data-saved-at")) ?? "";
}

/**
 * Wait for a NEW autosave to land, given the strip's `data-saved-at` from before the edit.
 *
 * `waitForSaved` on its own is not enough after an edit, and 034's gate capture is where
 * that stopped being theoretical: "Saved ..." is already on screen from the previous save,
 * so it returns immediately and the caller races the round trip it meant to wait for.
 * Publishing straight afterwards then freezes - or refuses to freeze - the PREVIOUS draft,
 * which reads as a bug in publish rather than as a test that jumped the queue.
 *
 * Waiting for the validation panel instead does not fix it either: validate is a separate
 * debounced call, so the panel can report the engine's verdict on a document the server
 * has not been given.
 *
 * This used to compare the indicator's TEXT, which worked only because that text carried
 * seconds. Issue 518 took the seconds out on purpose (`plan/admin-design-contracts.md` §2,
 * and a per-minute string is what keeps the live region quiet during sustained typing), so
 * two saves in the same minute now render identically. `data-saved-at` is the replacement:
 * the raw ISO instant, precise enough for a test and never announced to anyone.
 */
export async function waitForSaveAfter(page: Page, previous: string): Promise<void> {
  await expect(saveStatus(page)).not.toHaveAttribute("data-saved-at", previous, {
    timeout: 30_000,
  });
  await waitForSaved(page);
}

/** The issue summary the validation panel announces. */
export function issueSummary(page: Page): Locator {
  return page.getByTestId("qcms-issue-summary");
}

/** One issue code, wherever it is rendered (the panel, a rule, or a pin row). */
export function issue(scope: Page | Locator, code: string): Locator {
  return scope.locator(`[data-issue-code="${code}"]`);
}
