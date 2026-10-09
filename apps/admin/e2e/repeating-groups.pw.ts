import type { Locator, Page } from "@playwright/test";

import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  domShape,
  headingTags,
  withNormalizedInstanceIds,
  type DomShape,
} from "./support/dom-shape.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addRepeatGroup,
  addRule,
  addStep,
  chooseConditionOperator,
  chooseOption,
  chooseRadio,
  closeRuleEditor,
  createForm,
  field,
  groupPanel,
  issue,
  openFormDetails,
  openGroupPanel,
  openRulePhase,
  openStep,
  pickerChoice,
  pickerCommit,
  pinQuestion,
  pinQuestions,
  rule,
  savedStamp,
  usePinRowMenu,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Authoring a repeating group, driven through the browser (task 074; acceptance cases 58 to 61,
 * and 62 for the reason below, of `plan/repeating-groups-and-table-input.md` section 11).
 *
 * ## Why one journey rather than four specs
 *
 * The four cases are one authoring loop and each depends on the previous one's output: there is
 * no rule to put a scope chip on until a group exists, nothing for the bench to count until a
 * rule reads a group, and nothing for the portal to serve until the form is published. Building
 * the form four times would be the slowest part of the run and would prove nothing extra.
 *
 * ## What is NOT here, and why
 *
 * The question editor. ADR-42's load-bearing property is that a question does not know it is
 * repeated: `QUESTION_TYPES` is unchanged, no component is registered, and the five questions
 * below are authored by the ordinary `createDraft` helper every other spec uses. That absence is
 * the dividend, so the spec that would have exercised a new question type is the spec that does
 * not exist.
 *
 * ## Case 62 is here because 074 merged second
 *
 * The filtered library picker is task 077's deliverable - it is the table presentation's own
 * publish refusal being surfaced rather than group authoring in general - but its walk needs
 * 077's column view and this task's group panel on `main` together, so the Code Owner ruled on
 * 2026-10-03 that it is an exit criterion of whichever of the two merges second. That is this
 * task (077 merged as PR #1038), so the walk is the fifth test below and the wiring it drives is
 * the one branch `group-panel.tsx` gained for it.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("repeat");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Ids are never reused (R6) and the harness database survives a local rerun. */
const RUN = Date.now().toString(36);

const COUNT = `e2e-rp-count-${RUN}`;
const PURPOSE = `e2e-rp-purpose-${RUN}`;
const PASSPORT = `e2e-rp-passport-${RUN}`;
const FARE = `e2e-rp-fare-${RUN}`;
const DECLARATION = `e2e-rp-declaration-${RUN}`;
/**
 * The three questions case 62 needs, and each one earns its place.
 *
 * `NOTES` is a `longText` the group HOLDS, so the column view has a refused row to list. `MEMO` is
 * a second `longText` that is never pinned, which is the one the filtered picker must not offer -
 * an already-pinned question is listed without a checkbox whatever its type, so asserting the
 * absence of `NOTES` alone would pass with no filter at all. `SEAT` is an unpinned `date`, so the
 * same dialog can be shown to still offer an allowed type rather than to have emptied itself.
 */
const NOTES = `e2e-rp-notes-${RUN}`;
const MEMO = `e2e-rp-memo-${RUN}`;
const SEAT = `e2e-rp-seat-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** The group the whole spec is about, named as an author would name it. */
const GROUP = "Passengers";
/** The id `addGroup` mints from that name, asserted rather than assumed on first use. */
const GROUP_ID = "grp_passengers";

const FORM_SLUG = `e2e-rp-booking-${RUN}`;
let formId = "";

/**
 * The two rules the scope test authors, by the ids the builder MINTED for them.
 *
 * Read off the open wizard rather than written out, for the reason `addRule` records: a rule id is
 * minted from the question the rule starts against, so hard-coding one here would be asserting
 * this spec's guess about `mintId` rather than the rule the builder actually made.
 */
let perInstanceRuleId = "";
let wholeGroupRuleId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Author one question and publish v1. */
async function publishQuestion(page: Page, slug: string, typeLabel: string): Promise<void> {
  await createDraft(page, slug, typeLabel);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
}

/** The maximum field, which is required on both bounded count sources (Q4 as amended by Q14). */
function maxField(page: Page): Locator {
  return field(page, "Maximum instances");
}

test("defines a group, walks all three count sources, and round-trips through save (case 58)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A form can only pin PUBLISHED versions (022). Five questions: a number for the
  // `fromAnswer` count source, one beside it, two inside the group, and one after its span.
  await publishQuestion(page, COUNT, "Number");
  await publishQuestion(page, PURPOSE, "Short text");
  await publishQuestion(page, PASSPORT, "Short text");
  await publishQuestion(page, FARE, "Short text");
  await publishQuestion(page, DECLARATION, "Short text");

  formId = await createForm(page, FORM_SLUG, "Booking");

  await addStep(page, "Trip");
  await pinQuestion(page, questionIdFor(COUNT), 1);

  // THE GROUP SITS BESIDE AN ORDINARY QUESTION, which is the shape the financial case in
  // `plan/repeating-groups-and-table-input.md` section 1.3 describes ("an income-source loop sits
  // beside other questions") and the shape this walk needs: a step whose only item is a group is
  // the subject of ruling Q30, fixed inside this wave by task 076, and a walk that depended on it
  // would be testing another task's change rather than this one's authoring.
  await addStep(page, "Travellers");
  await pinQuestion(page, questionIdFor(PURPOSE), 1);
  await addRepeatGroup(page, GROUP);
  const panel = groupPanel(page);
  await expect(panel).toHaveAttribute("data-group-id", GROUP_ID);

  // The two member questions, pinned through the same library picker a step's own pins go
  // through - which is ADR-42's property as a gesture: a group member is pinned, versioned and
  // listed exactly as a step's pin is.
  await pinQuestions(page, [
    { questionId: questionIdFor(PASSPORT), version: 1 },
    { questionId: questionIdFor(FARE), version: 1 },
  ]);

  // A STEP AFTER THE GROUP'S WHOLE SPAN, which the next two tests need and this one needs for
  // the `fromAnswer` picker to be the only forward-only question on screen: a rule that reads
  // the whole group may only target something that follows all of it (forward-only rule 2), so
  // without a question after the span there is nothing such a rule could legally show.
  await addStep(page, "Declaration");
  await pinQuestion(page, questionIdFor(DECLARATION), 1);
  await openGroupPanel(page, GROUP);

  // --- the count source, all three of them ---------------------------------
  //
  // A fresh group is `open` with no maximum, which is the one state publish refuses: `max` is
  // required on both bounded sources because a group's own maximum is the only bound on how many
  // instances a respondent may create (SEC-16). The panel says so where the field is.
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByTestId("qcms-group-max-missing")).toBeVisible();

  // FIXED shows no maximum AT ALL, rather than a disabled one: the count is its own bound, so a
  // second field would be a control with nothing it could mean.
  await chooseRadio(page, "Always the same number");
  await expect(field(page, "Number of instances")).toBeVisible();
  await expect(maxField(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);
  await fillStable(field(page, "Number of instances"), "3");

  // FROM AN EARLIER ANSWER offers the number questions pinned strictly before this group's span
  // and outside every group. Both halves are publish refusals pre-empted at the control:
  // `REPEAT_COUNT_BACKWARD_REF` and `REPEAT_COUNT_INSIDE_GROUP`.
  await chooseRadio(page, "From an earlier answer");
  await chooseOption(panel, "Count question", questionIdFor(COUNT));
  await expect(maxField(page)).toBeVisible();

  // OPEN, which is the presentation 073 serves and the one this spec publishes.
  await chooseRadio(page, "The respondent adds and removes");
  await fillStable(field(page, "Minimum instances"), "1");

  // --- the publish refusal, read where an author meets it ------------------
  //
  // Asserted BEFORE the maximum is filled in, because that is the state the author is actually
  // in: the field is marked required, the grid flags the group, and publish refuses with
  // `REPEAT_MAX_MISSING` naming the group rather than the form.
  await waitForSaved(page);
  await openFormDetails(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();
  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  await expect(issue(rejected, "REPEAT_MAX_MISSING")).toBeVisible();
  await expect(rejected).toContainText("only limit on how many instances");

  // --- the maximum, the instance heading, and the presentation -------------
  await openGroupPanel(page, GROUP);
  const beforeMax = await savedStamp(page);
  await fillStable(maxField(page), "9");
  await expect(page.getByTestId("qcms-group-max-missing")).toHaveCount(0);

  // The instance heading, with the live preview. `{n}` is the live one-based ordinal and the only
  // placeholder the kernel substitutes, so the preview puts a 1 in it and nothing else.
  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger 1");

  // An unknown placeholder previews WITH ITS BRACES, which is the honest rendering: a respondent
  // would read them too, and it is `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN` at publish. A preview
  // that silently dropped the token would hide the refusal it exists to make visible.
  await fillStable(field(page, "Heading for each instance"), "Passenger {index}");
  await expect(page.getByTestId("qcms-group-label-preview")).toContainText("Passenger {index}");
  await fillStable(field(page, "Heading for each instance"), "Passenger {n}");

  // All three presentations are offered, because the field is the kernel's and the choice is a
  // LAYOUT: switching changes no answer, no key and no id (ADR-42). This spec leaves it stacked,
  // which is the presentation 073 serves; what sits behind the other two is 076's and 077's.
  await chooseRadio(page, "A table");
  await chooseRadio(page, "One page per instance");
  await chooseRadio(page, "All instances on one page");

  await waitForSaveAfter(page, beforeMax);

  // --- the round trip ------------------------------------------------------
  //
  // The draft is on the server, not just on screen: a reload rebuilds it from the API, and every
  // field the panel set is read back from that rebuild.
  await page.reload();
  await openGroupPanel(page, GROUP);
  await expect(field(page, "Group name")).toHaveValue(GROUP);
  await expect(field(page, "Heading for each instance")).toHaveValue("Passenger {n}");
  await expect(field(page, "Minimum instances")).toHaveValue("1");
  await expect(maxField(page)).toHaveValue("9");
  await expect(page.getByRole("radio", { name: "The respondent adds and removes" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "All instances on one page" })).toBeChecked();

  // THE GRID STATES THE SPAN, and the step editor is where an author scans a step: the boundary
  // row names the group, counts its members and says what decides its size, and the member rows
  // follow it marked with the group they sit in.
  await openStep(page, "Travellers");
  const boundary = page.locator(`[data-pin-group-boundary="${GROUP_ID}"]`);
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText("Repeating group: Passengers");
  await expect(boundary).toContainText("2 questions");
  await expect(boundary).toContainText("respondent adds, 1 to 9");
  await expect(page.locator(`[data-pin-question="${questionIdFor(PASSPORT)}"]`)).toHaveAttribute(
    "data-pin-group",
    GROUP_ID,
  );
  // The step's own pin is outside the span, which is what makes the boundary mean something: the
  // same step holds a question and a group, and only one of the two rows is marked.
  await expect(page.locator(`[data-pin-question="${questionIdFor(PURPOSE)}"]`)).not.toHaveAttribute(
    "data-pin-group",
    GROUP_ID,
  );
});

test("states the scope on a per-instance rule, and offers all three group operators (case 59)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}`);

  // --- the scope chip ------------------------------------------------------
  //
  // Scope is implicit BY POSITION (ADR-42 section 3.4): a rule whose target sits inside a group
  // is evaluated once per live instance, and the condition the author wrote says nothing about
  // that. The chip is what pays for keeping the DSL small, so it is a deliverable rather than a
  // decoration - and the noun is the author's own, taken from their instance heading.
  const beforeScoped = await savedStamp(page);
  perInstanceRuleId = await addRule(page);
  const scoped = rule(page, perInstanceRuleId);
  await chooseOption(scoped, "Question", `${questionIdFor(PASSPORT)}@1`);
  await openRulePhase(page, "then");
  await scoped.getByText(questionIdFor(FARE), { exact: true }).click();
  await expect(page.getByTestId("qcms-rule-scope")).toContainText("evaluated per Passenger");
  await expect(page.getByTestId("qcms-rule-scope")).toContainText("once for each Passenger");
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeScoped);

  // And it reads on the rules table too, which is the screen an author answers "what does this
  // form do" from: a per-passenger rule reads very differently from a whole-form one.
  await expect(page.locator(`[data-rule-scope="${perInstanceRuleId}"]`)).toContainText(
    "evaluated per Passenger",
  );

  // --- the three structured editors ----------------------------------------
  const beforeGroupRule = await savedStamp(page);
  wholeGroupRuleId = await addRule(page);
  const groupRule = rule(page, wholeGroupRuleId);

  // `instanceCount` is a group picker, a comparison picker and a number. The comparison reuses
  // the ORDERING operators' own names as a field rather than a second vocabulary.
  await chooseConditionOperator(groupRule, "how many instances a group has");
  await expect(groupRule.getByRole("button", { name: /Group$/u })).toBeVisible();
  await chooseOption(groupRule, "Comparison", "is at least");
  await fillStable(groupRule.getByRole("textbox", { name: "Instance count" }), "2");

  // `anyInstance` is a group picker plus a NESTED condition, which is the editor's own recursion:
  // the nested tree is addressed as child 0 exactly as `not`'s is, so it reuses the depth
  // accounting rather than keeping a second one.
  await chooseConditionOperator(groupRule, "at least one instance of a group matches");
  await expect(groupRule).toContainText(`For one instance of Passenger`);
  await expect(groupRule.getByRole("button", { name: /Question$/u })).toBeVisible();

  // `everyInstance` states its EMPTY-GROUP READING at the control, because the editor is where
  // an author decides to use the operator (Q7, ruled 2026-09-29).
  await chooseConditionOperator(groupRule, "every instance of a group matches");
  // The nested condition reads a question INSIDE the group, which resolves per instance - the
  // airline's "every passenger holds a passport" written as an ordinary condition.
  await chooseOption(groupRule, "Question", `${questionIdFor(PASSPORT)}@1`);
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText(
    "With no instances at all this is false",
  );
  await expect(groupRule.getByTestId("qcms-every-reading")).toContainText("Negating it");

  // Its target has to follow the group's WHOLE SPAN, which is forward-only rule 2 applied to a
  // span rather than to a position - so the question after the group is offered and a member of
  // the group is not.
  await openRulePhase(page, "then");
  await expect(
    groupRule.getByRole("checkbox", { name: questionIdFor(DECLARATION), exact: true }),
  ).toBeEnabled();
  await groupRule.getByText(questionIdFor(DECLARATION), { exact: true }).click();
  await expect(
    groupRule.getByRole("checkbox", { name: questionIdFor(FARE), exact: true }),
  ).toBeDisabled();
  await closeRuleEditor(page);
  await waitForSaveAfter(page, beforeGroupRule);

  // A whole-form target carries no chip, which is the other half of the chip meaning anything.
  await expect(page.locator(`[data-rule-scope="${wholeGroupRuleId}"]`)).toHaveCount(0);
});

