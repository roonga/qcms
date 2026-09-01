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
 *
 * ## THE SMALLEST PERSISTABLE FORM IS NOT "A FORM WITH ONE STEP" (issue 569)
 *
 * A step with no pinned question makes the draft unstoreable: `lib/forms/draft.ts`'s
 * `unsaveableReason` returns `emptyStep`, and `components/forms/form-builder.tsx` responds
 * by PAUSING autosave rather than posting a draft the API would 422. So the obvious minimal
 * fixture - {@link createForm} then {@link addStep} - never reaches the server, and the
 * next `page.goto` back to the form shows no steps at all.
 *
 * The failure does not read as "autosave is paused". It reads as "step button not found
 * after reload", which sends the reader looking at selectors and at timing, and it cost two
 * probe runs before it was written down. {@link waitForSaved} and {@link waitForSaveAfter}
 * now name the reason rather than timing out silently, and this is the paragraph they point
 * at: **the smallest persistable form is one step holding one pin of a PUBLISHED question**,
 * so the minimal fixture is three gestures of setup (publish a question, create the form,
 * add the step and pin into it) rather than one.
 *
 * The same rule bites twice more. `noSteps` pauses a form that has none yet, and
 * `ruleWithoutTarget` pauses a rule whose "Then show" is still empty - which is the state
 * every rule passes through while it is being authored.
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

/**
 * Open the rail if it is shut, because below `--bp-sidebar` it opens that way.
 *
 * The steps live in the rail since 2026-08-25, and the rail is a disclosure that starts
 * collapsed on a narrow viewport (issue 707's decision). So on a phone, working on a step
 * begins by opening the rail - one press, and the summary above it names the form the whole
 * time. Every helper below goes through here rather than each one learning the width.
 *
 * A no-op at desktop widths, where the disclosure is already open.
 */
export async function openRail(page: Page): Promise<void> {
  // A MODAL DIALOG MAKES THE RAIL UNREACHABLE, and silently: every helper below that
  // navigates goes through here, so with a rule's editor open they wait for a control the
  // overlay is covering until the test times out five minutes later. Twice now that has
  // cost a full suite run to diagnose, so it fails here instead, named.
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) > 0) {
    throw new Error(
      "the rail cannot be reached while a dialog is open - close it first (closeRuleEditor)",
    );
  }
  const disclosure = page.locator("details.qcms-rail__disclosure");
  if ((await disclosure.count()) === 0) return;
  // WAIT FOR THE WIDTH TO HAVE BEEN DECIDED before reading `open`, or this races
  // hydration and does nothing. The server ships the rail open - that is the safe answer,
  // and the one a scriptless reader keeps - so an early read always sees `open` and returns,
  // and the media query then shuts it a moment later. `data-ready` is the attribute
  // `components/rail-disclosure.tsx` sets once it has read the query, which is exactly the
  // moment this can trust what it sees.
  await expect(disclosure).toHaveAttribute("data-ready", "");
  if ((await disclosure.getAttribute("open")) !== null) return;
  await page.locator("summary.qcms-rail__summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
}

/**
 * Show the form's own details: its title, settings, rules, test bench and validation.
 *
 * THE BUILDER IS TWO SCREENS behind one route since 2026-08-26, and the rail switches
 * between them. It opens on this one, so most callers need it only after having opened a
 * step - but calling it when it is already current is a press on a row that is already
 * `aria-current`, which changes nothing. Helpers below that act on a form-level panel go
 * through here rather than each spec remembering to.
 */
export async function openFormDetails(page: Page): Promise<void> {
  await openRail(page);
  // BY ITS PLACE IN THE RAIL, not by its name. That row is named after the FORM now - it
  // reads "Kitchen sink", not "Form details" - so a lookup by label had to know the
  // fixture's title, and the one that used to be here silently waited five minutes for a
  // control that no longer existed. `data-rail-item` is the row's identity and does not
  // move with its copy.
  await page.locator('[data-rail-item="section:builder"]').click();
  await expect(field(page, "Form title")).toBeVisible();
}

/**
 * Add a step by title, and wait for its row to appear in the rail.
 *
 * The naming moved into a dialog on 2026-08-26, so this is now three gestures rather than
 * two: open the dialog, name the step, commit. The trigger and the commit are deliberately
 * NOT the same string - "Add step" opens, "Add" commits - because an exact-name lookup that
 * matched both would be ambiguous the moment the dialog is on screen.
 */