test("evaluates a rule against hypothetical instances, including zero (case 60)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${formId}/rules`);

  const bench = page.getByTestId("qcms-bench-screen");
  await expect(bench).toBeVisible();

  // The `everyInstance` rule, which is the one the Q7 ruling exists for.
  await chooseOption(bench, "Rule", wholeGroupRuleId);
  // A TEXTBOX, not a spinbutton: the kit's `NumberField` is the vendored react-aria control,
  // which renders a text input flanked by its own Decrease and Increase buttons rather than a
  // native `<input type="number">` (ADR-22 - the admin composes the vendored stack and does not
  // substitute a platform control for it).
  const instances = bench.getByRole("textbox", { name: `Instances of ${GROUP}` });
  await expect(instances).toBeVisible();

  // --- ZERO INSTANCES, which is the ruled case and the one nobody thinks to try ---
  //
  // `everyInstance` over a group with no live instance is FALSE, not vacuously true: "every
  // passenger holds a passport" is not a true statement about a booking with no passengers. The
  // bench is where that becomes discoverable rather than documented.
  await setInstanceCount(instances, "0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "noMatch", {
    timeout: 30_000,
  });
  // With no instance there is no per-instance answer to prompt for either, which is the honest
  // rendering of a group with nothing in it.
  await expect(bench.getByTestId("qcms-bench-reference")).toHaveCount(0);

  // --- two instances, answered -------------------------------------------
  await setInstanceCount(instances, "2");
  const prompts = bench.getByTestId("qcms-bench-reference");
  await expect(prompts).toHaveCount(2);
  // One control per instance, named for the instance it answers: six passenger fields that all
  // answered to one label would be six fields nobody could tell apart.
  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 1)` }),
    "PA1",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "noMatch", {
    timeout: 30_000,
  });

  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 2)` }),
    "PA2",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(bench.getByTestId("qcms-bench-outcome")).toHaveAttribute("data-outcome", "match", {
    timeout: 30_000,
  });

  // --- a PER-INSTANCE rule reports one verdict per instance ---------------
  //
  // The rule whose target sits inside the group. This is the surface where an author finds out
  // that a rule they wrote reads one instance rather than the whole group, and the other way
  // round.
  await chooseOption(bench, "Rule", perInstanceRuleId);
  const perInstanceCount = bench.getByRole("textbox", { name: `Instances of ${GROUP}` });
  await setInstanceCount(perInstanceCount, "2");
  await fillStable(
    bench.getByRole("textbox", { name: `${questionIdFor(PASSPORT)}@1 (instance 2)` }),
    "PA2",
  );
  await bench.getByRole("button", { name: "Run preview" }).click();
  const outcomes = bench.getByTestId("qcms-bench-instance-outcomes");
  await expect(outcomes).toBeVisible({ timeout: 30_000 });
  await expect(outcomes).toContainText("Instance 1: does not match");
  await expect(outcomes).toContainText("Instance 2: matches");

  // And at zero instances it says so in words rather than rendering nothing: a list that
  // disappeared would leave the author looking at one verdict with no sign that it was a verdict
  // about no instances at all.
  await setInstanceCount(perInstanceCount, "0");
  await bench.getByRole("button", { name: "Run preview" }).click();
  await expect(outcomes).toContainText("there are no instances", { timeout: 30_000 });
});

test("expands a group through the portal's own renderer (case 61)", async ({ page, context }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // The form has to be published for a respondent to have anything to compare against, and the
  // two rules authored above are legal, so this is the first clean publish of it.
  await page.goto(`/forms/${formId}`);
  await openFormDetails(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();
  await expect(page.getByText(/^Published as v/)).toBeVisible({ timeout: 60_000 });

  /**
   * ## What is compared, and why it is the same document
   *
   * One definition seen from two sides. The **portal** serves the compiled documents stored at
   * publish time (ADR-18), projected onto the API's qualified `visibleQuestions` and expanded
   * per live instance by `A2UIStepRenderer`. The **admin preview** compiles the same definition
   * and draws it with the same projection, the same expansion and the same renderer - from a
   * roster it mints itself, because a preview has no session to take one from.
   *
   * A repeating group is the sharpest version of this assertion, because the expansion is the
   * only transform in the stack that reads the STORED TEMPLATE: the compiler is answer-blind and
   * emits the member controls once, so a second expansion written for the admin would be the one
   * part of the preview that could disagree with what a respondent gets. If `expandRepeatGroups`
   * is genuinely shared the two subtrees are identical, and this says so.
   *
   * ## The two deliberate differences
   *
   * **Heading levels**, as the non-repeating comparison already asserts (issue #537): the portal
   * serves the document as the whole page and the admin embeds it, so the author's side is
   * demoted by exactly one level. Asserted rather than normalized away.
   *
   * **Instance ids**, which are a generated identity in the same category as the `id` and
   * react-aria values `support/dom-shape.ts` already drops. The portal's come out of the
   * session's instance ledger and the preview mints `ins_p1`; they are normalized positionally on
   * both sides, so the comparison still notices a different NUMBER of instances or a different
   * order. See `withNormalizedInstanceIds`.
   *
   * ## Why both sides show one instance
   *
   * The group is `open` with `min: 1`. Serving a step mints `min` (or one) the first time, so a
   * respondent sees a card to fill rather than an empty group and a button; the preview's own
   * default is the same `min`. Neither side is told the number by this test, which is the point -
   * they agree because they read the same declaration.
   */

  // --- the respondent's side ------------------------------------------------
  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${FORM_SLUG}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);
  // Walk to the step the group is on: the trip question comes first. The cursor's forward control
  // is addressed by its testid rather than by its name, which is the convention
  // `apps/portal/e2e/support/kitchen-sink.ts` sets - the control is "Continue" or "Submit"
  // depending on where in the walk it sits. The wait is on the DOM the next step renders rather
  // than on the fetch behind it: what this test is about is what the two surfaces DRAW, and a
  // response predicate is a second thing that can be wrong about a step that arrived.
  await expect(portal.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await portal.getByTestId("primary-action").click();
  await expect(portal.getByRole("heading", { name: GROUP })).toBeVisible({ timeout: 60_000 });
  await expect(portal.getByRole("heading", { name: "Passenger 1" })).toBeVisible();
  // TWO INSTANCES, ONE ANSWERED AND ONE NOT, which is the asymmetric state this case is for.
  //
  // It is the shape that an expansion comparison most wants and that the walk could not take
  // until issue #1041 was fixed (PR #1036, which also carries this change): the hydrated portal
  // used to render a member control that a per-instance rule hides, because it expands before it
  // prunes and no visible set reached either pass, while the preview pruned correctly. The two
  // surfaces diverged on exactly this state, so the earlier version of this case answered the one
  // instance it had and said so.
  //
  // What it buys now that both sides prune: the rule case 59 authored shows the fare question
  // inside the instance that answered its passport, so with passenger 1 answered and passenger 2
  // not, one instance carries the fare control and the other must not. A per-instance pruning
  // asymmetry is invisible while a group has one instance, and it is the one asymmetry an
  // expansion can get wrong without any count being wrong. It also exercises the per-instance
  // answer key end to end: the reveal happens only if `ins_1/q_passport` reached the evaluator as
  // that instance's answer and nobody else's.
  await portal.locator('[data-qcms-repeat-action="add"]').click();
  await expect(portal.getByRole("heading", { name: "Passenger 2" })).toBeVisible({
    timeout: 60_000,
  });
  const passports = portal.locator(`input[name$="/${questionIdFor(PASSPORT)}"]`);
  await expect(passports).toHaveCount(2);
  await passports.first().fill("PA1");
  await passports.first().blur();
  // Passenger 1 gains the fare control and passenger 2 does not, which is the assertion the
  // hydrated path failed before #1041.
  await expect(portal.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(1);
  await expect(
    portal
      .locator("fieldset[data-qcms-instance]")
      .nth(0)
      .locator(`input[name$="/${questionIdFor(FARE)}"]`),
  ).toBeVisible();
  await expect(
    portal
      .locator("fieldset[data-qcms-instance]")
      .nth(1)
      .locator(`input[name$="/${questionIdFor(FARE)}"]`),
  ).toHaveCount(0);
  await waitForRenderedStep(portal);
  // A RESPONDENT CAN CHANGE THE ROSTER, which is the other half of the one difference the
  // comparison normalises below: the portal passes `onAdd` and `onRemove`, so the group's own
  // controls are live.
  await expect(portal.locator('[data-qcms-repeat-action="add"]')).toBeEnabled();
  await expect(portal.locator('[data-qcms-repeat-action="remove"]').first()).toBeEnabled();
  const respondent = comparable(await domShape(rendererRoot(portal)));
  await portal.close();

  // --- the author's side ----------------------------------------------------
  await page.goto(`/forms/${formId}/preview`);
  const surface = page.getByTestId("qcms-preview-surface");
  await expect(surface.getByText("E2E Number question")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(surface.getByRole("heading", { name: "Passenger 1" })).toBeVisible({
    timeout: 60_000,
  });
  // HIDDEN UNTIL THIS INSTANCE ANSWERS, which is the per-instance rule read through the preview's
  // own roster: the fare question is the rule's target, the rule is evaluated once per live
  // instance, and nothing has been answered yet. Both surfaces hold this now; before #1041 only
  // this one did.
  await expect(surface.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(0);
  // The same two-instance, one-answered state, set through the control that owns the preview's
  // roster: an author's hypothesis rather than a respondent's Add.
  await setInstanceCount(page.getByRole("textbox", { name: `Instances of ${GROUP}` }), "2");
  await expect(surface.getByRole("heading", { name: "Passenger 2" })).toBeVisible({
    timeout: 60_000,
  });
  const previewPassports = surface.locator(`input[name$="/${questionIdFor(PASSPORT)}"]`);
  await expect(previewPassports).toHaveCount(2);
  await previewPassports.first().fill("PA1");
  await previewPassports.first().blur();
  await expect(surface.locator(`input[name$="/${questionIdFor(FARE)}"]`)).toHaveCount(1);
  // WAIT FOR REACT TO OWN THE PREVIEW before reading it. The pane re-renders on every answer and
  // every instance count, and a step switch re-mounts the rendered document - so a shape read too
  // early is the server-rendered form of the vendored controls, missing the `tabindex`, `type` and
  // `value` React attaches. Comparing that against a hydrated tree fails for a reason that is not
  // fidelity, which is the same trap `waitForRenderedStep` exists for on the other side.
  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="qcms-preview-surface"] form');
    const form = forms[0];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
  // AND AN AUTHOR CANNOT. The preview passes no `onAdd` or `onRemove`, so the group's controls
  // render inert: the roster here is the author's hypothesis, set by the instance-count field
  // under the frame, not a respondent's to change. Stated as an assertion before the deep
  // comparison normalises it, so a preview that started handing a respondent's controls to an
  // author fails here rather than passing quietly.
  await expect(surface.locator('[data-qcms-repeat-action="add"]')).toBeDisabled();
  await expect(surface.locator('[data-qcms-repeat-action="remove"]').first()).toBeDisabled();
  const author = comparable(await domShape(surface.locator("form").first()));

  // A sanity check first, so a failure below reads as a divergence rather than as two empty trees
  // agreeing with each other.
  expect(author.children.length, "the preview should render the group").toBeGreaterThan(0);

  // The embed's deliberate differences, stated before the deep comparison so a regression in
  // either reads as "the headings moved" rather than as an unexplained tree diff.
  //
  // As the page, the compiled step carries the form title as `h1`, the step title as `h2`, the
  // group's own label as `h3` and each instance's as `h4`. Embedded, the first three move down
  // one - and the INSTANCE's does not, because it is clamped: an instance heading is a node PROP
  // whose schema enum stops at `h4` (`packages/ui/src/repeat/repeat.schema.ts`), so there is no
  // `h5` for the demotion to reach. That is 073's documented tail behaviour rather than slack in
  // this test, and it is encoded here rather than normalised away so a preview that stopped
  // demoting the group's label, or started demoting it twice, still fails.
  expect(headingTags(respondent), "the compiled step should carry headings").toContain("h4");
  expect(headingTags(author), "the embedded preview demotes by one, clamping the instance").toEqual(
    headingTags(asEmbedded(respondent)),
  );
  expect(headingTags(author), "an embedded document must not claim the page").not.toContain("h1");

  expect(author).toEqual(asEmbedded(respondent));
});

test("filters the column picker to the allowed cell types, and says why (case 62)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // `longText` is one of the two types Q12 refuses as a column, so it is what "only the allowed
  // cell types" has to exclude; `date` is one of the five it allows. See the slugs' own note for
  // why there are two long-text questions rather than one.
  await publishQuestion(page, NOTES, "Long text");
  await publishQuestion(page, MEMO, "Long text");
  await publishQuestion(page, SEAT, "Date");

  await page.goto(`/forms/${formId}`);
  await openGroupPanel(page, GROUP);

  // --- while the group is stacked, every type is offered -------------------
  //
  // Asserted FIRST, because it is what makes the filter below an observation rather than an
  // assumption: the same control, the same library and the same question, offered here and absent
  // there, so the difference is the presentation and nothing else.
  await page.getByRole("button", { name: "Add question from library" }).click();
  const stackedPicker = page.getByRole("dialog");
  await expect(stackedPicker).toBeVisible();
  await expect(stackedPicker.getByTestId("qcms-picker-column-note")).toHaveCount(0);
  await expect(pickerChoice(stackedPicker, questionIdFor(MEMO), 1)).toBeVisible();
  const notesChoice = pickerChoice(stackedPicker, questionIdFor(NOTES), 1);
  await expect(notesChoice).toBeVisible();
  await notesChoice.check();
  await pickerCommit(stackedPicker, 1).click();
  await expect(stackedPicker).toBeHidden();

  // --- the table presentation, and its column view ------------------------
  const beforeTable = await savedStamp(page);
  await chooseRadio(page, "A table");
  const columns = page.getByTestId("table-column-view");
  await expect(columns).toBeVisible();

  // THE MEMBER LIST SEEN AS COLUMNS, which is the view being reachable at all: this component is
  // task 077's and this panel renders it, so the rows here are the three pins the group holds and
  // their order is the order the table draws them in.
  const columnRows = columns.locator("tbody tr");
  await expect(columnRows).toHaveCount(3);
  await expect(columns.locator(`tr[data-column="${questionIdFor(PASSPORT)}"]`)).toContainText(
    "Short text",
  );

  // A REFUSED COLUMN IS LISTED, not hidden. The long-text member was added while the group was
  // stacked and is still a member, so the row stays and says why - otherwise publish would refuse
  // a column the panel does not show.
  const refusedRow = columns.locator(`tr[data-column="${questionIdFor(NOTES)}"]`);
  await expect(refusedRow.getByTestId("column-refused")).toBeVisible();
  await expect(columns.getByTestId("column-types-refused")).toBeVisible();

  // THE SENTENCE, on the view itself: the five allowed types, and the stacked presentation as the
  // way out. Both halves are asserted by their own words rather than by a testid alone, because
  // the words are the deliverable - a refusal that names no alternative is a dead end.
  const note = columns.getByTestId("column-type-note");
  await expect(note).toContainText("Short text, Number, Date, Yes or no, Single choice");
  await expect(note).toContainText("Present this group as stacked instead");

  // --- the filtered picker, which is case 62 itself -----------------------
  await columns.getByRole("button", { name: "Add column" }).click();
  const columnPicker = page.getByRole("dialog");
  await expect(columnPicker).toBeVisible();

  // SAID BEFORE THE LIST, inside the dialog, because a filtered library looks exactly like a short
  // one: an author who cannot find their long-text question has no way to tell "not offered" from
  // "not in the library" unless the dialog says so.
  await expect(columnPicker.getByTestId("qcms-picker-column-note")).toContainText(
    "Present this group as stacked instead",
  );

  // ONLY THE ALLOWED TYPES. The unpinned long-text question is gone from the dialog ENTIRELY -
  // not listed and disabled, which is what this picker does for a deprecated or already-pinned
  // version. A type that cannot be a column is a different kind of question rather than a state
  // of a row, and a list two-sevenths of which can never be chosen is a list to read past.
  //
  // Asserted on `MEMO` and on its id rather than on a checkbox alone, which is the difference
  // between a load-bearing assertion and one that cannot fail: `NOTES` is in the group by now, so
  // it has no checkbox whatever the filter does, while `MEMO` is pinnable and would be offered.
  await expect(pickerChoice(columnPicker, questionIdFor(MEMO), 1)).toHaveCount(0);
  await expect(columnPicker.getByText(questionIdFor(MEMO))).toHaveCount(0);
  await expect(columnPicker.getByText(questionIdFor(NOTES))).toHaveCount(0);
  // And an allowed type is still offered, so this is a filter rather than an emptied list.
  await expect(pickerChoice(columnPicker, questionIdFor(SEAT), 1)).toBeVisible();
  await columnPicker.getByRole("button", { name: "Cancel" }).click();
  await expect(columnPicker).toBeHidden();

  // --- the refusal the filter pre-empts, read at publish ------------------
  //
  // The sentence on the panel and the sentence at publish are one ruling seen from two sides
  // (Q12). This is the side the filter exists to keep an author away from, and the member that
  // reaches it is the one added before the presentation changed.
  await waitForSaveAfter(page, beforeTable);
  await openFormDetails(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Publish v/ })
    .click();
  const rejected = page.getByTestId("qcms-publish-rejected");
  await expect(rejected).toBeVisible({ timeout: 30_000 });
  await expect(issue(rejected, "TABLE_COLUMN_TYPE_NOT_ALLOWED")).toBeVisible();
  await expect(rejected).toContainText("presentation to stacked");

  // --- the way out, taken ------------------------------------------------
  //
  // Removing the member is one of the two exits both sentences name, and taking it here is what
  // proves the refusal was about that column rather than about the presentation: the group is
  // still a table afterwards and the form is publishable again.
  await openGroupPanel(page, GROUP);
  await usePinRowMenu(page, questionIdFor(NOTES), "remove");
  await expect(columns.locator(`tr[data-column="${questionIdFor(NOTES)}"]`)).toHaveCount(0);
  await expect(columns.getByTestId("column-types-refused")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "A table" })).toBeChecked();

  // AND THE FILTER FOLLOWS THE PRESENTATION, not the button that opened the dialog. Switching back
  // to stacked offers the long-text question again from the same control, which is the reason this
  // panel keys the filter to `group.presentation`: while the group is a table, both of its Add
  // controls reach the same mutation, so a type refused as a column has to be refused from either.
  await chooseRadio(page, "All instances on one page");
  await expect(columns).toHaveCount(0);
  await page.getByRole("button", { name: "Add question from library" }).click();
  const reopened = page.getByRole("dialog");
  await expect(pickerChoice(reopened, questionIdFor(MEMO), 1)).toBeVisible();
  await reopened.getByRole("button", { name: "Cancel" }).click();
});