export async function addStep(page: Page, title: string): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await fillStable(field(page, "New step title"), title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open step ${title}` })).toBeVisible();
}

/** Select a step in the rail, which is what decides which step the editor is editing. */
export async function openStep(page: Page, title: string): Promise<void> {
  await openRail(page);
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

/**
 * Show the form's rules, which are a screen of their own since 2026-08-26.
 *
 * They were on the form's details screen, and every helper below that touches a rule goes
 * through here rather than each spec remembering which of the builder's three screens a
 * rule is on.
 */
export async function openRules(page: Page): Promise<void> {
  await openRail(page);
  await page.locator('[data-rail-item="rules"]').click();
  await expect(page.locator("#qcms-rules-heading")).toBeVisible();
}

/**
 * Add a rule, leaving the browser in its open wizard, and return the id it was minted as.
 *
 * THE ROW DOES NOT EXIST YET when this returns, and that is the buffering rather than a
 * race. Since 2026-08-30 (`plan/admin-design-contracts.md` §6) "Add rule" mints a rule and
 * opens the wizard on it; the rule reaches the draft when Save is pressed, which is what
 * `closeRuleEditor` does. So the id is read off the open dialog, not off the table - a
 * spec that expected a new row here would be waiting for something Save has not yet made.
 *
 * Every caller's next act is to change the condition anyway: a rule arrives as `answered`
 * against the first pinned question, which says nothing useful.
 */
export async function addRule(page: Page): Promise<string> {
  // Rules have their own screen now. A spec that has just been working on a step, or on the
  // form's details, is looking at neither of the places this button is.
  await openRules(page);
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  const editing = page.locator("section[data-rule-id]");
  await expect(editing, "Add rule opens the wizard on the rule it minted").toBeVisible();
  const added = (await editing.getAttribute("data-rule-id")) ?? "";
  expect(added, "adding a rule should mint one id").toMatch(/^rul_/u);
  return added;
}

/**
 * Every rule region currently on screen, by id, in document order.
 *
 * "On screen" is load-bearing: the rules are one of the builder's three screens, so a
 * caller that has not opened it gets an empty list rather than a failure. Callers that mean
 * "this form's rules" open the screen first, which `addRule` does for them.
 */
export async function ruleIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator("tr[data-rule-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-rule-id") ?? ""));
  return ids.filter((id) => id !== "");
}

/** One rule's region, which every rule-scoped control is found inside. */
export function rule(page: Page, ruleId: string): Locator {
  return page.locator(`section[data-rule-id="${ruleId}"]`);
}

/**
 * Open one rule's editor, which is a dialog since 2026-08-26 and a three-phase wizard in a
 * wide dialog since 2026-08-30.
 *
 * The rules screen is a table of sentences - a rule is small to state and large to change -
 * so the condition tree that `rule()` scopes to only exists while its dialog is open. A
 * spec that reached straight for a control inside it used to find it inline and now waits
 * for something that is not there, which is what five minutes of timeout looks like.
 *
 * It lands on the "When" phase, which is where the wizard opens. `openRulePhase` is how a
 * caller reaches the other two.
 *
 * Idempotent by intent rather than by check: pressing Edit on a row whose dialog is already
 * open is not a thing the screen allows, because the dialog is modal.
 */
export async function openRuleEditor(page: Page, ruleId: string): Promise<void> {
  await openRules(page);
  await page.locator(`tr[data-rule-id="${ruleId}"]`).getByRole("button", { name: "Edit" }).click();
  await expect(rule(page, ruleId)).toBeVisible();
}

/**
 * The wizard's three phases, by the labels their tabs carry.
 *
 * Numbered in the product, so numbered here: the strings are what a screen reader
 * announces, and a helper that matched on "When" alone would keep passing after the phase
 * control lost its ordering.
 */
export const RULE_PHASES = {
  when: "1. When",
  then: "2. Then show",
  test: "3. Test",
} as const;

/**
 * Move to one phase of the open rule wizard.
 *
 * `role="tab"` rather than a button, deliberately: the phase control is the APG tabs
 * pattern (`components/forms/rule-wizard.tsx` writes down why it is not a stepper), and
 * locating by the role is what makes this assert the pattern rather than merely find the
 * label. A stepper built out of plain buttons would fail here rather than pass quietly.
 */
export async function openRulePhase(page: Page, phase: keyof typeof RULE_PHASES): Promise<void> {
  const tab = page.getByRole("tab", { name: RULE_PHASES[phase], exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * Commit the open rule wizard, which is what puts the rule into the draft.
 *
 * SAVE, not "Done", since 2026-08-30. The dialog buffers - nothing typed in it reaches the
 * draft until this press - so a spec that closed the editor any other way used to keep its
 * edits and now discards them. That is the point of the change rather than a hazard to work
 * around, and it is why `cancelRuleEditor` is a separate helper with its own name.
 */
export async function closeRuleEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("section[data-rule-id]")).toHaveCount(0);
}

/** Discard the open rule wizard. Every edit made inside it is thrown away. */
export async function cancelRuleEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("section[data-rule-id]")).toHaveCount(0);
}

/**
 * Choose a value in a labelled picker, whichever of the two kinds it is.
 *
 * TWO SHAPES BEHIND ONE HELPER (Code Owner, 2026-08-30). Most pickers are the vendored
 * `Select`; the rule editor's Operator is a `ComboBox` you can type into. A caller does not
 * care - it wants the field named `label` set to `option` - and the alternative was
 * rewriting every call site the day a field changed shape, which is exactly what this
 * change would otherwise have cost: three specs failed on the combobox's toggle matching
 * the `Select` trigger's locator and reporting its chevron as the field's value.
 *
 * The combobox is tried FIRST and by exact role, because its toggle button also matches the
 * `Select` trigger's name pattern: the toggle is labelled "Show all options for {label}",
 * which ends with the label like every `Select` trigger does.
 *
 * For a `Select`, the trigger's accessible name is its **current value followed by its
 * label** - react-aria labels the button with the value element and then the label element,
 * in that order - so the match is a suffix. Getting this backwards costs a five-minute
 * timeout with a call log that only says the locator never resolved, which is what
 * `chooseType` in `questions.ts` encodes as `/Type$/` without saying why.
 */
export async function chooseOption(scope: Locator, label: string, option: string): Promise<void> {
  const combobox = scope.getByRole("combobox", { name: label, exact: true });
  if ((await combobox.count()) > 0) {
    const field = combobox.first();
    await field.click();
    await scope.page().getByRole("option", { name: option, exact: true }).click();
    // The input's own text, not a trigger's label: a combobox displays the chosen item.
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

/** A label used inside a name regex, with the characters a regex would otherwise read. */
function escapeForName(label: string): string {
  return label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tick or untick one `show` target of a rule.
 *
 * IT MOVES TO THE "THEN SHOW" PHASE FIRST, because since 2026-08-30 that is the only phase
 * the targets are on and react-aria mounts one panel at a time. A caller left on "When"
 * would otherwise wait five minutes for a checkbox that is not in the document. Switching
 * here rather than in each spec is the same call `openRules` makes about the screen.
 *
 * Clicked by its visible label rather than by the checkbox itself, which is the convention
 * `questions-lifecycle.pw.ts` and `apps/portal/e2e/support/kitchen-sink.ts` both encode for
 * the same vendored control: react-aria puts a decorative indicator over the real input, so
 * a click aimed at the input is intercepted. The assertion still reads the input, because
 * checked-ness is what is being asserted.
 *
 * A filter narrows the list, so the target may be behind one. Callers that filter clear it
 * themselves; this helper assumes the unfiltered list, which is how the dialog opens.
 */
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

/** The target filter of the open wizard's "Then show" phase. */
export function targetFilter(page: Page): Locator {
  return field(page, "Filter targets");
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
 * Run a read that needs the save strip, from whichever of the builder's three screens the
 * caller is standing on, and put them back where they were.
 *
 * THE SAVE STRIP IS ON THE FORM SCREEN ONLY since 2026-08-26, so a spec standing on a step
 * or on the rules screen cannot see it. That is the product's behaviour rather than a test problem
 * - a person editing a step has to look at the form screen too - and this is that trip,
 * made once here instead of scattered through a dozen specs as a pair of screen switches
 * that would then have to be kept in step with each other.
 *
 * The return leg reads the current step out of the rail rather than taking it as an
 * argument, so a caller that was on the form screen already makes no trip at all.
 */
async function readingSaveState<T>(page: Page, read: () => Promise<T>): Promise<T> {
  // Which of the builder's three screens the caller is standing on, read from the rail
  // rather than tracked, so a spec that navigated by any route still comes back to where
  // it was. The rules screen joined the step screens on 2026-08-26; both lack the strip,
  // and only the form's own screen has it.
  const currentStep = page.locator('[data-rail-step-select][aria-current="page"]');
  const step =
    (await currentStep.count()) > 0
      ? await currentStep.getAttribute("data-rail-step-select")
      : null;
  const onRules = (await page.locator('[data-rail-item="rules"][aria-current="page"]').count()) > 0;
  if (step === null && !onRules) return read();

  await openFormDetails(page);
  const value = await read();
  if (step !== null) await openStep(page, step);
  else await openRules(page);
  return value;
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
 *
 * ONLY HONEST FOR THE FIRST SAVE OF A VISIT. "Last saved" left over from an earlier save
 * satisfies this immediately, so after any second edit it says nothing at all: pair
 * `savedStamp` with `waitForSaveAfter` instead, which is what issues 748 and 750 cost.
 */
export async function waitForSaved(page: Page): Promise<void> {
  await readingSaveState(page, async () => {
    // "Last saved ...", not "Saved ...": the strip shows the state alone now, with the
    // model sentence behind a "?" beside it, so the state says which of the two it is.
    await expectSavedSentence(page);
  });
}

/**
 * The builder's paused-autosave notice, rendered above all three screens.
 *
 * `components/forms/form-builder.tsx` puts `SaveNotices` at the top of the builder's own
 * tree rather than inside the screen switch, so this is findable from a step, from the
 * rules screen and from the form's own screen alike.
 */
function pausedNotice(page: Page): Locator {
  return page.getByTestId("qcms-autosave-paused");
}

/**
 * What a paused autosave means for the caller, per reason, in the caller's terms.
 *
 * The sentences the product shows are the author's ("a form needs at least one step");
 * these are the test author's, because the reader of this message is holding a fixture that
 * did not persist rather than a form they are building.
 */
const PAUSE_HINTS: Readonly<Record<string, string>> = {
  noSteps: "the draft has no steps yet - add one, and pin a published question into it.",
  emptyStep:
    "a step has no pins. The smallest persistable form is one step holding one pin of a " +
    "PUBLISHED question, so a fixture built as createForm + addStep never reaches the server.",
  ruleWithoutTarget:
    'a rule has no "Then show" target. A rule arrives targetless, so commit one before ' +
    "waiting on a save.",
};

/**
 * Wait for the strip to say a save landed, and NAME A PAUSED AUTOSAVE rather than time out
 * on one (issue 569).
 *
 * Without this the whole family of unsaveable-draft traps presents as thirty seconds of
 * silence followed by "expected to contain text /^Last saved /", which reads like a
 * selector problem or a slow server and is neither: the draft was never posted, on purpose,
 * and no amount of waiting will change that. The reason is already in the DOM - the pause
 * notice carries `data-paused-reason` - so the wait ends by reading it and saying so.
 *
 * The read happens on FAILURE rather than before the wait, deliberately. A pause is
 * computed from the draft on every render, so it is on screen for the frame between an
 * `addStep` and the pin that fills it; failing fast on a glimpse of it would turn an
 * ordinary authoring sequence into a red. Thirty seconds of it standing is not a glimpse.
 */
async function expectSavedSentence(page: Page): Promise<void> {
  try {
    await expect(saveState(page)).toContainText(/^Last saved /, { timeout: 30_000 });
  } catch (cause) {
    await throwPausedAutosave(page, cause);
  }
}

/** Rethrow `cause`, or a sentence naming the pause that is actually holding the save. */
async function throwPausedAutosave(page: Page, cause: unknown): Promise<never> {
  const notice = pausedNotice(page);
  const reason =
    (await notice.count()) > 0 ? await notice.getAttribute("data-paused-reason") : null;
  if (reason === null || reason === "") throw cause;
  const hint = PAUSE_HINTS[reason] ?? "see `unsaveableReason` in `lib/forms/draft.ts`.";
  throw new Error(
    `the draft never saved because AUTOSAVE IS PAUSED (unsaveableReason: ${reason}): ${hint}\n` +
      "See the note on the smallest persistable form at the top of `e2e/support/forms.ts`.",
    { cause },
  );
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
 * The sentence the strip shows while a save is armed or in flight.
 *
 * Hardcoded rather than imported from the app's catalogue, the same way every other name in
 * this file is: it is what a reader sees and what a screen reader would announce, so a
 * helper that read it from the same constant the component does would keep passing after
 * the string went missing.
 */
const SAVING = "Saving...";

/**
 * The instant of the last successful autosave, or `""` before the first one this visit.
 *
 * The attribute rather than the sentence, and that is the whole point of the attribute:
 * see `waitForSaveAfter`.
 *
 * ## It waits for the strip to settle first, and that is the fix for issues 748 and 750
 *
 * What this returns is a BASELINE: `waitForSaveAfter` proves an edit was stored by watching
 * the instant move off it. So a baseline read while an EARLIER save is still armed or in
 * flight is moved by that earlier save rather than by the edit under test, and the wait
 * that follows passes without the edit ever reaching the server. Both flakes are that one
 * sentence: `forms-publish.pw.ts` pinned a question (600ms of debounce), read the stamp
 * immediately, authored a rule, and waited for a change the pin's own save had already
 * made - then reloaded into a draft the rule had never reached, and published `0 rules.`.
 *
 * Waiting for the strip to stop saying "Saving..." is what makes the baseline final, and it
 * is exact rather than approximate: `components/forms/form-builder.tsx` sets the status to
 * `saving` in the effect that ARMS the debounce, not in the callback that fires it, so that
 * one sentence covers the armed window and the in-flight window together. Anything else on
 * the strip means no save is outstanding, and the next change to `data-saved-at` can only
 * be the caller's own edit.
 *
 * "Not saved yet" and "The last save failed." are settled states too, and are read rather
 * than waited out: a fresh visit has stored nothing, and a failed save is the caller's wait
 * to report rather than this helper's to hang on.
 *
 * ## "Saving..." CAN BE STALE, which is the one way this waits for something that will not
 * come (issue 569)
 *
 * The builder arms its debounce and sets `saving` in the same effect, and the effect's
 * cleanup cancels the timer when the draft changes. So an edit that makes the draft
 * unsaveable within the debounce window - adding a step, which is empty until something is
 * pinned into it - cancels the armed save and leaves the strip saying "Saving..." with
 * nothing in flight. The pause is what a caller has to act on, so this names it rather than
 * spending thirty seconds and reporting a locator.
 *
 * A caller avoids the state entirely by taking its baseline BEFORE the gesture that pauses
 * the draft rather than between that gesture and the edit that lifts the pause, which is
 * what every `addStep` caller in this directory now does.
 */
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
 *
 * `previous` has to come from `savedStamp`, which settles before it reads. A baseline taken
 * any other way can be moved by a save the caller did not make, and then this returns
 * before the caller's own edit is stored - which is exactly what issues 748 and 750 were.
 */
export async function waitForSaveAfter(page: Page, previous: string): Promise<void> {
  await readingSaveState(page, async () => {
    try {
      await expect(saveStatus(page)).not.toHaveAttribute("data-saved-at", previous, {
        timeout: 30_000,
      });
    } catch (cause) {
      // The same rescue `expectSavedSentence` makes, and this is the leg that usually
      // times out: a paused autosave leaves the PREVIOUS save's instant on the strip, so
      // it is the stamp that never moves rather than the sentence that never arrives.
      await throwPausedAutosave(page, cause);
    }
    await expectSavedSentence(page);
  });
}

/** The issue summary the validation panel announces. */
export function issueSummary(page: Page): Locator {
  return page.getByTestId("qcms-issue-summary");
}

/** One issue code, wherever it is rendered (the panel, a rule, or a pin row). */
export function issue(scope: Page | Locator, code: string): Locator {
  return scope.locator(`[data-issue-code="${code}"]`);
}

/**
 * Move one step within the form, from the rail's own row menu.
 *
 * The rail is where a step is reordered (`components/forms/rail-steps.tsx`), which is also
 * the only place it can be: the step screen shows one step and knows nothing about the
 * order of its siblings.
 *
 * Written for exit criterion 2, which needs a target to BECOME backward without anyone
 * choosing an ineligible one (Code Owner, 2026-08-30) - moving the step that holds it in
 * front of the question its rule reads is the way an author actually trips that.
 */
export async function moveStep(page: Page, title: string, action: "up" | "down"): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: `Actions for step ${title}`, exact: true }).click();
  await page
    .getByRole("menuitem", { name: action === "up" ? "Move up" : "Move down", exact: true })
    .click();
}