/**
 * Set one group's hypothetical instance count, and wait for the control to have committed it.
 *
 * `fill` alone is not enough and the reason is the control rather than the test: the kit's
 * `NumberField` is the vendored react-aria one, which commits its value on blur or Enter rather
 * than on each keystroke (a half-typed "1" on the way to "12" is not a value anyone meant). A
 * bare fill therefore leaves the component holding its previous number and the panel showing the
 * previous roster - which reads as the bench ignoring the field.
 */
async function setInstanceCount(field: Locator, count: string): Promise<void> {
  await field.fill(count);
  await field.press("Enter");
  await expect(field).toHaveValue(count);
}

/**
 * One side of the comparison, normalised for the two things that are not the renderer's.
 *
 * **Instance ids** are a generated identity, which `withNormalizedInstanceIds` rewrites
 * positionally: the portal's come out of the session's instance ledger and the preview mints its
 * own, because a preview has no session to take one from.
 *
 * **`tabindex` goes**, and that is this walk's own addition rather than a general rule. The portal
 * plants a focus handle on the step's heading when the CURSOR navigates - `step-flow.tsx` sets
 * `tabIndex = -1` and focuses it, so a keyboard or screen-reader user starts at the top of the new
 * step - and this walk reaches the group's step by pressing Continue. The preview's step switch is
 * not a session navigation and plants nothing. That difference is the cursor's behaviour, not the
 * renderer's, so it is dropped here rather than asserted as a divergence; the non-repeating
 * comparison in `forms-publish.pw.ts` never navigates and so never meets it.
 *
 * **`disabled` goes on the ROSTER CONTROLS ONLY**, and the two surfaces genuinely differ there:
 * the portal hands the renderer `onAdd` and `onRemove` and the preview hands it neither, because a
 * preview's roster is the author's hypothesis, set by the instance-count field under the frame. It
 * is asserted on both sides before this normalisation rather than merely dropped, so a preview
 * that started offering a respondent's controls to an author still fails. Nothing else's
 * `disabled` is touched: a disabled INPUT would be a real divergence in what a respondent can
 * answer.
 *
 * **The `role="status"` region's TEXT goes, and the region itself does not.** The portal
 * announces the respondent's own roster operation there ("Passenger 2 added."), which is 4.1.3's
 * half of Q11; an author's preview has nothing to announce, because setting an instance count is
 * not an Add and the preview passes no `onAdd` at all. This walk reaches two instances by
 * pressing the portal's Add, so it meets that sentence by construction. The ELEMENT is compared
 * as it is - both surfaces render it, and a surface that stopped would still fail - and only the
 * transient sentence inside it is dropped.
 */
function comparable(shape: DomShape): DomShape {
  const normalise = (node: DomShape): DomShape => {
    const isRosterAction = node.attrs["data-qcms-repeat-action"] !== undefined;
    const isStatusRegion = node.attrs["role"] === "status";
    return {
      ...node,
      ...(isStatusRegion ? { text: "" } : {}),
      attrs: Object.fromEntries(
        Object.entries(node.attrs).filter(
          ([name]) => name !== "tabindex" && !(isRosterAction && name === "disabled"),
        ),
      ),
      children: node.children.map(normalise),
    };
  };
  return normalise(withNormalizedInstanceIds(shape));
}

/** The deepest level a repeat instance's heading can carry (`repeat.schema.ts`'s own enum). */
const INSTANCE_HEADING_CEILING = 4;

/** The deepest level any heading can carry. */
const HEADING_FLOOR = 6;

/**
 * The respondent's shape as an EMBED renders it: every heading one level lower, except an
 * instance's, which is clamped.
 *
 * `withDemotedHeadings` from `support/dom-shape.ts` is the general rule and is what the
 * non-repeating fidelity comparison uses (`forms-publish.pw.ts`). A document carrying a repeating
 * group needs one exception on top of it, and it is the renderer's rather than this test's: an
 * instance's heading is a node PROP constrained to `h1..h4`, so an embedded document cannot push
 * it to `h5` the way it pushes the group's own `Text` heading. The instance heading is the one
 * inside the instance's `<legend>` (`packages/ui/src/repeat/RepeatInstance.tsx`), which is what
 * the ceiling keys on.
 */
function asEmbedded(shape: DomShape): DomShape {
  const walk = (node: DomShape, ceiling: number): DomShape => {
    const inner = node.tag === "legend" ? INSTANCE_HEADING_CEILING : ceiling;
    return {
      ...node,
      tag: demotedTag(node.tag, inner),
      children: node.children.map((child) => walk(child, inner)),
    };
  };
  return walk(shape, HEADING_FLOOR);
}

/** One tag, one level lower, never past `ceiling`. A non-heading tag is returned as it is. */
function demotedTag(tag: string, ceiling: number): string {
  const level = /^h([1-6])$/u.exec(tag)?.[1];
  if (level === undefined) return tag;
  return `h${String(Math.min(Number(level) + 1, ceiling))}`;
}

/** The rendered step on the portal, which is the subtree the comparison reads. */
function rendererRoot(page: Page): Locator {
  return page.getByTestId("step-card").locator("form").last();
}

/**
 * Wait until React owns the RENDERED STEP, so the shape read is the hydrated one.
 *
 * React tags every host node it owns with a `__reactFiber$...` property, which is the attachment
 * signal itself rather than a proxy for it. Comparing a server-rendered tree against a hydrated
 * one would be comparing two different things and would fail for a reason that is not fidelity.
 *
 * It probes the same element {@link rendererRoot} reads, which is not "the first form on the
 * page": the portal's header carries the no-JS appearance form, and probing that one answers yes
 * while the step below is still the pre-hydration fallback (issue #195).
 */
async function waitForRenderedStep(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const forms = document.querySelectorAll('[data-testid="step-card"] form');
    const form = forms[forms.length - 1];
    if (form === undefined) return false;
    return Object.keys(form).some((key) => key.startsWith("__reactFiber$"));
  });
}
